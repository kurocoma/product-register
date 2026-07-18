import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { createInterface, type Interface as ReadLineInterface } from "node:readline";
import { z } from "zod";

// API route側の maxDuration=300s に収まるよう余裕を持たせる。実測: 画像14枚
// （お手本8枚+対象商品分）+ ultra推論の組み合わせは180秒を超える（2026-07-12確認）。
const DEFAULT_TIMEOUT_MS = 280_000;
const MAX_BUFFERED_NOTIFICATIONS = 500;

export const CODEX_PROPOSAL_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "sale_description_pc",
    "description_pc",
    "description_sp",
    "image_order",
    "image_naming_changes",
    "notes",
  ],
  properties: {
    sale_description_pc: { type: "string" },
    description_pc: { type: "string" },
    description_sp: { type: "string" },
    image_order: {
      type: "array",
      maxItems: 20,
      items: { type: "string" },
    },
    image_naming_changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to"],
        properties: {
          from: { type: "string" },
          to: { type: "string" },
        },
      },
    },
    notes: { type: "string" },
  },
} as const;

export const CodexRuleProposalSchema = z.object({
  sale_description_pc: z.string(),
  description_pc: z.string(),
  description_sp: z.string(),
  image_order: z.array(z.string()).max(20),
  image_naming_changes: z.array(z.object({
    from: z.string(),
    to: z.string(),
  }).strict()),
  notes: z.string(),
}).strict();

export type CodexRuleProposal = z.infer<typeof CodexRuleProposalSchema>;

