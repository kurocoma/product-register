import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { GenreAttribute } from "@/lib/product/genre-attributes";
import { BulkGridEditor } from "./BulkGridEditor";

/** /bulk-register グリッドの React 回帰テスト（jsdom）。📥 読み込みの1クリック統合フローを固定する:
 * - 読み込みで「属性のグリッド列展開」と「YahooカテゴリID/パスの自動適用」が同時に起きる
 *   （対象行＋同じカテゴリIDの行。Yahoo は空欄のみ適用 = ヘッダの一括コピーと同一規則）
 * - Yahoo が手入力済みの行は上書きせず「入力済みのためスキップ」として数える
 * - Yahoo マッピング未解決のカテゴリでも属性展開は成立し、エラーにならない
 * - パネルの手動「この行に適用」「同カテゴリの全行に適用」ボタンは撤去（候補は読み取り専用表示）
 * - ボタン名は凍結テスト互換の「読み込み（属性・Yahoo候補）」を含む新名称 */

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

const rowCell = (n: number) =>
  screen
    .getAllByTitle("クリックすると右のカテゴリ読み込みパネルの対象行になります")
    .find((el) => el.textContent === String(n))!;

const loadButton = () => screen.getByRole("button", { name: /読み込み（属性・Yahoo候補）/ });

const ATTR: GenreAttribute = {
  item_name: "内容量",
  requirement: "必須",
  recommended_unit: "ml",
  unit_choices: "",
  has_unit: true,
  sort_order: 1,
};

const MAPPING = {
  yahoo_category_id: "41383",
  yahoo_category_name: "ソフトドリンク、ジュース",
  yahoo_path: "食品、飲料、製菓＞ソフトドリンク、ジュース",
  confidence: "high",
};

describe("📥 読み込みの統合フロー: 属性展開 + Yahoo自動適用が1クリックで同時に起きる", () => {
  it("対象行＋同カテゴリ行へ属性列展開と YahooカテゴリID/パス適用が同時に入り、件数メッセージが出る", async () => {
    mocks.fetchGenreAttributes.mockResolvedValue([ATTR]);
    mocks.fetchYahooCategoryMapping.mockResolvedValue(MAPPING);
    render(<BulkGridEditor />);

    fireEvent.change(cellInput(0, "mall_category_id"), { target: { value: "110692" } });
    fireEvent.change(cellInput(1, "mall_category_id"), { target: { value: "110692" } }); // 同カテゴリ
    // 3行目はカテゴリ未入力 → 対象外
    fireEvent.click(rowCell(1));
    fireEvent.click(loadButton());

    // 属性展開と Yahoo 適用が同じ1クリックで両方起きる
    await waitFor(() => expect(cellInput(0, "attribute_item_1").value).toBe("内容量"));
    expect(cellInput(0, "yahoo_category_id").value).toBe("41383");
    expect(cellInput(0, "yahoo_path").value).toBe(MAPPING.yahoo_path);
    expect(cellInput(1, "attribute_item_1").value).toBe("内容量");
    expect(cellInput(1, "yahoo_category_id").value).toBe("41383");
    // カテゴリ未入力の行はどちらも入らない
    expect(cellInput(2, "attribute_item_1").value).toBe("");
    expect(cellInput(2, "yahoo_category_id").value).toBe("");

    // 件数メッセージ（属性件数＋Yahoo適用/スキップ行数）
    expect(screen.getByText(/商品属性1件を展開/)).toBeInTheDocument();
    expect(screen.getByText(/YahooカテゴリID 41383 を2行に適用（0行は入力済みのためスキップ）/)).toBeInTheDocument();
  });

  it("Yahoo が手入力済みの行は上書きせず、スキップとして数える（空欄のみ適用 = 手入力優先）", async () => {
    mocks.fetchGenreAttributes.mockResolvedValue([ATTR]);
    mocks.fetchYahooCategoryMapping.mockResolvedValue(MAPPING);
    render(<BulkGridEditor />);

    fireEvent.change(cellInput(0, "mall_category_id"), { target: { value: "110692" } });
    fireEvent.change(cellInput(0, "yahoo_category_id"), { target: { value: "99999" } }); // 手入力済み
    fireEvent.change(cellInput(0, "yahoo_path"), { target: { value: "手入力＞パス" } });
    fireEvent.change(cellInput(1, "mall_category_id"), { target: { value: "110692" } });
    fireEvent.click(rowCell(1));
    fireEvent.click(loadButton());

    await waitFor(() => expect(cellInput(1, "yahoo_category_id").value).toBe("41383"));
    // 手入力済みの対象行は上書きしない（属性は展開される）
    expect(cellInput(0, "yahoo_category_id").value).toBe("99999");
    expect(cellInput(0, "yahoo_path").value).toBe("手入力＞パス");
    expect(cellInput(0, "attribute_item_1").value).toBe("内容量");
    expect(screen.getByText(/を1行に適用（1行は入力済みのためスキップ）/)).toBeInTheDocument();
  });

  it("Yahoo マッピング未解決のカテゴリでも属性展開は成立し、エラーにせず候補なしを案内する", async () => {
    mocks.fetchGenreAttributes.mockResolvedValue([ATTR]);
    mocks.fetchYahooCategoryMapping.mockResolvedValue(null);
    render(<BulkGridEditor />);

    fireEvent.change(cellInput(0, "mall_category_id"), { target: { value: "110692" } });
    fireEvent.click(rowCell(1));
    fireEvent.click(loadButton());

    await waitFor(() => expect(cellInput(0, "attribute_item_1").value).toBe("内容量"));
    expect(cellInput(0, "attribute_unit_1").value).toBe("ml");
    expect(cellInput(0, "yahoo_category_id").value).toBe(""); // 適用なし・エラーなし
    expect(screen.getByText(/商品属性1件を展開/)).toBeInTheDocument();
    expect(screen.getByText(/Yahooカテゴリ候補なし/)).toBeInTheDocument();
    expect(screen.queryByText(/読み込みに失敗しました/)).not.toBeInTheDocument();
  });
});

describe("パネルの Yahoo 手動適用 UI の撤去（自動適用へ統合）", () => {
  it("「この行に適用」「同カテゴリの全行に適用」ボタンは無く、候補は読み取り専用表示＋自動適用済みの案内になる", async () => {
    mocks.fetchGenreAttributes.mockResolvedValue([ATTR]);
    mocks.fetchYahooCategoryMapping.mockResolvedValue(MAPPING);
    render(<BulkGridEditor />);

    fireEvent.change(cellInput(0, "mall_category_id"), { target: { value: "110692" } });
    fireEvent.change(cellInput(1, "mall_category_id"), { target: { value: "110692" } });
    fireEvent.click(rowCell(1));
    fireEvent.click(loadButton());

    await waitFor(() => expect(cellInput(0, "yahoo_category_id").value).toBe("41383"));
    expect(screen.queryByRole("button", { name: "この行に適用" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "同カテゴリの全行に適用" })).not.toBeInTheDocument();
    // 候補は読み取り専用で確認でき、自動適用済みの案内が出る
    expect(screen.getByText("41383")).toBeInTheDocument();
    expect(screen.getByText(/自動適用済み/)).toBeInTheDocument();
  });

  it("ボタン名は統合フローが分かる新名称（凍結テスト互換の「読み込み（属性・Yahoo候補）」を含む）", () => {
    mocks.fetchYahooCategoryMapping.mockResolvedValue(null);
    render(<BulkGridEditor />);
    expect(
      screen.getByRole("button", { name: "📥 読み込み（属性・Yahoo候補）→ 行へ自動適用" }),
    ).toBeInTheDocument();
  });
});
