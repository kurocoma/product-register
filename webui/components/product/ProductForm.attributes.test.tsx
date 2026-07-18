import { afterEach, describe, it, expect } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useForm, FormProvider } from "react-hook-form";
import { AttributeSection } from "./ProductForm";
import { makeProduct, type ProductInput } from "@/lib/product/schema";

// 軽量テストハーネス: <ProductForm> 全体（約1100行の巨大フォーム）ではなく AttributeSection
// のみを FormProvider でホストする。jsdom の render 負荷を下げ、フルスイート並列実行時の
// デフォルト5秒タイムアウトによるフレークを防ぐ。AttributeSection が読む値
// （variants / attributes / mall_category_id 等）は useForm の defaultValues で供給する。
// ProductForm と同様に is_single/is_set 派生プロパティは除いて渡す。
function Harness({ defaultValues }: { defaultValues: ProductInput }) {
  const { is_single, is_set, ...rest } = defaultValues;
  void is_single;
  void is_set;
  const methods = useForm<Record<string, unknown>>({
    defaultValues: rest as Record<string, unknown>,
  });
  return (
    <FormProvider {...methods}>
      <AttributeSection />
    </FormProvider>
  );
}

// 商品共通に値あり・各SKUは属性が空、という「既存の複数SKU商品」を模した defaultValues。
const withVariants = () =>
  makeProduct({
    attributes: [
      { item: "ブランド名", value: "共通ブランド", unit: "", requirement: "必須" },
      { item: "総入数", value: "3", unit: "本", requirement: "必須" },
    ],
    variants: [
      {
        sku_manage_number: "sku-a",
        ne_code: "sku-a",
        jan_code: "4571464240265",
        selling_price: 1000,
        tax_rate: 10,
        quantity: 1,
        shipping_type: "送料無料",
        attributes: [],
      },
      {
        sku_manage_number: "sku-b",
        ne_code: "sku-b",
        jan_code: "4571464240272",
        selling_price: 2000,
        tax_rate: 10,
        quantity: 2,
        shipping_type: "送料無料",
        attributes: [],
      },
    ],
  });

afterEach(() => cleanup());

describe("AttributeSection SKU単位の属性編集", () => {
  it("複数SKUでは「次へ →」で編集対象が商品共通→各SKUへ切り替わる", () => {
    render(<Harness defaultValues={withVariants()} />);

    // 初期は商品共通。商品共通の属性値が見えている。
    expect(screen.getByText("編集中: 商品共通")).toBeInTheDocument();
    expect(screen.getByLabelText("属性1 値")).toHaveValue("共通ブランド");
    expect(screen.getByLabelText("属性2 値")).toHaveValue("3");

    // 「次へ →」で最初のSKU(sku-a)へ。sku-aは属性が空。
    fireEvent.click(screen.getByRole("button", { name: "次へ →" }));
    expect(screen.getByText("編集中: sku-a")).toBeInTheDocument();
    // 対象が切り替わり、商品共通の属性行は表示されていない（別対象を編集している）。
    expect(screen.queryByLabelText("属性1 値")).toBeNull();
    expect(screen.getByText(/属性がありません/)).toBeInTheDocument();

    // もう一度「次へ →」で2番目のSKU(sku-b)へ。
    fireEvent.click(screen.getByRole("button", { name: "次へ →" }));
    expect(screen.getByText("編集中: sku-b")).toBeInTheDocument();
  });

  it("コピー→別SKUへ切替→貼り付けで、属性値がそのSKUへ複製される", async () => {
    render(<Harness defaultValues={withVariants()} />);

    // 商品共通の属性一式をコピー。
    fireEvent.click(screen.getByRole("button", { name: "📋 コピー" }));

    // sku-a(空)へ切り替え。
    fireEvent.click(screen.getByRole("button", { name: "次へ →" }));
    expect(screen.getByText("編集中: sku-a")).toBeInTheDocument();
    expect(screen.getByText(/属性がありません/)).toBeInTheDocument();

    // 貼り付けると商品共通の値がsku-aへ反映される。
    fireEvent.click(screen.getByRole("button", { name: "📥 貼り付け" }));

    await waitFor(() => {
      expect(screen.getByLabelText("属性1 値")).toHaveValue("共通ブランド");
    });
    expect(screen.getByLabelText("属性1 項目")).toHaveValue("ブランド名");
    expect(screen.getByLabelText("属性2 項目")).toHaveValue("総入数");
    expect(screen.getByLabelText("属性2 値")).toHaveValue("3");
    expect(screen.getByLabelText("属性2 単位")).toHaveValue("本");
  });

  it("単品(variants未設定)では切り替え/コピー貼り付けUIを出さず、従来の商品共通編集のみ", () => {
    render(
      <Harness
        defaultValues={makeProduct({
          attributes: [{ item: "ブランド名", value: "X", unit: "", requirement: "必須" }],
        })}
      />,
    );

    // 切り替え系UIは出ない（複数SKUのときだけ出す）。
    expect(screen.queryByText(/編集対象:/)).toBeNull();
    expect(screen.queryByRole("button", { name: "次へ →" })).toBeNull();
    expect(screen.queryByRole("button", { name: "📋 コピー" })).toBeNull();
    expect(screen.queryByRole("button", { name: "📥 貼り付け" })).toBeNull();

    // 従来の商品共通の属性編集は従来どおり表示される。
    expect(
      screen.getByRole("button", { name: "📥 カテゴリIDから属性を読み込む" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("属性1 項目")).toHaveValue("ブランド名");
    expect(screen.getByLabelText("属性1 値")).toHaveValue("X");
  });
});
