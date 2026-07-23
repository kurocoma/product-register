import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm, type UseFormReturn } from "react-hook-form";
import { makeProduct, VariantSchema, type ProductInputBase } from "@/lib/product/schema";
import { VariantSpecsEditor } from "./VariantSpecsEditor";
import { AttributeTargetProvider, useAttributeTarget, type AttributeTarget } from "./attribute-target";

type Methods = UseFormReturn<ProductInputBase>;
type Spec = { label: string; value: string };

/** テストから編集対象（商品共通/SKU）を切り替えるための操作ボタン。 */
function TargetProbe() {
  const { setTarget } = useAttributeTarget();
  return (
    <div>
      <button type="button" onClick={() => setTarget("product")}>__target-product__</button>
      <button type="button" onClick={() => setTarget(0)}>__target-0__</button>
      <button type="button" onClick={() => setTarget(1)}>__target-1__</button>
    </div>
  );
}

function Harness({
  specsA,
  specsB,
  onReady,
  initialTarget = 0,
}: {
  specsA: Spec[];
  specsB?: Spec[];
  onReady?: (methods: Methods) => void;
  initialTarget?: AttributeTarget;
}) {
  const variants = [
    VariantSchema.parse({ sku_manage_number: "sku-a", ne_code: "ne-a", selling_price: 1000, specs: specsA }),
  ];
  if (specsB) {
    variants.push(
      VariantSchema.parse({ sku_manage_number: "sku-b", ne_code: "ne-b", selling_price: 2000, specs: specsB }),
    );
  }
  const { is_single, is_set, ...defaultValues } = makeProduct({ variants });
  void is_single;
  void is_set;
  const methods = useForm<ProductInputBase>({ defaultValues });
  React.useEffect(() => {
    onReady?.(methods);
  }, [methods, onReady]);
  return (
    <FormProvider {...methods}>
      <AttributeTargetProvider initialTarget={initialTarget}>
        <TargetProbe />
        <VariantSpecsEditor />
      </AttributeTargetProvider>
    </FormProvider>
  );
}

const fiveSpecs: Spec[] = [
  { label: "原産国", value: "日本" },
  { label: "保存方法", value: "常温" },
  { label: "内容量", value: "1個" },
  { label: "包装", value: "箱" },
  { label: "備考", value: "なし" },
];

afterEach(() => cleanup());

describe("VariantSpecsEditor", () => {
  it("既存行を表示し、文字数上限をUIでも拘束する（追加ボタンは無い）", () => {
    render(<Harness specsA={fiveSpecs} />);

    const label = screen.getByLabelText("ne-a 自由入力行1 項目");
    const value = screen.getByLabelText("ne-a 自由入力行1 値");
    expect(label).toHaveValue("原産国");
    expect(value).toHaveValue("日本");
    expect(label).toHaveAttribute("maxLength", "40");
    expect(value).toHaveAttribute("maxLength", "140");

    // 5枠固定のため追加ボタンは存在しない
    expect(screen.queryByRole("button", { name: /自由入力行を追加/ })).toBeNull();
  });

  it("保存済みが2行でも常に5枠表示する（デフォルト5枠）", () => {
    render(<Harness specsA={fiveSpecs.slice(0, 2)} />);

    expect(screen.getAllByPlaceholderText("項目（40文字まで）")).toHaveLength(5);
    expect(screen.getAllByPlaceholderText("値（140文字まで）")).toHaveLength(5);
    expect(screen.getByLabelText("ne-a 自由入力行3 項目")).toHaveValue("");
    // 商品属性と同じ横並びヘッダー（項目/値）が1回だけ出る
    expect(screen.getAllByText("項目")).toHaveLength(1);
    expect(screen.getAllByText("値")).toHaveLength(1);
  });

  it("項目・値の両方が入力された行だけをフォームへ書き込む", () => {
    let methods: Methods | undefined;
    render(
      <Harness
        specsA={fiveSpecs.slice(0, 2)}
        onReady={(m) => {
          methods = m;
        }}
      />,
    );

    // 片側だけ → フォームは変わらず、案内文を表示
    fireEvent.change(screen.getByLabelText("ne-a 自由入力行3 項目"), { target: { value: "産地" } });
    expect(methods!.getValues("variants.0.specs")).toHaveLength(2);
    expect(screen.getByText("項目と値の両方を入力すると保存されます")).toBeInTheDocument();

    // 両方入力 → 3行目として保存される
    fireEvent.change(screen.getByLabelText("ne-a 自由入力行3 値"), { target: { value: "沖縄" } });
    const specs = methods!.getValues("variants.0.specs");
    expect(specs).toHaveLength(3);
    expect(specs![2]).toEqual({ label: "産地", value: "沖縄" });
  });

  it("削除ボタンは枠を残したまま行の内容を消し、フォームからも取り除く", () => {
    let methods: Methods | undefined;
    render(
      <Harness
        specsA={fiveSpecs.slice(0, 2)}
        onReady={(m) => {
          methods = m;
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("ne-a 自由入力行1を削除"));
    expect(screen.getByLabelText("ne-a 自由入力行1 項目")).toHaveValue("");
    expect(screen.getAllByPlaceholderText("項目（40文字まで）")).toHaveLength(5);

    const specs = methods!.getValues("variants.0.specs");
    expect(specs).toHaveLength(1);
    expect(specs![0]).toEqual({ label: "保存方法", value: "常温" });
  });

  it("編集対象が商品共通のときは編集枠を出さず、案内とコピー/貼り付けの無効化だけ行う", () => {
    render(<Harness specsA={fiveSpecs.slice(0, 2)} initialTarget="product" />);

    expect(screen.getByText("自由入力行はSKUごとの設定です。上の「編集対象」でSKUを選ぶと編集できます。")).toBeInTheDocument();
    expect(screen.queryAllByPlaceholderText("項目（40文字まで）")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "📋 コピー" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "📥 貼り付け" })).toBeDisabled();
  });

  it("編集対象の切り替えに連動して表示するSKUが変わる", () => {
    render(
      <Harness
        specsA={[{ label: "内容量", value: "20ml" }]}
        specsB={[{ label: "内容量", value: "60ml" }]}
        initialTarget={0}
      />,
    );

    expect(screen.getByLabelText("ne-a 自由入力行1 値")).toHaveValue("20ml");
    expect(screen.queryByLabelText("ne-b 自由入力行1 値")).toBeNull();

    fireEvent.click(screen.getByText("__target-1__"));
    expect(screen.getByLabelText("ne-b 自由入力行1 値")).toHaveValue("60ml");
    expect(screen.queryByLabelText("ne-a 自由入力行1 値")).toBeNull();
  });

  it("コピーして編集対象を切り替え、貼り付けると自由入力行が複製される", () => {
    let methods: Methods | undefined;
    render(
      <Harness
        specsA={fiveSpecs.slice(0, 2)}
        specsB={[]}
        initialTarget={0}
        onReady={(m) => {
          methods = m;
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "📋 コピー" }));
    expect(screen.getByText(/コピー済み 2件/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("__target-1__"));
    fireEvent.click(screen.getByRole("button", { name: "📥 貼り付け" }));

    expect(methods!.getValues("variants.1.specs")).toEqual(fiveSpecs.slice(0, 2));
    // 貼り付け結果が表示枠にも反映される
    expect(screen.getByLabelText("ne-b 自由入力行1 項目")).toHaveValue("原産国");
    expect(screen.getByLabelText("ne-b 自由入力行2 値")).toHaveValue("常温");
  });
});
