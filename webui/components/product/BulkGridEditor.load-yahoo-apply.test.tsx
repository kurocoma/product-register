import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { GenreAttribute } from "@/lib/product/genre-attributes";
import { BulkGridEditor } from "./BulkGridEditor";

/** /bulk-register グリッドの React 回帰テスト（jsdom）。
 * 【置換履歴】カテゴリ読み込みパネル廃止（ユーザー明示指示）に伴い、パネルの統合フローで
 * 検証していた不変量を、カテゴリ列グループ見出しの統合「📥 カテゴリ読み込み（属性・YahooID）」
 * ボタン（機能A: YahooID/パス適用 + 機能B: 属性の行単位展開）へ移植した:
 * - 属性展開と Yahoo 適用が同じ1クリックで同時に起きる
 * - Yahoo が手入力済みの行は上書きせず「入力済みスキップ」として数える（空欄のみ適用）
 * - Yahoo マッピングも属性も無い未解決カテゴリがあっても、他行の処理は継続しエラーにしない
 * - 旧パネル（📥 カテゴリ読み込みパネル / aside）は存在しない */

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

const loadButton = () => screen.getByRole("button", { name: /カテゴリ読み込み（属性・YahooID）/ });

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

describe("📥 カテゴリ読み込み: 属性展開（機能B）と Yahoo 適用（機能A）が1クリックで同時に起きる", () => {
  it("カテゴリID入りの全行へ属性列展開と YahooカテゴリID/パス適用が同時に入り、件数メッセージが出る", async () => {
    mocks.fetchGenreAttributes.mockResolvedValue([ATTR]);
    mocks.fetchYahooCategoryMapping.mockResolvedValue(MAPPING);
    render(<BulkGridEditor />);

    fireEvent.change(cellInput(0, "mall_category_id"), { target: { value: "110692" } });
    fireEvent.change(cellInput(1, "mall_category_id"), { target: { value: "110692" } });
    // 3行目はカテゴリ未入力 → 対象外
    fireEvent.click(loadButton());

    // 属性展開と Yahoo 適用が同じ1クリックで両方起きる
    await waitFor(() => expect(cellInput(0, "attribute_item_1").value).toBe("内容量"));
    expect(cellInput(0, "attribute_unit_1").value).toBe("ml");
    expect(cellInput(0, "yahoo_category_id").value).toBe("41383");
    expect(cellInput(0, "yahoo_path").value).toBe(MAPPING.yahoo_path);
    expect(cellInput(1, "attribute_item_1").value).toBe("内容量");
    expect(cellInput(1, "yahoo_category_id").value).toBe("41383");
    // カテゴリ未入力の行はどちらも入らない
    expect(cellInput(2, "attribute_item_1").value).toBe("");
    expect(cellInput(2, "yahoo_category_id").value).toBe("");

    // 件数メッセージ（カテゴリ種数／属性行数／Yahoo適用・スキップ行数／未解決）
    expect(
      screen.getByText(/カテゴリ1種を読み込み: 属性を2行に展開／YahooID を2行に適用（0行は入力済みスキップ）／未解決カテゴリ: なし/),
    ).toBeInTheDocument();
  });

  it("Yahoo が手入力済みの行は上書きせず、スキップとして数える（属性は展開される）", async () => {
    mocks.fetchGenreAttributes.mockResolvedValue([ATTR]);
    mocks.fetchYahooCategoryMapping.mockResolvedValue(MAPPING);
    render(<BulkGridEditor />);

    fireEvent.change(cellInput(0, "mall_category_id"), { target: { value: "110692" } });
    fireEvent.change(cellInput(0, "yahoo_category_id"), { target: { value: "99999" } }); // 手入力済み
    fireEvent.change(cellInput(0, "yahoo_path"), { target: { value: "手入力＞パス" } });
    fireEvent.change(cellInput(1, "mall_category_id"), { target: { value: "110692" } });
    fireEvent.click(loadButton());

    await waitFor(() => expect(cellInput(1, "yahoo_category_id").value).toBe("41383"));
    // 手入力済みの行は上書きしない（属性は展開される）
    expect(cellInput(0, "yahoo_category_id").value).toBe("99999");
    expect(cellInput(0, "yahoo_path").value).toBe("手入力＞パス");
    expect(cellInput(0, "attribute_item_1").value).toBe("内容量");
    expect(screen.getByText(/YahooID を1行に適用（1行は入力済みスキップ）/)).toBeInTheDocument();
  });

  it("未解決カテゴリ（属性もYahooも無し）があっても他行の処理は継続し、エラーにしない", async () => {
    mocks.fetchGenreAttributes.mockImplementation(async (_supabase: unknown, id: string) =>
      id === "110692" ? [ATTR] : [],
    );
    mocks.fetchYahooCategoryMapping.mockImplementation(async (_supabase: unknown, id: string) =>
      id === "110692" ? MAPPING : null,
    );
    render(<BulkGridEditor />);

    fireEvent.change(cellInput(0, "mall_category_id"), { target: { value: "999999" } }); // 未解決
    fireEvent.change(cellInput(1, "mall_category_id"), { target: { value: "110692" } }); // 解決

    fireEvent.click(loadButton());

    // 解決カテゴリの行は処理が継続する
    await waitFor(() => expect(cellInput(1, "attribute_item_1").value).toBe("内容量"));
    expect(cellInput(1, "yahoo_category_id").value).toBe("41383");
    // 未解決カテゴリの行は変わらない（エラーにもならない）
    expect(cellInput(0, "attribute_item_1").value).toBe("");
    expect(cellInput(0, "yahoo_category_id").value).toBe("");
    expect(screen.getByText(/未解決カテゴリ: 999999/)).toBeInTheDocument();
    expect(screen.queryByText(/読み込みに失敗しました/)).not.toBeInTheDocument();
  });
});

describe("カテゴリ読み込みパネルの廃止（統合ボタンへ一本化）", () => {
  it("統合ボタンがカテゴリ列グループ見出しにあり、旧パネル（aside・旧ボタン）は存在しない", () => {
    mocks.fetchYahooCategoryMapping.mockResolvedValue(null);
    render(<BulkGridEditor />);
    expect(
      screen.getByRole("button", { name: "📥 カテゴリ読み込み（属性・YahooID）" }),
    ).toBeInTheDocument();
    // 旧パネルとその操作 UI が無い
    expect(document.querySelector("aside")).toBeNull();
    expect(screen.queryByText(/カテゴリ読み込みパネル/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /読み込み（属性・Yahoo候補）/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "YahooカテゴリIDをコピー" })).not.toBeInTheDocument();
  });
});
