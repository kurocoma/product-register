// 紐づけ表の「専用ページ直接ダウンロード」対応のテスト。
//
// 実機確定（2026-07-30 スクリーンショット）: 紐づけ表は商品検索の一括DL画面には無く、
// 設定＞商品＞商品コード紐づけ（/Userhimoduke）の【1】商品コード紐づけCSVダウンロードで取得する
// （店舗未選択＝全店舗一括・ページ分割なし）。
// ここでは (1) 対象定義の directPage が lib 正本・CLI フォールバックで一致していること、
// (2) route が direct な target-done を「総件数不明」扱いでブロックしないこと（検索フロー側の
// 安全弁は従来どおり働くこと）を固定する。
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

// barrel（repository 経由で Supabase を掴む）を避け、純ロジックだけを実体で使う。
vi.mock("@/lib/ne-master", async () => {
  const auto = await import("@/lib/ne-master/auto-download");
  const decode = await import("@/lib/ne-master/decode");
  return { ...auto, ...decode, runNeMasterDownloadScript: vi.fn() };
});

import { POST } from "@/app/api/masters/auto-download/route";
import { createClient } from "@/lib/supabase/server";
import { runNeMasterDownloadScript } from "@/lib/ne-master";
import { neAutoDownloadTargetDefs, NE_AUTO_DOWNLOAD_TARGETS, type NeScriptEvent } from "./auto-download";
import * as scriptDefaults from "../../scripts/ne-master-defaults.mjs";

const asMock = <T>(fn: T) => fn as unknown as Mock;

type DirectPage = { url: string; readySelectors: string[]; downloadSelectors: string[] };
const defaults = scriptDefaults as unknown as { DEFAULT_TARGET_DEFS: { key: string; directPage?: DirectPage }[] };

describe("対象定義: 紐づけ表は専用ページから直接ダウンロード", () => {
  it("ne-himoduke だけが directPage（/Userhimoduke）を持つ", () => {
    const defs = neAutoDownloadTargetDefs({});
    const himoduke = defs.find((d) => d.key === "ne-himoduke")!;
    expect(himoduke.directPage?.url).toBe("https://main.next-engine.com/Userhimoduke");
    // 実機 DevTools で確認したボタン: button[name="action_button[]"] onclick="javascript:csv_download(this);"
    expect(himoduke.directPage?.downloadSelectors[0]).toContain("csv_download");
    expect(himoduke.directPage?.readySelectors.length).toBeGreaterThan(0);
    expect(defs.find((d) => d.key === "ne-syohin")!.directPage).toBeUndefined();
    expect(defs.find((d) => d.key === "ne-set")!.directPage).toBeUndefined();
  });

  it("UI 向け一覧の direct フラグは定義から導出される", () => {
    expect(NE_AUTO_DOWNLOAD_TARGETS.map((t) => [t.key, t.direct])).toEqual([
      ["ne-syohin", false],
      ["ne-set", false],
      ["ne-himoduke", true],
    ]);
  });

  it("URL・ボタンは env で上書きできる（NE の画面変更への追従）", () => {
    const defs = neAutoDownloadTargetDefs({
      NE_MASTER_HIMODUKE_DIRECT_URL: "https://main.next-engine.com/Userhimoduke2",
      NE_MASTER_HIMODUKE_DIRECT_BUTTON: "#dl_button",
    });
    const dp = defs.find((d) => d.key === "ne-himoduke")!.directPage!;
    expect(dp.url).toBe("https://main.next-engine.com/Userhimoduke2");
    expect(dp.downloadSelectors).toEqual(["#dl_button"]);
  });

  it("CLI フォールバック（ne-master-defaults.mjs）の directPage が lib 正本と一致する", () => {
    const lib = neAutoDownloadTargetDefs({}).find((d) => d.key === "ne-himoduke")!.directPage;
    const cli = defaults.DEFAULT_TARGET_DEFS.find((d) => d.key === "ne-himoduke")!.directPage;
    expect(cli).toEqual(lib);
  });
});

