import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { GenreAttribute } from "@/lib/product/genre-attributes";
import { BulkGridEditor } from "./BulkGridEditor";

/** /bulk-register グリッドの React 回帰テスト（jsdom）。属性のグリッド列展開の改修を固定する:
 * 1) 📥 読み込みで属性の項目・単位が右パネルではなくグリッドの商品属性列（attribute_item_N /
 *    attribute_unit_N）へ展開され、同じカテゴリIDの行にもまとめて適用される。
 *    パネルは値入力リストではなく「値は行内で入力」の案内になる（値入力はグリッド側だけ）。
 * 2) カテゴリ列グループ見出しの「YahooカテゴリIDをコピー」で、全行のモール基本カテゴリIDから
 *    YahooカテゴリID/パスが空欄の行にだけ一括適用され、「n 行に適用（m 行は入力済みのためスキップ）」
 *    が表示される。 */

// fetch 層だけ差し替える（純関数は実物のまま）
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

const attr = (item_name: string, requirement: string, recommended_unit = ""): GenreAttribute => ({
  item_name,
  requirement,
  recommended_unit,
  unit_choices: "",
  has_unit: recommended_unit !== "",
  sort_order: 0,
});

describe("📥 読み込み: 属性をグリッドの商品属性列へ展開（同カテゴリの行にも適用）", () => {
  it("項目・単位が対象行と同じカテゴリIDの行の attribute 列へ入り、値はグリッドの行内で入力する", async () => {
    mocks.fetchGenreAttributes.mockResolvedValue([attr("内容量", "必須", "ml"), attr("ブランド名", "任意")]);
    mocks.fetchYahooCategoryMapping.mockResolvedValue(null);
    render(<BulkGridEditor />);

    fireEvent.change(cellInput(0, "mall_category_id"), { target: { value: "110692" } });
    fireEvent.change(cellInput(1, "mall_category_id"), { target: { value: "110692" } }); // 同カテゴリ
    fireEvent.change(cellInput(2, "mall_category_id"), { target: { value: "999999" } }); // 別カテゴリ
    // 対象行 = 1行目（最後のセル操作は3行目なので、行番号クリックで戻す）
    const rowCell = (n: number) =>
      screen
        .getAllByTitle("クリックすると右のカテゴリ読み込みパネルの対象行になります")
        .find((el) => el.textContent === String(n))!;
    fireEvent.click(rowCell(1));
    fireEvent.click(screen.getByRole("button", { name: /読み込み（属性・Yahoo候補）/ }));

    await waitFor(() => expect(cellInput(0, "attribute_item_1").value).toBe("内容量"));
    expect(cellInput(0, "attribute_unit_1").value).toBe("ml"); // 推奨単位プリフィル
    expect(cellInput(0, "attribute_value_1").value).toBe(""); // 値は行内で入力
    expect(cellInput(0, "attribute_item_2").value).toBe("ブランド名");
    // 同じカテゴリIDの行にも展開される
    expect(cellInput(1, "attribute_item_1").value).toBe("内容量");
    expect(cellInput(1, "attribute_unit_1").value).toBe("ml");
    // 別カテゴリの行はそのまま
    expect(cellInput(2, "attribute_item_1").value).toBe("");

    // パネルは値入力リストではなく案内になる（値入力欄はグリッド側だけ = 2行 × 2項目分）
    expect(screen.getByText(/値は行内で入力してください/)).toBeInTheDocument();
    expect(document.querySelector('aside input[placeholder="値"]')).toBeNull();
    expect(screen.getAllByPlaceholderText("値")).toHaveLength(4);
  });

  it("6件目以降の属性は切り捨てられ、パネルに「n件は編集画面で入力」の案内が出る", async () => {
    mocks.fetchGenreAttributes.mockResolvedValue([
      attr("必須1", "必須", "ml"), attr("任意1", "任意"), attr("任意2", "任意"),
      attr("任意3", "任意"), attr("任意4", "任意"), attr("任意5", "任意"), attr("任意6", "任意"),
    ]);
    mocks.fetchYahooCategoryMapping.mockResolvedValue(null);
    render(<BulkGridEditor />);

    fireEvent.change(cellInput(0, "mall_category_id"), { target: { value: "110692" } });
    fireEvent.click(screen.getByRole("button", { name: /読み込み（属性・Yahoo候補）/ }));

    await waitFor(() => expect(cellInput(0, "attribute_item_1").value).toBe("必須1"));
    expect(cellInput(0, "attribute_item_5").value).toBe("任意4");
    expect(screen.getByText(/6件目以降の属性: 2件は編集画面で入力/)).toBeInTheDocument();
  });
});

describe("カテゴリ列グループ見出しの「YahooカテゴリIDをコピー」", () => {
  it("全行のカテゴリIDから解決し、空欄の行のみ適用して「n 行に適用（m 行は入力済みのためスキップ）」を表示する", async () => {
    mocks.fetchYahooCategoryMapping.mockResolvedValue({
      yahoo_category_id: "13457",
      yahoo_category_name: "ソフトドリンク、ジュース",
      yahoo_path: "食品、飲料、製菓＞ソフトドリンク、ジュース",
      confidence: "high",
    });
    render(<BulkGridEditor />);

    fireEvent.change(cellInput(0, "mall_category_id"), { target: { value: "110692" } });
    fireEvent.change(cellInput(1, "mall_category_id"), { target: { value: "110692" } });
    // 2行目は手入力済み（ID・パスとも）→ スキップされる
    fireEvent.change(cellInput(1, "yahoo_category_id"), { target: { value: "99999" } });
    fireEvent.change(cellInput(1, "yahoo_path"), { target: { value: "手入力＞パス" } });

    fireEvent.click(screen.getByRole("button", { name: "YahooカテゴリIDをコピー" }));

    await waitFor(() => expect(cellInput(0, "yahoo_category_id").value).toBe("13457"));
    expect(cellInput(0, "yahoo_path").value).toBe("食品、飲料、製菓＞ソフトドリンク、ジュース");
    // 手入力済みの行は上書きしない
    expect(cellInput(1, "yahoo_category_id").value).toBe("99999");
    expect(cellInput(1, "yahoo_path").value).toBe("手入力＞パス");
    // ユニーク集合で解決する（同じIDは1回だけ fetch）
    expect(mocks.fetchYahooCategoryMapping).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/1 行に適用（1 行は入力済みのためスキップ）/)).toBeInTheDocument();
  });

  it("カテゴリID未入力のときは案内を出して何もしない", async () => {
    mocks.fetchYahooCategoryMapping.mockResolvedValue(null);
    render(<BulkGridEditor />);
    fireEvent.click(screen.getByRole("button", { name: "YahooカテゴリIDをコピー" }));
    await waitFor(() =>
      expect(screen.getByText(/モール基本カテゴリIDが入力された行がありません/)).toBeInTheDocument(),
    );
    expect(mocks.fetchYahooCategoryMapping).not.toHaveBeenCalled();
  });
});
