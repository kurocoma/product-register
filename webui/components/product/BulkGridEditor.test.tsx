import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { GenreAttribute } from "@/lib/product/genre-attributes";
import { BulkGridEditor } from "./BulkGridEditor";

/** /bulk-register グリッドの React 回帰テスト（jsdom）。turn-002 の堅牢性修正2件を固定する:
 * 1) カテゴリ読み込みパネルの fetch 中にグリッド側で同じ行を編集しても、fetch 完了時の
 *    書き戻し（関数型更新）で編集が巻き戻らない（競合窓の解消）
 * 2) 「Excel から貼り付け取込」枠に1列コピーを貼っても表取込（parseTsv）へ流れず、
 *    セルへ直接貼る案内を出す（NEコード列として誤解釈される誤操作の防止）。
 *    表全体（複数列）のコピーは従来どおり行として取り込まれる（回帰）。 */

// fetch 層だけ差し替える（純関数 genreAttributesToInputs / isRequiredAttribute は実物のまま）
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

/** 解決タイミングを手動制御できる Promise（fetch 中の競合を確実に再現するため） */
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

describe("カテゴリ読み込みパネル: fetch 中の行編集が巻き戻らない（関数型更新）", () => {
  it("読み込み中にグリッドで商品名を編集 → fetch 完了後も編集が保持され、属性も展開される", async () => {
    const d = deferred<GenreAttribute[]>();
    mocks.fetchGenreAttributes.mockReturnValue(d.promise);
    mocks.fetchYahooCategoryMapping.mockResolvedValue(null);
    render(<BulkGridEditor />);

    // 1行目にカテゴリIDを入れて「読み込み」（fetch は未解決のまま保留）
    fireEvent.change(cellInput(0, "mall_category_id"), { target: { value: "110692" } });
    fireEvent.click(screen.getByRole("button", { name: /読み込み（属性・Yahoo候補）/ }));
    expect(mocks.fetchGenreAttributes).toHaveBeenCalledTimes(1);

    // fetch 中（読み込み中…表示）にユーザーが同じ行の商品名を編集する
    expect(screen.getByRole("button", { name: /読み込み中…/ })).toBeInTheDocument();
    fireEvent.change(cellInput(0, "product_name"), { target: { value: "編集中の商品名" } });

    // fetch 完了 → パネルに属性の項目が並ぶ
    await act(async () => {
      d.resolve([ATTR]);
    });
    await waitFor(() => expect(screen.getByTitle("内容量")).toBeInTheDocument());
    expect(screen.getByPlaceholderText("値")).toBeInTheDocument();

    // 競合窓の回帰: fetch 開始時の行（商品名が空）で上書きされず、編集が残る
    expect(cellInput(0, "product_name").value).toBe("編集中の商品名");
    // カテゴリIDもそのまま（行データ全体が巻き戻っていない）
    expect(cellInput(0, "mall_category_id").value).toBe("110692");
  });
});

describe("貼り付け取込枠: 1列コピーの誤操作防止（classifyClipboard で事前判定）", () => {
  const clipboard = (text: string) => ({ clipboardData: { getData: () => text } });

  it("1列コピー（縦方向）を枠に貼ると取込を中止し、セルへ直接貼る案内を出す", () => {
    render(<BulkGridEditor />);
    fireEvent.click(screen.getByRole("button", { name: /Excel から貼り付け取込/ }));
    const box = screen.getByPlaceholderText(/ここに Ctrl\+V で貼り付け/);

    fireEvent.paste(box, clipboard("コピー1\r\nコピー2\r\nコピー3\r\n"));

    // 案内が出て、行は取り込まれない（NEコード列も汚れない）
    expect(screen.getByText(/取込を中止しました/)).toBeInTheDocument();
    expect(rowCount()).toBe(3); // 初期3行のまま
    expect(cellInput(0, "ne_code").value).toBe("");
  });

  it("「取り込んで行に追加」ボタン経由でも1列コピーは同じ案内で止まる", () => {
    render(<BulkGridEditor />);
    fireEvent.click(screen.getByRole("button", { name: /Excel から貼り付け取込/ }));
    const box = screen.getByPlaceholderText(/ここに Ctrl\+V で貼り付け/);

    fireEvent.change(box, { target: { value: "あ\nい\nう" } });
    fireEvent.click(screen.getByRole("button", { name: "取り込んで行に追加" }));

    expect(screen.getByText(/取込を中止しました/)).toBeInTheDocument();
    expect(rowCount()).toBe(3);
  });

  it("回帰: 表全体（複数列）のコピーは従来どおり行として取り込まれる", async () => {
    render(<BulkGridEditor />);
    fireEvent.click(screen.getByRole("button", { name: /Excel から貼り付け取込/ }));
    const box = screen.getByPlaceholderText(/ここに Ctrl\+V で貼り付け/);

    fireEvent.paste(
      box,
      clipboard("a009\t4514603474916\ta009\t単品\t1\t商品A\r\na010\t4514603474917\ta010\t単品\t1\t商品B\r\n"),
    );

    await screen.findByText(/2 行を取り込みました/);
    expect(rowCount()).toBe(2); // 空の初期行は置き換わる
    expect(cellInput(0, "ne_code").value).toBe("a009");
    expect(cellInput(1, "product_name").value).toBe("商品B");
    // 取込成功で枠は閉じ、案内も消えている
    expect(screen.queryByText(/取込を中止しました/)).not.toBeInTheDocument();
  });
});
