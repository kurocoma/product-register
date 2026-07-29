// スクリプトランナー（子プロセス起動・NDJSON 解釈・タイムアウト/中断）のテスト。
// 実際の Playwright は起動せず、NDJSON を吐くだけの偽スクリプトを node で走らせる。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createNdjsonLineReader,
  runNeMasterDownloadScript,
  neAutoDownloadTargetDefs,
  neAutoDownloadTargetDef,
  evaluateMergedPages,
  findProbeMatches,
  type NeScriptEvent,
  type NeProbeReport,
} from "./auto-download";

describe("createNdjsonLineReader", () => {
  const collect = () => {
    const events: NeScriptEvent[] = [];
    const logs: string[] = [];
    const reader = createNdjsonLineReader({ onEvent: (e) => events.push(e), onLog: (l) => logs.push(l) });
    return { events, logs, reader };
  };

  it("1行1イベントに切り出す", () => {
    const { events, reader } = collect();
    reader.push('{"type":"progress","message":"a"}\n{"type":"done"}\n');
    expect(events).toEqual([{ type: "progress", message: "a" }, { type: "done" }]);
  });

  it("チャンクが行の途中で切れても壊れない", () => {
    const { events, reader } = collect();
    reader.push('{"type":"progr');
    reader.push('ess","message":"分割"}');
    expect(events).toEqual([]); // まだ改行が来ていない
    reader.push("\n");
    expect(events).toEqual([{ type: "progress", message: "分割" }]);
  });

  it("終端の未改行行を flush で取りこぼさない", () => {
    const { events, reader } = collect();
    reader.push('{"type":"progress","message":"最後の行"}');
    expect(events).toEqual([]);
    reader.flush();
    expect(events).toEqual([{ type: "progress", message: "最後の行" }]);
  });

  it("flush は二重に呼んでも重複しない", () => {
    const { events, reader } = collect();
    reader.push('{"type":"done"}');
    reader.flush();
    reader.flush();
    expect(events).toHaveLength(1);
  });

  it("JSON でない行はログとして流す（空行は捨てる）", () => {
    const { events, logs, reader } = collect();
    reader.push("Playwright の警告\n\n{\"type\":\"done\"}\n");
    expect(logs).toEqual(["Playwright の警告"]);
    expect(events).toEqual([{ type: "done" }]);
  });

  it("未知の type はイベントにせずログ扱い", () => {
    const { events, logs, reader } = collect();
    reader.push('{"type":"未知"}\n');
    expect(events).toEqual([]);
    expect(logs).toHaveLength(1);
  });
});

