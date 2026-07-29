// /api/masters/auto-download の契約テスト。
// Playwright も Supabase も起動せず、スクリプト起動だけを差し替えて
// 認証・ファイル名ガード・NDJSON 組み立て・警告時の自動取込ブロック・同時実行ロックを検証する。
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

// barrel（repository 経由で Supabase を掴む）を避け、純ロジックだけを実体で使う。
vi.mock("@/lib/ne-master", async () => {
  const auto = await import("@/lib/ne-master/auto-download");
  const decode = await import("@/lib/ne-master/decode");
  return { ...auto, ...decode, runNeMasterDownloadScript: vi.fn() };
});

import { GET, POST } from "@/app/api/masters/auto-download/route";
import { createClient } from "@/lib/supabase/server";
import { runNeMasterDownloadScript } from "@/lib/ne-master";
import type { NeScriptEvent } from "./auto-download";

const asMock = <T>(fn: T) => fn as unknown as Mock;

function setUser(user: { id: string } | null) {
  asMock(createClient).mockResolvedValue({ auth: { getUser: vi.fn(async () => ({ data: { user } })) } });
}

let dir = "";

/** スクリプト実行を偽装する。emit で好きなイベント列を流し込む。 */
function fakeScript(emit: (onEvent: (e: NeScriptEvent) => void) => void | Promise<void>, result = {}) {
  asMock(runNeMasterDownloadScript).mockImplementation(async (args: { onEvent: (e: NeScriptEvent) => void }) => {
    await emit(args.onEvent);
    return { code: 0, stderr: "", timedOut: false, aborted: false, ...result };
  });
}

async function readEvents(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

const postReq = (body: unknown) =>
  new Request("http://localhost/api/masters/auto-download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  vi.clearAllMocks();
  dir = await mkdtemp(path.join(tmpdir(), "ne-route-"));
  process.env.NE_MASTER_DOWNLOAD_DIR = dir;
  setUser({ id: "u1" });
});

