/** 商品一覧の検索パフォーマンス対策（260901 追加依頼「商品名で検索するとマウスが動きにくい」）の回帰テスト。
 *
 *  対策: (1) 検索索引（haystack）の前計算 — 打鍵ごとに全商品を正規化し直さない
 *        (2) 段階表示 — 一度に描画する行数を LIST_PAGE_SIZE までに抑える（絞り込み対象は全件のまま）
 *  ここでは段階表示の件数・ボタン挙動と、正規化検索（表記ゆれ・掲載商品名）・全選択対象を固定する。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { LIST_PAGE_SIZE, ProductList } from "./ProductList";
import type { ProductRow } from "@/lib/product/repository";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/product/repository", () => ({
  deleteProduct: async () => undefined,
  dbRowToProductInput: (p: unknown) => p,
  upsertProduct: async (_client: unknown, p: unknown) => p,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const row = (over: Partial<ProductRow> & { extra?: Record<string, unknown> } = {}): ProductRow =>
  ({
    id: "id-1",
    user_id: "u",
    created_at: "",
    updated_at: "",
    ne_code: "t002-2542-1",
    product_name: "テスト商品",
    jan_code: "4955028002542",
    maker_code: "t002",
    selling_price: 1000,
    image_count: 0,
    extra: { mall_listed: { rakuten: true, yahoo: true } },
    ...over,
  }) as unknown as ProductRow;

const many = (n: number): ProductRow[] =>
  Array.from({ length: n }, (_, i) => row({ id: `id-${i}`, ne_code: `t002-${1000 + i}`, product_name: `テスト商品${i}` }));

const searchBox = () => screen.getByPlaceholderText(/検索/);
/** 見出し行を除いた実データ行（末尾の「さらに表示」行は td が1つなので除外する） */
const bodyRows = () => screen.getAllByRole("row").slice(1).filter((r) => r.querySelectorAll("td").length > 1);

const type = async (value: string) => {
  await act(async () => {
    fireEvent.change(searchBox(), { target: { value } });
  });
};

describe("段階表示（一度に描画する行数の上限）", () => {
  const OVER = LIST_PAGE_SIZE + 5;
  const REST = OVER - LIST_PAGE_SIZE;

  it("上限超過分は「さらに表示」「すべて表示」で出し、検索条件を変えると上限に戻る", async () => {
    render(<ProductList initial={many(OVER)} />);
    expect(bodyRows()).toHaveLength(LIST_PAGE_SIZE);
    expect(screen.getByText(`${OVER} 件が該当`)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: `さらに ${REST} 件表示` }));
    });
    expect(bodyRows()).toHaveLength(OVER);
    expect(screen.queryByRole("button", { name: /さらに/ })).toBeNull();

    await type("テスト商品"); // 全件ヒットだが条件が変わったので上限に戻す
    expect(bodyRows()).toHaveLength(LIST_PAGE_SIZE);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: `すべて表示（${OVER} 件）` }));
    });
    expect(bodyRows()).toHaveLength(OVER);
  }, 30_000);

  it("上限以下なら段階表示ボタンは出さない", () => {
    render(<ProductList initial={many(30)} />);
    expect(screen.queryByRole("button", { name: /さらに/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /すべて表示/ })).toBeNull();
    expect(bodyRows()).toHaveLength(30);
  });

  it("全選択は「画面に出ている分」でなく絞り込み結果の全件が対象（一括反映の対象を減らさない）", async () => {
    const total = LIST_PAGE_SIZE + 5;
    render(<ProductList initial={many(total)} />);
    expect(bodyRows()).toHaveLength(LIST_PAGE_SIZE);
    await act(async () => {
      fireEvent.click(within(screen.getAllByRole("row")[0]).getByRole("checkbox"));
    });
    expect(screen.getByText(`${total} 件選択中`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `楽天へ一括反映（${total}件）` })).toBeInTheDocument();
  }, 30_000);
});

describe("正規化検索（絞り込み条件の互換）", () => {
  it("表記ゆれ（ウェット/ウエット）と掲載商品名（display_name）でもヒットする", async () => {
    render(
      <ProductList
        initial={[
          row({ id: "a", ne_code: "n050-1", product_name: "ウェットブラシ オリジナル", jan_code: "4900000000001" }),
          row({ id: "b", ne_code: "n050-2", product_name: "シャンプー 詰め替え", display_name: "【送料無料】シャンプー", jan_code: "4900000000002" }),
        ]}
      />,
    );
    await type("ウエットブラシ");
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0].textContent).toContain("ウェットブラシ");

    await type("送料無料"); // 掲載商品名
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0].textContent).toContain("シャンプー");

    await type("");
    expect(bodyRows()).toHaveLength(2);
  });
});