describe("runNeMasterDownloadScript（偽スクリプトで検証）", () => {
  let dir = "";
  const scripts: Record<string, string> = {};

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ne-runner-"));
    // 正常系: 引数を1件目のイベントに載せて返し、終端は未改行で出す（flush の検証を兼ねる）
    scripts.ok = path.join(dir, "ok.mjs");
    await writeFile(
      scripts.ok,
      [
        "const argv = process.argv.slice(2);",
        "process.stdout.write(JSON.stringify({ type: 'progress', message: argv.join(' ') }) + '\\n');",
        "process.stdout.write('素のログ行\\n');",
        "process.stdout.write(JSON.stringify({ type: 'done' }));",
        "process.exit(0);",
      ].join("\n"),
      "utf8",
    );
    // ハング系: 何もせず生き続ける（タイムアウト/中断の検証用）
    scripts.hang = path.join(dir, "hang.mjs");
    await writeFile(scripts.hang, "setInterval(() => {}, 1000);", "utf8");
    // 異常終了系
    scripts.fail = path.join(dir, "fail.mjs");
    await writeFile(scripts.fail, "process.stderr.write('壊れました'); process.exit(2);", "utf8");
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const run = (scriptPath: string, extra: Partial<Parameters<typeof runNeMasterDownloadScript>[0]> = {}) => {
    const events: NeScriptEvent[] = [];
    const logs: string[] = [];
    return {
      events,
      logs,
      promise: runNeMasterDownloadScript({
        scriptPath,
        cwd: dir,
        targets: ["ne-syohin"],
        outDir: dir,
        timeoutMs: 30_000,
        onEvent: (e) => events.push(e),
        onLog: (l) => logs.push(l),
        ...extra,
      }),
    };
  };

  it("--targets / --out-dir / --json / --target-defs を渡し、終端行まで拾う", async () => {
    const { events, logs, promise } = run(scripts.ok);
    const res = await promise;
    expect(res).toMatchObject({ code: 0, timedOut: false, aborted: false });
    const first = events[0] as { type: string; message: string };
    expect(first.message).toContain("--targets ne-syohin");
    expect(first.message).toContain("--out-dir");
    expect(first.message).toContain("--json");
    expect(first.message).toContain("--target-defs");
    expect(first.message).not.toContain("--probe");
    expect(logs).toContain("素のログ行");
    expect(events.at(-1)).toEqual({ type: "done" }); // 未改行の最終行も flush される
  }, 20_000);

  it("mode:probe のときだけ --probe を付ける", async () => {
    const { events, promise } = run(scripts.ok, { mode: "probe" });
    await promise;
    expect((events[0] as { message: string }).message).toContain("--probe");
  }, 20_000);

  it("全体タイムアウトでプロセスを kill し timedOut を返す", async () => {
    const { promise } = run(scripts.hang, { timeoutMs: 800 });
    const res = await promise;
    expect(res.timedOut).toBe(true);
    expect(res.code).not.toBe(0);
  }, 20_000);

  it("abort シグナルでプロセスを kill し aborted を返す", async () => {
    const ac = new AbortController();
    const { promise } = run(scripts.hang, { signal: ac.signal, timeoutMs: 30_000 });
    setTimeout(() => ac.abort(), 300);
    const res = await promise;
    expect(res.aborted).toBe(true);
  }, 20_000);

  it("異常終了時は exit code と stderr を返す", async () => {
    const res = await run(scripts.fail).promise;
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("壊れました");
  }, 20_000);

  it("存在しないスクリプトでも例外を投げず code!=0 を返す", async () => {
    const res = await run(path.join(dir, "not-exist.mjs")).promise;
    expect(res.code).not.toBe(0);
  }, 20_000);
});

describe("対象定義（正本は lib）", () => {
  it("既定値はスクリプトへ渡せる形（DOM 手掛かり込み）で揃っている", () => {
    const defs = neAutoDownloadTargetDefs({});
    expect(defs.map((d) => d.key)).toEqual(["ne-syohin", "ne-set", "ne-himoduke"]);
    const syohin = defs[0];
    expect(syohin.searchTargetTexts).toEqual(["商品情報単位で検索"]);
    expect(syohin.searchTargetValue).toBe("0");
    expect(syohin.containerIds[0]).toBe("search_syouhin_result");
    expect(syohin.fileNames).toContain("syohin_basic");
    expect(() => new RegExp(syohin.panelPattern, syohin.panelPatternFlags)).not.toThrow();
  });

  it("紐づけ表は「ページ情報単位で検索」側を既定にしている（単品のDL画面には無いため）", () => {
    const himoduke = neAutoDownloadTargetDef("ne-himoduke", {})!;
    expect(himoduke.searchTargetTexts).toEqual(["ページ情報単位で検索"]);
    expect(himoduke.searchTargetValue).toBe("2");
  });

  it("env で data-file-name・検索対象・コンテナを上書きできる（NE の画面変更に追従）", () => {
    const defs = neAutoDownloadTargetDefs({
      NE_MASTER_HIMODUKE_FILE: "himoduke_v2, syohin_page",
      NE_MASTER_HIMODUKE_SEARCH_TARGET: "商品情報単位で検索",
      NE_MASTER_HIMODUKE_CONTAINER: "search_syouhin_result",
    });
    const himoduke = defs.find((d) => d.key === "ne-himoduke")!;
    expect(himoduke.fileNames).toEqual(["himoduke_v2", "syohin_page"]);
    expect(himoduke.searchTargetTexts).toEqual(["商品情報単位で検索"]);
    expect(himoduke.containerIds).toEqual(["search_syouhin_result"]);
    // 他の対象は影響を受けない
    expect(defs.find((d) => d.key === "ne-syohin")!.fileNames).toEqual(["syohin_basic"]);
  });

  it("空文字の env は無視して既定値を保つ", () => {
    const defs = neAutoDownloadTargetDefs({ NE_MASTER_SET_FILE: "  ,  " });
    expect(defs.find((d) => d.key === "ne-set")!.fileNames[0]).toBe("set_syohin");
  });

  it("未知のキーは null", () => {
    expect(neAutoDownloadTargetDef("excel-master", {})).toBeNull();
  });
});

