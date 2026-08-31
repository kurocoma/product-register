/** モール取込パネルの「まとめて取込」（260901追記: 検索候補にチェックを付けて一括取込）の回帰テスト。
 *  - 選択した候補だけを1件ずつ順番に既存の取込API（POST /api/import/[mall]）へ送る
 *  - 行別に 新規/既存/失敗 を表示し、編集画面へは遷移しない（完了後に一覧を refresh）
 *  - 単体の「取込んで編集」は従来どおり編集画面へ遷移する */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MallImportByCode } from "./MallImportByCode";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

type FetchCall = { url: string; body?: { code?: string } };
let calls: FetchCall[] = [];

/** 検索は3候補を返し、取込は a1=新規 / a2=既存 / a3=失敗 を返すスタブ。 */
function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      const json = (data: unknown, ok = true) => ({ ok, status: ok ? 200 : 404, json: async () => data }) as Response;
      if (url.includes("/search?")) {
        return json({
          ok: true,
          results: [
            { code: "a1", name: "商品A" },
            { code: "a2", name: "商品B" },
            { code: "a3", name: "商品C" },
          ],
        });
      }
      if (body?.code === "a1") return json({ ok: true, existed: false, productId: "p1" });
      if (body?.code === "a2") return json({ ok: true, existed: true, productId: "p2" });
      return json({ ok: false, error: "楽天に見つかりません" }, false);
    }),
  );
}

beforeEach(() => {
  calls = [];
  push.mockClear();
  refresh.mockClear();
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** 検索を実行して候補3件を表示させる共通手順。 */
async function searchThreeResults() {
  render(<MallImportByCode />);
  fireEvent.change(screen.getByPlaceholderText(/商品管理番号/), { target: { value: "シークワーサー" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "🔍 商品名で検索" }));
  });
  expect(screen.getByText("検索結果 3件")).toBeInTheDocument();
}

describe("まとめて取込", () => {
  it("チェックした候補だけを順番に取込み、行別結果と集計を表示して一覧を refresh する", async () => {
    await searchThreeResults();

    // すべて選択 → 3件が対象になる
    await act(async () => {
      fireEvent.click(screen.getByLabelText("すべて選択"));
    });
    const bulkButton = screen.getByRole("button", { name: "選択した 3 件をまとめて取込" });

    await act(async () => {
      fireEvent.click(bulkButton);
    });

    // 取込APIは選択した3件ぶん（検索1回 + 取込3回）
    const importCalls = calls.filter((c) => c.body?.code);
    expect(importCalls.map((c) => c.body)).toEqual([{ code: "a1" }, { code: "a2" }, { code: "a3" }]);

    // 行別の結果表示
    await waitFor(() => {
      expect(screen.getByText("✓ 新規作成")).toBeInTheDocument();
      expect(screen.getByText("✓ 既存あり")).toBeInTheDocument();
      expect(screen.getByText(/楽天に見つかりません/)).toBeInTheDocument();
    });

    // 集計メッセージ + 一覧の更新。編集画面へは遷移しない
    expect(screen.getByText(/新規 1 件 \/ 既存 1 件 \/ 失敗 1 件/)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("個別チェックで対象を絞れる（未選択ならボタンは無効）", async () => {
    await searchThreeResults();

    expect(screen.getByRole("button", { name: "選択した 0 件をまとめて取込" })).toBeDisabled();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("選択（a2）"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "選択した 1 件をまとめて取込" }));
    });

    const importCalls = calls.filter((c) => c.body?.code);
    expect(importCalls.map((c) => c.body)).toEqual([{ code: "a2" }]);
    expect(screen.getByText("✓ 既存あり")).toBeInTheDocument();
  });

  it("単体の「取込んで編集」は従来どおり編集画面へ遷移する", async () => {
    await searchThreeResults();

    const rowButtons = screen.getAllByRole("button", { name: "取込んで編集" });
    // 先頭はフォーム送信ボタン以外＝候補行のボタン（a1 行）
    await act(async () => {
      fireEvent.click(rowButtons[rowButtons.length - 3]);
    });
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/products/p1");
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
