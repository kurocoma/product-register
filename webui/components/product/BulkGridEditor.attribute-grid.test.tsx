import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { GenreAttribute } from "@/lib/product/genre-attributes";
import { BulkGridEditor } from "./BulkGridEditor";

/** /bulk-register グリッドの React 回帰テスト（jsdom）。
 * 【置換履歴】カテゴリ読み込みパネル廃止（ユーザー明示指示）に伴い、パネルの「📥 読み込み」で
 * 検証していた属性のグリッド列展開を、統合「📥 カテゴリ読み込み（属性・YahooID）」ボタンの
 * 新フロー（全行を行単位で処理）へ移植した。固定する仕様:
 * 1) 各行の モール基本カテゴリID に基づき、その行の商品属性列（attribute_item_N /
 *    attribute_unit_N）へ項目・単位が行単位で展開される（カテゴリ違いは混ざらない。
 *    値セルは項目入り枠だけ「値」プレースホルダを出し、値は行内で入力する）
 * 2) 6件目以降の属性は top5 に切り捨てられ、結果メッセージで編集画面での入力を案内する
 * 3) YahooカテゴリID/パスは空欄の行のみ適用（手入力優先）で、ユニークIDは1回だけ fetch
 * 4) カテゴリID未入力なら案内を出して何もしない */

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

const attr = (item_name: string, requirement: string, recommended_unit = ""): GenreAttribute => ({
  item_name,
  requirement,
  recommended_unit,
  unit_choices: "",
  has_unit: recommended_unit !== "",
  sort_order: 0,
});

describe("📥 カテゴリ読み込み: 属性を行単位でグリッドの商品属性列へ展開", () => {
  it("各行の自分のカテゴリIDの項目・単位が入り、カテゴリ違いは混ざらない（値は行内で入力）", async () => {
    mocks.fetchGenreAttributes.mockImplementation(async (_supabase: unknown, id: string) =>
      id === "110692"
        ? [attr("内容量", "必須", "ml"), attr("ブランド名", "任意")]
        : id === "999999"
          ? [attr("産地", "必須")]
          : [],
    );
    mocks.fetchYahooCategoryMapping.mockResolvedValue(null);
    render(<BulkGridEditor />);

    fireEvent.change(cellInput(0, "mall_category_id"), { target: { value: "110692" } });
    fireEvent.change(cellInput(1, "mall_category_id"), { target: { value: "110692" } });
    fireEvent.change(cellInput(2, "mall_category_id"), { target: { value: "999999" } }); // 別カテゴリ
    fireEvent.click(loadButton());

    await waitFor(() => expect(cellInput(0, "attribute_item_1").value).toBe("内容量"));
    expect(cellInput(0, "attribute_unit_1").value).toBe("ml"); // 推奨単位プリフィル
    expect(cellInput(0, "attribute_value_1").value).toBe(""); // 値は行内で入力
    expect(cellInput(0, "attribute_item_2").value).toBe("ブランド名");
    expect(cellInput(1, "attribute_item_1").value).toBe("内容量");
    // 別カテゴリの行は自分のカテゴリの属性（行単位。カテゴリ違いは混ざらない）
    expect(cellInput(2, "attribute_item_1").value).toBe("産地");
    expect(cellInput(2, "attribute_item_2").value).toBe("");

    // ユニークなカテゴリIDごとに1回だけ fetch する
    expect(mocks.fetchGenreAttributes).toHaveBeenCalledTimes(2);
    // 値セルのプレースホルダは項目が入った枠だけ（2行×2項目 + 1行×1項目 = 5）
    expect(screen.getAllByPlaceholderText("値")).toHaveLength(5);
    // 結果メッセージ（種数と展開行数）
    expect(screen.getByText(/カテゴリ2種を読み込み: 属性を3行に展開/)).toBeInTheDocument();
  });

  it("6件目以降の属性は top5（必須優先）に切り捨て、編集画面での入力を案内する", async () => {
    mocks.fetchGenreAttributes.mockResolvedValue([
      attr("必須1", "必須", "ml"), attr("任意1", "任意"), attr("任意2", "任意"),
      attr("任意3", "任意"), attr("任意4", "任意"), attr("任意5", "任意"), attr("任意6", "任意"),
    ]);
    mocks.fetchYahooCategoryMapping.mockResolvedValue(null);
    render(<BulkGridEditor />);

    fireEvent.change(cellInput(0, "mall_category_id"), { target: { value: "110692" } });
    fireEvent.click(loadButton());

    await waitFor(() => expect(cellInput(0, "attribute_item_1").value).toBe("必須1"));
    expect(cellInput(0, "attribute_item_5").value).toBe("任意4");
    expect(screen.getByText(/6件目以降の属性は保存後に編集画面で入力/)).toBeInTheDocument();
  });
});

describe("📥 カテゴリ読み込み: Yahoo は空欄の行のみ適用（手入力優先）", () => {
  it("空欄の行に適用し、手入力済みの行はスキップとして数える（ユニークIDは1回だけ fetch）", async () => {
    mocks.fetchGenreAttributes.mockResolvedValue([]);
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

    fireEvent.click(loadButton());

    await waitFor(() => expect(cellInput(0, "yahoo_category_id").value).toBe("13457"));
    expect(cellInput(0, "yahoo_path").value).toBe("食品、飲料、製菓＞ソフトドリンク、ジュース");
    // 手入力済みの行は上書きしない
    expect(cellInput(1, "yahoo_category_id").value).toBe("99999");
    expect(cellInput(1, "yahoo_path").value).toBe("手入力＞パス");
    // ユニーク集合で解決する（同じIDは1回だけ fetch）
    expect(mocks.fetchYahooCategoryMapping).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/YahooID を1行に適用（1行は入力済みスキップ）/)).toBeInTheDocument();
  });

  it("カテゴリID未入力のときは案内を出して何もしない", async () => {
    mocks.fetchGenreAttributes.mockResolvedValue([]);
    mocks.fetchYahooCategoryMapping.mockResolvedValue(null);
    render(<BulkGridEditor />);
    fireEvent.click(loadButton());
    await waitFor(() =>
      expect(screen.getByText(/モール基本カテゴリIDが入力された行がありません/)).toBeInTheDocument(),
    );
    expect(mocks.fetchGenreAttributes).not.toHaveBeenCalled();
    expect(mocks.fetchYahooCategoryMapping).not.toHaveBeenCalled();
  });
});