describe("route: direct ダウンロードの取込判定", () => {
  let dir = "";

  function setUser(user: { id: string } | null) {
    asMock(createClient).mockResolvedValue({ auth: { getUser: vi.fn(async () => ({ data: { user } })) } });
  }

  function fakeScript(emit: (onEvent: (e: NeScriptEvent) => void) => void) {
    asMock(runNeMasterDownloadScript).mockImplementation(async (args: { onEvent: (e: NeScriptEvent) => void }) => {
      await emit(args.onEvent);
      return { code: 0, stderr: "", timedOut: false, aborted: false };
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
    dir = await mkdtemp(path.join(tmpdir(), "ne-direct-"));
    process.env.NE_MASTER_DOWNLOAD_DIR = dir;
    setUser({ id: "u1" });
  });

  afterEach(async () => {
    delete process.env.NE_MASTER_DOWNLOAD_DIR;
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("direct: true の target-done は entries 不明でも自動取込をブロックしない（ページ分割が無いため）", async () => {
    const p1 = path.join(dir, "_page_himoduke_1.csv");
    await writeFile(p1, "商品コード,代表商品コード\r\n" + Array.from({ length: 1193 }, (_, i) => `c${i},r${i}`).join("\r\n") + "\r\n", "utf8");
    fakeScript((onEvent) => {
      onEvent({ type: "target-start", key: "ne-himoduke" });
      onEvent({
        type: "target-done",
        key: "ne-himoduke",
        pageFiles: [p1],
        entries: null,
        pageItems: 1000,
        entriesUnknown: false,
        direct: true,
      });
    });

    const events = await readEvents(await POST(postReq({ targets: ["ne-himoduke"] })));
    const merged = events.find((e) => e.type === "merged")!;
    expect(merged).toMatchObject({
      key: "ne-himoduke",
      rows: 1193,
      direct: true,
      entriesUnknown: false,
      warnings: [],
      autoImportBlocked: false,
    });
  });

  it("direct でも 0 行なら従来どおりブロックする（空CSVの取込防止）", async () => {
    const p1 = path.join(dir, "_page_himoduke_empty.csv");
    await writeFile(p1, "商品コード,代表商品コード\r\n", "utf8");
    fakeScript((onEvent) => {
      onEvent({ type: "target-done", key: "ne-himoduke", pageFiles: [p1], entries: null, pageItems: 1000, direct: true });
    });

    const events = await readEvents(await POST(postReq({ targets: ["ne-himoduke"] })));
    const merged = events.find((e) => e.type === "merged") as { autoImportBlocked: boolean; warnings: string[] };
    expect(merged.autoImportBlocked).toBe(true);
    expect(merged.warnings.join()).toMatch(/0行/);
  });

  it("セットは行数照合をしない（1件が構成品ごとの複数行になるため誤警告にしない）", async () => {
    // 実測 2026-07-30: 一覧1472件（2ページ）に対し CSV は 1677 行。
    const p1 = path.join(dir, "_page_set_1.csv");
    const p2 = path.join(dir, "_page_set_2.csv");
    const header = "セットコード,代表,セット名,売価,税率,構成品,数量,JAN\r\n";
    await writeFile(p1, header + Array.from({ length: 1165 }, (_, i) => `s${i},,n${i},100,10,c${i},1,4900000000000`).join("\r\n") + "\r\n", "utf8");
    await writeFile(p2, header + Array.from({ length: 512 }, (_, i) => `t${i},,m${i},100,10,d${i},1,4900000000000`).join("\r\n") + "\r\n", "utf8");
    fakeScript((onEvent) => {
      onEvent({ type: "target-done", key: "ne-set", pageFiles: [p1, p2], entries: 1472, pageItems: 1000 });
    });

    const events = await readEvents(await POST(postReq({ targets: ["ne-set"] })));
    const merged = events.find((e) => e.type === "merged") as { rows: number; warnings: string[]; autoImportBlocked: boolean };
    expect(merged.rows).toBe(1677);
    expect(merged.warnings).toEqual([]);
    expect(merged.autoImportBlocked).toBe(false);
  });

  it("セットでもページ数不足は検出する（行数照合を切っても取りこぼしは止める）", async () => {
    const p1 = path.join(dir, "_page_set_only1.csv");
    await writeFile(p1, "セットコード,構成品\r\n" + Array.from({ length: 1165 }, (_, i) => `s${i},c${i}`).join("\r\n") + "\r\n", "utf8");
    fakeScript((onEvent) => {
      onEvent({ type: "target-done", key: "ne-set", pageFiles: [p1], entries: 1472, pageItems: 1000 });
    });

    const events = await readEvents(await POST(postReq({ targets: ["ne-set"] })));
    const merged = events.find((e) => e.type === "merged") as { warnings: string[]; autoImportBlocked: boolean };
    expect(merged.autoImportBlocked).toBe(true);
    expect(merged.warnings.join()).toMatch(/欠落/);
  });

  it("単品は従来どおり行数照合する（775件=775行）", async () => {
    const p1 = path.join(dir, "_page_syohin_short.csv");
    await writeFile(p1, "code,name\r\n" + Array.from({ length: 700 }, (_, i) => `c${i},n${i}`).join("\r\n") + "\r\n", "utf8");
    fakeScript((onEvent) => {
      onEvent({ type: "target-done", key: "ne-syohin", pageFiles: [p1], entries: 775, pageItems: 1000 });
    });

    const events = await readEvents(await POST(postReq({ targets: ["ne-syohin"] })));
    const merged = events.find((e) => e.type === "merged") as { warnings: string[]; autoImportBlocked: boolean };
    expect(merged.autoImportBlocked).toBe(true);
    expect(merged.warnings.join()).toMatch(/775 件/);
  });

  it("direct でない target-done の entries 不明ブロックは従来どおり働く（安全弁の退行防止）", async () => {
    const p1 = path.join(dir, "_page_syohin_1.csv");
    await writeFile(p1, "code,name\r\n" + Array.from({ length: 1000 }, (_, i) => `c${i},n${i}`).join("\r\n") + "\r\n", "utf8");
    fakeScript((onEvent) => {
      onEvent({ type: "target-done", key: "ne-syohin", pageFiles: [p1], entries: null, pageItems: 1000 });
    });

    const events = await readEvents(await POST(postReq({ targets: ["ne-syohin"] })));
    const merged = events.find((e) => e.type === "merged") as { autoImportBlocked: boolean; entriesUnknown: boolean };
    expect(merged.entriesUnknown).toBe(true);
    expect(merged.autoImportBlocked).toBe(true);
  });
});
