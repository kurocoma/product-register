import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    default: { ...actual, spawn: spawnMock },
    spawn: spawnMock,
  };
});

import {
  requestCodexRuleProposal,
  type CodexRuleProposal,
} from "./codex-client";

type JsonRpcRequest = {
  id?: number;
  method: string;
  params?: unknown;
};

const VALID_PROPOSAL: CodexRuleProposal = {
  sale_description_pc: "楽天PC用販売説明文",
  description_pc: "PC用商品説明文",
  description_sp: "スマートフォン用商品説明文",
  image_order: ["https://example.com/item-01.jpg"],
  image_naming_changes: [],
  notes: "既存画像を並べ替えました",
};

function createFakeChild(
  onRequest: (
    request: JsonRpcRequest,
    child: ChildProcessWithoutNullStreams,
    stdout: PassThrough,
  ) => void,
): ChildProcessWithoutNullStreams {
  const events = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(events, {
    stdin: new Writable({
      write(chunk, _encoding, callback) {
        try {
          const request = JSON.parse(String(chunk)) as JsonRpcRequest;
          onRequest(request, child, stdout);
          callback();
        } catch (error) {
          callback(error instanceof Error ? error : new Error(String(error)));
        }
      },
    }),
    stdout,
    stderr,
    killed: false,
    kill: vi.fn(() => {
      Object.defineProperty(child, "killed", { value: true, configurable: true });
      return true;
    }),
  }) as unknown as ChildProcessWithoutNullStreams;
  return child;
}

function writeJson(stdout: PassThrough, value: unknown): void {
  stdout.write(JSON.stringify(value) + "\n");
}

function createSuccessfulChild(
  proposal: unknown = VALID_PROPOSAL,
  completeTurn = true,
): ChildProcessWithoutNullStreams {
  return createFakeChild((request, _child, stdout) => {
    if (request.method === "initialize") {
      writeJson(stdout, { id: request.id, result: {} });
      return;
    }
    if (request.method === "thread/start") {
      writeJson(stdout, {
        id: request.id,
        result: { thread: { id: "thread-1" } },
      });
      return;
    }
    if (request.method !== "turn/start") return;

    writeJson(stdout, {
      id: request.id,
      result: { turn: { id: "turn-1" } },
    });
    if (!completeTurn) return;

    writeJson(stdout, {
      method: "item/completed",
      params: {
        turnId: "turn-1",
        item: {
          type: "agentMessage",
          text: JSON.stringify(proposal),
        },
      },
    });
    writeJson(stdout, {
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "completed" },
      },
    });
  });
}

describe("requestCodexRuleProposal", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("JSON-RPCの応答と通知から提案を返す", async () => {
    spawnMock.mockReturnValue(createSuccessfulChild());

    await expect(
      requestCodexRuleProposal({
        prompt: "ルールに合わせて正規化してください",
        imageUrls: [],
        cwd: "C:/workspace",
        timeoutMs: 1_000,
      }),
    ).resolves.toEqual(VALID_PROPOSAL);

    expect(spawnMock).toHaveBeenCalledWith(
      "codex",
      ["app-server"],
      expect.objectContaining({
        cwd: "C:/workspace",
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      }),
    );
  });

  it("プロセスが起動直後に終了した場合は拒否する", async () => {
    spawnMock.mockReturnValue(
      createFakeChild((request, child) => {
        if (request.method === "initialize") {
          child.emit("exit", 1, null);
        }
      }),
    );

    await expect(
      requestCodexRuleProposal({
        prompt: "test",
        imageUrls: [],
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow("codex app-server が完了前に終了しました");
  });

  it("stdoutに不正なJSON行が流れた場合は拒否する", async () => {
    spawnMock.mockReturnValue(
      createFakeChild((request, _child, stdout) => {
        if (request.method === "initialize") stdout.write("{invalid json}\n");
      }),
    );

    await expect(
      requestCodexRuleProposal({
        prompt: "test",
        imageUrls: [],
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow("codex app-server から不正なJSONを受信しました");
  });

  it("最終メッセージが提案スキーマと一致しない場合は拒否する", async () => {
    const invalidProposal = { ...VALID_PROPOSAL } as Partial<CodexRuleProposal>;
    delete invalidProposal.notes;
    spawnMock.mockReturnValue(createSuccessfulChild(invalidProposal));

    await expect(
      requestCodexRuleProposal({
        prompt: "test",
        imageUrls: [],
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow("Codex提案が期待する形式と一致しません");
  });

  it("turn/completedが時間内に届かない場合は拒否する", async () => {
    vi.useFakeTimers();
    spawnMock.mockReturnValue(createSuccessfulChild(VALID_PROPOSAL, false));

    const assertion = expect(
      requestCodexRuleProposal({
        prompt: "test",
        imageUrls: [],
        timeoutMs: 100,
      }),
    ).rejects.toThrow("turn/completed の待機がタイムアウトしました");

    await vi.runAllTimersAsync();
    await assertion;
  });
});