type JsonObject = Record<string, unknown>;
type JsonRpcNotification = {
  method: string;
  params?: unknown;
};
type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
type NotificationWaiter = {
  method: string;
  predicate: (params: unknown) => boolean;
  resolve: (params: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

class CodexAppServerConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly reader: ReadLineInterface;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly notifications: JsonRpcNotification[] = [];
  private readonly notificationWaiters: NotificationWaiter[] = [];
  private readonly agentMessages = new Map<string, string[]>();
  private nextRequestId = 1;
  private stderr = "";
  private closed = false;

  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-8_000);
    });
    this.child.on("error", (error) => {
      this.fail(new Error("codex app-server を起動できません: " + error.message));
    });
    this.child.on("exit", (code, signal) => {
      if (this.closed) return;
      const detail = this.stderr.trim();
      const suffix = detail ? "\n" + detail : "";
      this.fail(
        new Error(
          "codex app-server が完了前に終了しました (code=" +
            String(code) +
            ", signal=" +
            String(signal) +
            ")" +
            suffix,
        ),
      );
    });

    this.reader = createInterface({ input: this.child.stdout });
    this.reader.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        this.handleMessage(JSON.parse(trimmed) as unknown);
      } catch (error) {
        this.fail(
          new Error(
            "codex app-server から不正なJSONを受信しました: " +
              (error instanceof Error ? error.message : String(error)),
          ),
        );
      }
    });
  }

  async request<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    if (this.closed) throw new Error("codex app-server 接続は終了しています");

    const id = String(this.nextRequestId++);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(method + " がタイムアウトしました"));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });

      void this.send({ id: Number(id), method, params }).catch((error) => {
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(error);
      });
    });
  }

  async notify(method: string): Promise<void> {
    if (this.closed) throw new Error("codex app-server 接続は終了しています");
    await this.send({ method });
  }

  waitForNotification(
    method: string,
    predicate: (params: unknown) => boolean,
    timeoutMs: number,
  ): Promise<unknown> {
    const bufferedIndex = this.notifications.findIndex(
      (notification) =>
        notification.method === method && predicate(notification.params),
    );
    if (bufferedIndex >= 0) {
      const [notification] = this.notifications.splice(bufferedIndex, 1);
      return Promise.resolve(notification.params);
    }

    if (this.closed) {
      return Promise.reject(new Error("codex app-server 接続は終了しています"));
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.notificationWaiters.indexOf(waiter);
        if (index >= 0) this.notificationWaiters.splice(index, 1);
        reject(new Error(method + " の待機がタイムアウトしました"));
      }, timeoutMs);
      const waiter: NotificationWaiter = {
        method,
        predicate,
        resolve,
        reject,
        timer,
      };
      this.notificationWaiters.push(waiter);
    });
  }

  getLastAgentMessage(turnId: string): string | undefined {
    const messages = this.agentMessages.get(turnId) ?? [];
    return messages[messages.length - 1];
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.reader.close();
    this.child.stdin.end();
    if (!this.child.killed) this.child.kill();
  }

  private send(message: JsonObject): Promise<void> {
    return new Promise((resolve, reject) => {
      this.child.stdin.write(JSON.stringify(message) + "\n", "utf8", (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private handleMessage(value: unknown): void {
    if (!isJsonObject(value)) {
      throw new Error("メッセージがオブジェクトではありません");
    }

    if ("id" in value && !("method" in value)) {
      const id = String(value.id);
      const pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(id);

      if ("error" in value) {
        pending.reject(new Error(formatJsonRpcError(value.error)));
      } else {
        pending.resolve(value.result);
      }
      return;
    }

    if (typeof value.method !== "string") return;
    const notification = {
      method: value.method,
      params: value.params,
    };
    this.captureAgentMessage(notification);

    const waiterIndex = this.notificationWaiters.findIndex(
      (waiter) =>
        waiter.method === notification.method &&
        waiter.predicate(notification.params),
    );
    if (waiterIndex >= 0) {
      const [waiter] = this.notificationWaiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(notification.params);
      return;
    }

    this.notifications.push(notification);
    if (this.notifications.length > MAX_BUFFERED_NOTIFICATIONS) {
      this.notifications.splice(
        0,
        this.notifications.length - MAX_BUFFERED_NOTIFICATIONS,
      );
    }
  }

  private captureAgentMessage(notification: JsonRpcNotification): void {
    if (notification.method !== "item/completed") return;
    if (!isJsonObject(notification.params)) return;

    const turnId = notification.params.turnId;
    const item = notification.params.item;
    if (
      typeof turnId !== "string" ||
      !isJsonObject(item) ||
      item.type !== "agentMessage" ||
      typeof item.text !== "string"
    ) {
      return;
    }

    const messages = this.agentMessages.get(turnId) ?? [];
    messages.push(item.text);
    this.agentMessages.set(turnId, messages);
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.reader?.close();

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();

    for (const waiter of this.notificationWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.notificationWaiters.splice(0);

    if (!this.child.killed) this.child.kill();
  }
}

export type CodexRuleProposalRequest = {
  prompt: string;
  imageUrls: string[];
  cwd?: string;
  timeoutMs?: number;
};

export async function requestCodexRuleProposal(
  input: CodexRuleProposalRequest,
): Promise<CodexRuleProposal> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cwd = input.cwd ?? process.cwd();

  const child = spawn("codex", ["app-server"], {
    cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    shell: process.platform === "win32",
  });
  const connection = new CodexAppServerConnection(child);

  try {
    await connection.request(
      "initialize",
      {
        clientInfo: {
          name: "product-register-rule-normalizer",
          version: "1.0.0",
        },
      },
      timeoutMs,
    );
    await connection.notify("initialized");

    const threadStart = await connection.request<unknown>(
      "thread/start",
      {
        cwd,
        sandbox: "read-only",
        approvalPolicy: "never",
        ephemeral: true,
      },
      timeoutMs,
    );
    const threadId = readNestedString(threadStart, ["thread", "id"], "thread/start");

    const imageUrls = Array.from(
      new Set(input.imageUrls.map((url) => url.trim()).filter(Boolean)),
    );
    const imageInputs = await fetchImagesAsDataUrls(imageUrls);
    const userInput = [
      { type: "text", text: input.prompt },
      ...imageInputs.map((url) => ({ type: "image", url })),
    ];

    const turnStart = await connection.request<unknown>(
      "turn/start",
      {
        threadId,
        input: userInput,
        outputSchema: CODEX_PROPOSAL_OUTPUT_SCHEMA,
      },
      timeoutMs,
    );
    const turnId = readNestedString(turnStart, ["turn", "id"], "turn/start");

    const completedParams = await connection.waitForNotification(
      "turn/completed",
      (params) => isCompletedTurnFor(params, threadId, turnId),
      timeoutMs,
    );
    const completedTurn = readNestedObject(
      completedParams,
      ["turn"],
      "turn/completed",
    );

    if (completedTurn.status !== "completed") {
      const turnError = isJsonObject(completedTurn.error)
        ? completedTurn.error.message
        : undefined;
      throw new Error(
        "Codexターンが完了しませんでした (status=" +
          String(completedTurn.status) +
          ")" +
          (typeof turnError === "string" ? ": " + turnError : ""),
      );
    }

    const messageText =
      lastAgentMessageFromTurn(completedTurn) ??
      connection.getLastAgentMessage(turnId);
    if (!messageText) {
      throw new Error("Codexの最終提案メッセージが見つかりません");
    }

    return parseCodexProposal(messageText);
  } finally {
    connection.close();
  }
}

const EXTENSION_MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

function guessMimeTypeFromUrl(url: string): string {
  const match = /\.([a-zA-Z0-9]+)(?:[?#]|$)/.exec(url);
  const extension = match?.[1]?.toLowerCase();
  return (extension && EXTENSION_MIME_TYPES[extension]) || "image/jpeg";
}

// codex app-server はリモート画像URLを受け付けず、data URL（インラインbase64）のみ
// サポートする（実測: turn/start が "-32600 remote image URLs are not supported;
// use an inline data URL instead" を返す）。取得に失敗した画像は警告して読み飛ばし、
// 1枚の失敗で提案生成全体を止めない。
async function fetchImagesAsDataUrls(urls: string[]): Promise<string[]> {
  const dataUrls: string[] = [];
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("HTTP " + String(response.status));
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const mimeType =
        response.headers.get("content-type") || guessMimeTypeFromUrl(url);
      dataUrls.push(
        "data:" + mimeType + ";base64," + buffer.toString("base64"),
      );
    } catch (error) {
      console.warn(
        "[codex-client] 画像の取得に失敗したためスキップします: " +
          url +
          " (" +
          (error instanceof Error ? error.message : String(error)) +
          ")",
      );
    }
  }
  return dataUrls;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatJsonRpcError(value: unknown): string {
  if (!isJsonObject(value)) return "codex app-server がJSON-RPCエラーを返しました";
  const code = value.code === undefined ? "" : " (" + String(value.code) + ")";
  const message =
    typeof value.message === "string"
      ? value.message
      : "codex app-server がJSON-RPCエラーを返しました";
  return message + code;
}

function readNestedObject(
  value: unknown,
  path: string[],
  source: string,
): JsonObject {
  let current = value;
  for (const key of path) {
    if (!isJsonObject(current)) {
      throw new Error(source + " の応答形式が不正です");
    }
    current = current[key];
  }
  if (!isJsonObject(current)) {
    throw new Error(source + " の応答形式が不正です");
  }
  return current;
}

function readNestedString(
  value: unknown,
  path: string[],
  source: string,
): string {
  let current = value;
  for (const key of path) {
    if (!isJsonObject(current)) {
      throw new Error(source + " の応答形式が不正です");
    }
    current = current[key];
  }
  if (typeof current !== "string" || current === "") {
    throw new Error(source + " のIDを取得できませんでした");
  }
  return current;
}

function isCompletedTurnFor(
  params: unknown,
  threadId: string,
  turnId: string,
): boolean {
  if (!isJsonObject(params) || params.threadId !== threadId) return false;
  const turn = params.turn;
  return isJsonObject(turn) && turn.id === turnId;
}

function lastAgentMessageFromTurn(turn: JsonObject): string | undefined {
  if (!Array.isArray(turn.items)) return undefined;
  const messages = turn.items.flatMap((item) =>
    isJsonObject(item) &&
    item.type === "agentMessage" &&
    typeof item.text === "string"
      ? [item.text]
      : [],
  );
  return messages[messages.length - 1];
}

function parseCodexProposal(text: string): CodexRuleProposal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      "Codex提案をJSONとして解析できません: " +
        (error instanceof Error ? error.message : String(error)),
    );
  }

  const result = CodexRuleProposalSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => issue.path.join(".") + ": " + issue.message)
      .join(" / ");
    throw new Error("Codex提案が期待する形式と一致しません: " + details);
  }
  return result.data;
}
