import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { GenreAttribute } from "@/lib/product/genre-attributes";
import { BulkGridEditor } from "./BulkGridEditor";

/** /bulk-register グリッドの React 回帰テスト（jsdom）。
 * 【置換履歴】カテゴリ読み込みパネル廃止（ユーザー明示指示）に伴い、パネル経由だった
 * turn-003 の不変量を、統合「📥 カテゴリ読み込み（属性・YahooID）」ボタンの新フローへ移植した。
 * 検証する不変量は従来と同一 — 読み込みの書き戻しはクリック時に捕捉した「配列 index」ではなく
 * 行の uid で対象行を特定する:
 * 1) fetch 中に対象行より上の行を削除して index が繰り上がっても、属性は元の対象行へ
 *    正しく反映される（index ずれによる別の行への誤書き込み防止）
 * 2) fetch 中に対象行自体を削除したときは、どの行にも書き込まず無害に何もしない */

// fetch 層だけ差し替える（純関数 attributesToColumns / applyCategoryLoadToRow は実物のまま）
const mocks = vi.hoisted(() => ({
  fetchGenreAttributes: vi.fn(),
  fetchYahooCategoryMapping: vi.fn(),
}));
vi.mock("@/lib/product/genre-attributes", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchGenreAttributes: mocks.fetchGenreAttributes,
}));
vi.mock("@/lib/product/category-mapping", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchYahooCategoryMapping: mocks.fetchYahooCategoryMapping,
}));
// supabase / 保存系はこのテストでは呼ばれない（jsdom で読み込めるようスタブ化のみ）
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/product/repository", () => ({ upsertProduct: vi.fn(), deleteProduct: vi.fn() }));
vi.mock("@/lib/product/bulk-save", () => ({ saveGroupWithCleanup: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const cellInput = (row: number, key: string) =>
  document.getElementById(`bulkgrid-${row}-${key}`) as HTMLInputElement;
const rowCount = () => document.querySelectorAll("tbody tr").length;

/** N 行目の「✕」（行削除）ボタン */
const removeRowButton = (n: number) => screen.getAllByTitle("この行を削除")[n - 1];

/** 統合カテゴリ読み込みボタン（カテゴリ列グループ見出し） */
const loadButton = () => screen.getByRole("button", { name: /カテゴリ読み込み（属性・YahooID）/ });

/** 解決タイミングを手動制御できる Promise（fetch 中の行削除を確実に再現するため） */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const ATTR: GenreAttribute = {
  item_name: "内容量",
  requirement: "必須",
  recommended_unit: "ml",
  unit_choices: "",
  has_unit: true,
  sort_order: 1,
};

describe("統合カテゴリ読み込み: 書き戻し先を uid で特定（fetch 中の行削除で index がずれても誤書き込みしない）", () => {
  it("読み込み中に対象行より上の行を削除 → 属性は繰り上がった正しい行（uid）へ反映される", async () => {
    const d = deferred<GenreAttribute[]>();
    mocks.fetchGenreAttributes.mockReturnValue(d.promise);
    mocks.fetchYahooCategoryMapping.mockResolvedValue(null);
    render(<BulkGridEditor />);

    // 1行目=上の行 / 2行目=対象行（カテゴリID入り）/ 3行目=下の行 と名前を付ける
    fireEvent.change(cellInput(0, "product_name"), { target: { value: "上の行" } });
    fireEvent.change(cellInput(1, "product_name"), { target: { value: "属性対象の商品" } });
    fireEvent.change(cellInput(1, "mall_category_id"), { target: { value: "110692" } });
    fireEvent.change(cellInput(2, "product_name"), { target: { value: "下の行" } });

    // 統合ボタンで読み込み（fetch は未解決のまま保留）
    fireEvent.click(loadButton());
    expect(mocks.fetchGenreAttributes).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /読み込み中…/ })).toBeInTheDocument();

    // fetch 中に対象行より上の 1 行目を削除 → 対象行は 2 行目から 1 行目に繰り上がる
    fireEvent.click(removeRowButton(1));
    expect(rowCount()).toBe(2);
    expect(cellInput(0, "product_name").value).toBe("属性対象の商品");
    expect(cellInput(1, "product_name").value).toBe("下の行");

    // fetch 完了 → 属性は「クリック時の index=1（今は下の行の位置）」ではなく、対象行（uid）へ入る
    await act(async () => {
      d.resolve([ATTR]);
    });
    await waitFor(() => expect(cellInput(0, "attribute_item_1").value).toBe("内容量"));
    expect(cellInput(0, "attribute_unit_1").value).toBe("ml");

    // 誤書き込みの検査: 下の行（2行目）には属性が入らない
    expect(cellInput(1, "attribute_item_1").value).toBe("");
    // 行データ自体も無傷（カテゴリID・商品名が対象行に残っている）
    expect(cellInput(0, "mall_category_id").value).toBe("110692");
    expect(cellInput(0, "product_name").value).toBe("属性対象の商品");
    expect(cellInput(1, "product_name").value).toBe("下の行");
  });

  it("読み込み中に対象行自体を削除 → どの行にも属性を書き込まず無害に何もしない", async () => {
    const d = deferred<GenreAttribute[]>();
    mocks.fetchGenreAttributes.mockReturnValue(d.promise);
    mocks.fetchYahooCategoryMapping.mockResolvedValue(null);
    render(<BulkGridEditor />);

    // 1行目=消える行（カテゴリID入り）/ 2行目=残る行
    fireEvent.change(cellInput(0, "product_name"), { target: { value: "消える行" } });
    fireEvent.change(cellInput(0, "mall_category_id"), { target: { value: "110692" } });
    fireEvent.change(cellInput(1, "product_name"), { target: { value: "残る行" } });

    fireEvent.click(loadButton());
    expect(mocks.fetchGenreAttributes).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /読み込み中…/ })).toBeInTheDocument();

    // fetch 中に対象行（1行目）自体を削除 → 「残る行」が 1 行目に繰り上がる
    fireEvent.click(removeRowButton(1));
    expect(rowCount()).toBe(2);
    expect(cellInput(0, "product_name").value).toBe("残る行");

    // fetch 完了 → クラッシュせず、繰り上がった「残る行」にも属性が入らない（index=0 への誤書き込み防止）
    await act(async () => {
      d.resolve([ATTR]);
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /カテゴリ読み込み（属性・YahooID）/ })).toBeInTheDocument(),
    );
    expect(cellInput(0, "attribute_item_1").value).toBe("");
    expect(cellInput(1, "attribute_item_1").value).toBe("");

    // 残った行のデータは無傷（属性以外も書き換わっていない）
    expect(cellInput(0, "product_name").value).toBe("残る行");
    expect(cellInput(0, "mall_category_id").value).toBe("");
  });
});