describe("evaluateMergedPages（安全側の判定）", () => {
  it("件数もページ数も一致すれば警告なし・取込可", () => {
    expect(evaluateMergedPages({ rows: 775, entries: 775, mergedPages: 1, expectedPages: 1 })).toEqual({
      warnings: [],
      autoImportBlocked: false,
    });
  });

  it("行数が合わなければ自動取込をブロックする", () => {
    const v = evaluateMergedPages({ rows: 1000, entries: 1250, mergedPages: 2, expectedPages: 2 });
    expect(v.autoImportBlocked).toBe(true);
    expect(v.warnings.join()).toMatch(/1250 件/);
  });

  it("ページが足りなければブロックし、欠落と明示する", () => {
    const v = evaluateMergedPages({ rows: 1000, entries: 1250, mergedPages: 1, expectedPages: 2 });
    expect(v.autoImportBlocked).toBe(true);
    expect(v.warnings.join()).toMatch(/欠落/);
  });

  it("ページが多すぎる（重複疑い）場合もブロックする", () => {
    const v = evaluateMergedPages({ rows: 2000, entries: 1250, mergedPages: 3, expectedPages: 2 });
    expect(v.autoImportBlocked).toBe(true);
    expect(v.warnings.join()).toMatch(/重複/);
  });

  it("0行はブロックする（空CSVの取込防止）", () => {
    const v = evaluateMergedPages({ rows: 0, entries: null, mergedPages: 1, expectedPages: 0 });
    expect(v.autoImportBlocked).toBe(true);
    expect(v.warnings.join()).toMatch(/0行/);
  });

  it("件数が読めない（entries=null）ときは行数照合をスキップする", () => {
    expect(evaluateMergedPages({ rows: 10, entries: null, mergedPages: 1, expectedPages: 0 }).autoImportBlocked).toBe(
      false,
    );
  });
});

describe("findProbeMatches", () => {
  const report: NeProbeReport = {
    generatedAt: "2026-07-29T00:00:00.000Z",
    searchTargets: [
      {
        optionText: "商品情報単位で検索",
        optionValue: "0",
        containerId: "search_syouhin_result",
        entries: 775,
        pageItems: 1000,
        countText: "全775件中1-775を表示",
        pagination: { found: true, links: [], html: "" },
        tenpoRadios: [{ value: "0", label: "商品管理", checked: true }],
        perTenpo: [
          {
            value: "0",
            label: "商品管理",
            downloadFiles: [
              { fileName: "syohin_basic", panelHeading: "商品管理CSV（syohin_basic .csv）" },
              { fileName: "syohin_variation", panelHeading: "商品管理バリエーションCSV" },
            ],
            panelHeadings: [],
          },
        ],
      },
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
  };

  it("data-file-name 完全一致で所在を特定する", () => {
    const m = findProbeMatches(report, { fileNames: ["syohin_basic"], panelPattern: "syohin_basic", panelPatternFlags: "i" });
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ optionText: "商品情報単位で検索", tenpoLabel: "商品管理", fileName: "syohin_basic" });
  });

  it("パネル見出しの正規表現でも所在を特定する（紐づけ表の発見経路）", () => {
    const m = findProbeMatches(report, {
      fileNames: ["himoduke"],
      panelPattern: "himo[dz]uke|紐[づ付]け|商品ページ",
      panelPatternFlags: "i",
    });
    expect(m.map((x) => x.optionText)).toEqual(["ページ情報単位で検索"]);
    expect(m[0].fileName).toBe("syohin_page");
  });

  it("どこにも無ければ空配列（UI が「見つかりませんでした」を出す）", () => {
    expect(findProbeMatches(report, { fileNames: ["nope"], panelPattern: "存在しない", panelPatternFlags: "i" })).toEqual(
      [],
    );
  });

  it("壊れた正規表現でも例外にならない", () => {
    expect(() => findProbeMatches(report, { fileNames: [], panelPattern: "([", panelPatternFlags: "i" })).not.toThrow();
  });
});