afterEach(async () => {
  delete process.env.NE_MASTER_DOWNLOAD_DIR;
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("認証", () => {
  it("未ログインの GET は 401", async () => {
    setUser(null);
    const res = await GET(new Request("http://localhost/api/masters/auto-download?file=a.csv"));
    expect(res.status).toBe(401);
  });

  it("未ログインの POST は 401（スクリプトを起動しない）", async () => {
    setUser(null);
    const res = await POST(postReq({ targets: ["ne-syohin"] }));
    expect(res.status).toBe(401);
    expect(runNeMasterDownloadScript).not.toHaveBeenCalled();
  });
});

describe("GET（取得済みCSVの受け渡し）", () => {
  it("file 未指定は 400", async () => {
    const res = await GET(new Request("http://localhost/api/masters/auto-download"));
    expect(res.status).toBe(400);
  });

  it("CSV 以外・記号入りのファイル名は 400", async () => {
    for (const f of ["a.txt", "a b.csv", "a;rm.csv", "日本語.csv"]) {
      const res = await GET(new Request(`http://localhost/api/masters/auto-download?file=${encodeURIComponent(f)}`));
      expect(res.status, f).toBe(400);
    }
  });

  it("パストラバーサルは basename 化されて外に出ない", async () => {
    const res = await GET(
      new Request("http://localhost/api/masters/auto-download?file=" + encodeURIComponent("../../../etc/passwd")),
    );
    expect(res.status).toBe(400); // .csv でないので弾かれる
    const res2 = await GET(
      new Request("http://localhost/api/masters/auto-download?file=" + encodeURIComponent("../../secret.csv")),
    );
    expect(res2.status).toBe(404); // downloadDir 直下の secret.csv を見に行くだけ
  });

  it("存在すれば CSV として返す", async () => {
    await writeFile(path.join(dir, "ne-syohin-20260729.csv"), "code,name\r\na1,あ\r\n", "utf8");
    const res = await GET(new Request("http://localhost/api/masters/auto-download?file=ne-syohin-20260729.csv"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(await res.text()).toContain("a1,あ");
  });
});

describe("POST（NDJSON の組み立て）", () => {
  /** CP932 のページ別CSVを作る（既存の decodeCsvBytes を通す前提の検証も兼ねる）。 */
  const writePage = async (name: string, body: string) => {
    const full = path.join(dir, name);
    await writeFile(full, body, "utf8");
    return full;
  };

  it("対象が空なら 400", async () => {
    const res = await POST(postReq({ targets: ["excel-master"] }));
    expect(res.status).toBe(400);
  });

  it("2ページを結合して merged を返し、件数一致なら取込ブロックしない", async () => {
    const p1 = await writePage("_page_1.csv", "code,name\r\n" + Array.from({ length: 1000 }, (_, i) => `c${i},n${i}`).join("\r\n") + "\r\n");
    const p2 = await writePage("_page_2.csv", "code,name\r\n" + Array.from({ length: 250 }, (_, i) => `d${i},m${i}`).join("\r\n") + "\r\n");
    fakeScript((onEvent) => {
      onEvent({ type: "target-start", key: "ne-syohin" });
      onEvent({ type: "target-done", key: "ne-syohin", pageFiles: [p1, p2], entries: 1250, pageItems: 1000 });
    });

    const events = await readEvents(await POST(postReq({ targets: ["ne-syohin"] })));
    const merged = events.find((e) => e.type === "merged")!;
    expect(merged).toMatchObject({
      key: "ne-syohin",
      rows: 1250,
      pages: 2,
      expectedPages: 2,
      warnings: [],
      autoImportBlocked: false,
    });
    // ページ別CSVは片付けられ、結合済みCSVだけが残る
    const files = await readdir(dir);
    expect(files).not.toContain("_page_1.csv");
    expect(files.some((f) => f.startsWith("ne-syohin-") && f.endsWith(".csv"))).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "finished", ok: true });
  });

  it("ページが足りないときは autoImportBlocked を立てる（部分データの取込防止）", async () => {
    const p1 = await writePage("_page_1.csv", "code,name\r\n" + Array.from({ length: 1000 }, (_, i) => `c${i},n${i}`).join("\r\n") + "\r\n");
    fakeScript((onEvent) => {
      onEvent({ type: "target-done", key: "ne-syohin", pageFiles: [p1], entries: 1250, pageItems: 1000 });
    });

    const events = await readEvents(await POST(postReq({ targets: ["ne-syohin"] })));
    const merged = events.find((e) => e.type === "merged") as { autoImportBlocked: boolean; warnings: string[] };
    expect(merged.autoImportBlocked).toBe(true);
    expect(merged.warnings.join()).toMatch(/欠落|1250 件/);
  });

  it("結合に失敗した対象は target-error になり、他は流れ続ける", async () => {
    const bad = await writePage("_page_bad.csv", "");
    fakeScript((onEvent) => {
      onEvent({ type: "target-done", key: "ne-set", pageFiles: [bad], entries: 10, pageItems: 1000 });
    });
    const events = await readEvents(await POST(postReq({ targets: ["ne-set"] })));
    expect(events.find((e) => e.type === "target-error")).toMatchObject({ key: "ne-set" });
    expect(events.at(-1)).toMatchObject({ type: "finished" });
  });

  it("スクリプトの異常終了は fatal として通知する", async () => {
    fakeScript(() => {}, { code: 1, stderr: "playwright が見つかりません" });
    const events = await readEvents(await POST(postReq({ targets: ["ne-syohin"] })));
    const fatal = events.find((e) => e.type === "fatal") as { message: string };
    expect(fatal.message).toContain("exit 1");
    expect(fatal.message).toContain("playwright");
    expect(events.at(-1)).toMatchObject({ type: "finished", ok: false });
  });

  it("タイムアウト・中断は専用メッセージで通知する", async () => {
    fakeScript(() => {}, { code: -1, timedOut: true });
    const a = await readEvents(await POST(postReq({ targets: ["ne-syohin"] })));
    expect((a.find((e) => e.type === "fatal") as { message: string }).message).toMatch(/タイムアウト/);

    fakeScript(() => {}, { code: -1, aborted: true });
    const b = await readEvents(await POST(postReq({ targets: ["ne-syohin"] })));
    expect((b.find((e) => e.type === "fatal") as { message: string }).message).toMatch(/切断/);
  });

  it("targets 未指定なら3マスタすべてを対象にする", async () => {
    fakeScript(() => {});
    await readEvents(await POST(postReq({})));
    const call = asMock(runNeMasterDownloadScript).mock.calls[0][0];
    expect(call.targets).toEqual(["ne-syohin", "ne-set", "ne-himoduke"]);
    expect(call.mode).toBe("download");
    expect(call.targetDefs).toHaveLength(3); // 対象定義は lib 正本から渡す
    expect(call.signal).toBeDefined(); // 切断で kill できる
    expect(call.timeoutMs).toBeGreaterThan(0);
  });

  it("headless:false は本番では無視する（サーバーで画面を開かせない）", async () => {
    fakeScript(() => {});
    try {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.NE_MASTER_ALLOW_HEADED;
      await readEvents(await POST(postReq({ targets: ["ne-syohin"], headless: false })));
      expect(asMock(runNeMasterDownloadScript).mock.calls[0][0].headless).toBe(true);

      // 明示的に許可した開発環境ではヘッドありを通す
      asMock(runNeMasterDownloadScript).mockClear();
      vi.stubEnv("NE_MASTER_ALLOW_HEADED", "1");
      await readEvents(await POST(postReq({ targets: ["ne-syohin"], headless: false })));
      expect(asMock(runNeMasterDownloadScript).mock.calls[0][0].headless).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("probe モードは targets 無しでも動き、対象定義との照合結果を添えて返す", async () => {
    fakeScript((onEvent) => {
      onEvent({
        type: "probe",
        message: "probe 完了",
        report: {
          generatedAt: "2026-07-29T00:00:00.000Z",
          searchTargets: [
            {
              optionText: "ページ情報単位で検索",
              optionValue: "2",
              containerId: "search_syohin_page_result",
              entries: 1193,
              pageItems: 1000,
              countText: "全1193件中1-1000を表示",
              pagination: { found: true, links: [], html: "" },
              tenpoRadios: [],
              perTenpo: [
                {
                  value: "0",
                  label: "商品管理",
                  downloadFiles: [{ fileName: "syohin_page", panelHeading: "商品ページCSV（紐づけ）" }],
                  panelHeadings: [],
                },
              ],
            },
          ],
        },
      });
    });

    const events = await readEvents(await POST(postReq({ mode: "probe", targets: [] })));
    expect(asMock(runNeMasterDownloadScript).mock.calls[0][0].mode).toBe("probe");
    const probe = events.find((e) => e.type === "probe") as { matches: Record<string, unknown[]> };
    expect(probe.matches["ne-himoduke"]).toHaveLength(1);
    expect(probe.matches["ne-syohin"]).toHaveLength(0);
  });
});

describe("同時実行ロック", () => {
  it("実行中はもう1本受け付けない（409）", async () => {
    const gate: { release: (() => void) | null } = { release: null };
    asMock(runNeMasterDownloadScript).mockImplementation(
      () =>
        new Promise((resolve) => {
          gate.release = () => resolve({ code: 0, stderr: "", timedOut: false, aborted: false });
        }),
    );

    const firstRes = await POST(postReq({ targets: ["ne-syohin"] })); // ロックを握ったまま返る
    expect(firstRes.status).toBe(200);
    for (let i = 0; i < 100 && !gate.release; i++) await new Promise((r) => setTimeout(r, 10));

    const second = await POST(postReq({ targets: ["ne-syohin"] }));
    expect(second.status).toBe(409);

    gate.release?.();
    await readEvents(firstRes);

    // 解放後は再実行できる
    fakeScript(() => {});
    const third = await POST(postReq({ targets: ["ne-syohin"] }));
    expect(third.status).toBe(200);
    await readEvents(third);
  }, 20_000);

  it("古いロック（クラッシュ残骸）は奪って実行できる", async () => {
    await writeFile(path.join(dir, "_running.lock"), "{}", "utf8");
    // NE_MASTER_TIMEOUT_MS を極小にして「古い」と判定させる
    process.env.NE_MASTER_TIMEOUT_MS = "1";
    try {
      await new Promise((r) => setTimeout(r, 30));
      fakeScript(() => {});
      const res = await POST(postReq({ targets: ["ne-syohin"] }));
      expect(res.status).toBe(200);
      await readEvents(res);
    } finally {
      delete process.env.NE_MASTER_TIMEOUT_MS;
    }
  });
});
