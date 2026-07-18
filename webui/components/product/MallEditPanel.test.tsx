import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import type { CodexRuleProposal } from "@/lib/rule-audit/codex-client";
import { MallEditPanel } from "./MallEditPanel";
import type { ProductFormApi } from "./ProductForm";

const PRODUCT_ID = "product-123";
const FIRST_IMAGE_URL = "https://example.com/first.jpg";
const SECOND_IMAGE_URL = "https://example.com/second.jpg";

type HarnessValues = Record<string, string>;

function FormHarness({ initialValues }: { initialValues: HarnessValues }) {
  const { getValues, register, setValue } = useForm<HarnessValues>({
    defaultValues: initialValues,
  });
  const formApi = useMemo<ProductFormApi>(
    () => ({
      getValue: (name) => String(getValues(name) ?? ""),
      setValue: (name, value) =>
        setValue(name, value, {
          shouldDirty: true,
          shouldTouch: true,
          shouldValidate: true,
        }),
    }),
    [getValues, setValue],
  );

  return (
    <>
      <input aria-label="フォーム 販売説明文" {...register("sale_description_pc")} />
      <input aria-label="フォーム 商品説明 PC" {...register("description_pc")} />
      <input aria-label="フォーム 商品説明 SP" {...register("description_sp")} />
      {Array.from({ length: 20 }, (_, index) => {
        const name = `image_url_${index + 1}`;
        return (
          <input
            key={name}
            aria-label={`フォーム 画像${index + 1}`}
            {...register(name)}
          />
        );
      })}
      <MallEditPanel productId={PRODUCT_ID} formApi={formApi} />
    </>
  );
}

function makeProposal(
  overrides: Partial<CodexRuleProposal> = {},
): CodexRuleProposal {
  return {
    sale_description_pc: "",
    description_pc: "提案されたPC説明",
    description_sp: "提案されたSP説明",
    image_order: [SECOND_IMAGE_URL, FIRST_IMAGE_URL],
    image_naming_changes: [],
    notes: "お手本商品のルールに合わせた提案",
    ...overrides,
  };
}

function mockProposalResponse(proposal: CodexRuleProposal) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      proposal,
      reference_product_id: "reference-product",
    }),
  } as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MallEditPanel の Codex 提案承認", () => {
  it("提案を受信して差分を表示し、承認すると react-hook-form の登録値へ反映する", async () => {
    const proposal = makeProposal();
    const fetchMock = mockProposalResponse(proposal);
    render(
      <FormHarness
        initialValues={{
          sale_description_pc: "現在の販売説明",
          description_pc: "現在のPC説明",
          description_sp: "現在のSP説明",
          image_url_1: FIRST_IMAGE_URL,
          image_url_2: SECOND_IMAGE_URL,
          image_url_3: "",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "🤖 Codexでルール適用" }));

    expect(await screen.findByText("Codex提案の差分")).toBeInTheDocument();
    expect(screen.getByText("現在のPC説明")).toBeInTheDocument();
    expect(screen.getByText("提案されたPC説明")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/products/" + PRODUCT_ID + "/codex-normalize",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: PRODUCT_ID }),
      },
    );

    fireEvent.click(
      screen.getByRole("button", { name: "提案を承認してフォームへ反映" }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("フォーム 商品説明 PC")).toHaveValue(
        "提案されたPC説明",
      );
    });
    expect(screen.getByLabelText("フォーム 販売説明文")).toHaveValue("");
    expect(screen.getByLabelText("フォーム 商品説明 SP")).toHaveValue(
      "提案されたSP説明",
    );
    expect(screen.getByLabelText("フォーム 画像1")).toHaveValue(
      SECOND_IMAGE_URL,
    );
    expect(screen.getByLabelText("フォーム 画像2")).toHaveValue(
      FIRST_IMAGE_URL,
    );
    expect(
      screen.getByText("✓ Codex提案をフォームへ反映しました。内容を確認して保存してください。"),
    ).toBeInTheDocument();
  });

  it("提案の画像URL集合が現在のフォームと一致しない場合はエラーを表示してフォームを変更しない", async () => {
    mockProposalResponse(
      makeProposal({
        sale_description_pc: "提案された販売説明",
        image_order: [FIRST_IMAGE_URL],
      }),
    );
    render(
      <FormHarness
        initialValues={{
          sale_description_pc: "現在の販売説明",
          description_pc: "現在のPC説明",
          description_sp: "現在のSP説明",
          image_url_1: FIRST_IMAGE_URL,
          image_url_2: SECOND_IMAGE_URL,
          image_url_3: "",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "🤖 Codexでルール適用" }));
    expect(await screen.findByText("Codex提案の差分")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "提案を承認してフォームへ反映" }),
    );

    expect(
      await screen.findByText(
        "⚠ 提案の画像URL集合が現在のフォームと一致しないため反映しませんでした。提案を生成し直してください。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("フォーム 販売説明文")).toHaveValue(
      "現在の販売説明",
    );
    expect(screen.getByLabelText("フォーム 商品説明 PC")).toHaveValue(
      "現在のPC説明",
    );
    expect(screen.getByLabelText("フォーム 商品説明 SP")).toHaveValue(
      "現在のSP説明",
    );
    expect(screen.getByLabelText("フォーム 画像1")).toHaveValue(
      FIRST_IMAGE_URL,
    );
    expect(screen.getByLabelText("フォーム 画像2")).toHaveValue(
      SECOND_IMAGE_URL,
    );
    expect(screen.getByLabelText("フォーム 画像3")).toHaveValue("");
  });

  it("画像1が空で画像2だけにURLがある場合、承認後は画像1へ前詰めし画像2を空にする", async () => {
    const onlyImageUrl = "https://example.com/only.jpg";
    mockProposalResponse(
      makeProposal({
        description_pc: "前詰めと同時に反映する説明",
        description_sp: "現在のSP説明",
        image_order: [onlyImageUrl],
      }),
    );
    render(
      <FormHarness
        initialValues={{
          sale_description_pc: "",
          description_pc: "現在のPC説明",
          description_sp: "現在のSP説明",
          image_url_1: "",
          image_url_2: onlyImageUrl,
          image_url_3: "",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "🤖 Codexでルール適用" }));
    expect(await screen.findByText("Codex提案の差分")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "提案を承認してフォームへ反映" }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("フォーム 画像1")).toHaveValue(onlyImageUrl);
    });
    expect(screen.getByLabelText("フォーム 画像2")).toHaveValue("");
    expect(screen.getByLabelText("フォーム 画像3")).toHaveValue("");
  });

  it("画像URLスロットが20件満杯でも提案順を20件すべて反映する", async () => {
    const imageUrls = Array.from(
      { length: 20 },
      (_, index) => `https://example.com/image-${index + 1}.jpg`,
    );
    const proposedOrder = [...imageUrls].reverse();
    const initialValues: HarnessValues = {
      sale_description_pc: "現在の販売説明",
      description_pc: "現在のPC説明",
      description_sp: "現在のSP説明",
      ...Object.fromEntries(
        imageUrls.map((url, index) => [`image_url_${index + 1}`, url]),
      ),
    };
    mockProposalResponse(makeProposal({ image_order: proposedOrder }));
    render(<FormHarness initialValues={initialValues} />);

    fireEvent.click(screen.getByRole("button", { name: "🤖 Codexでルール適用" }));
    expect(await screen.findByText("Codex提案の差分")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "提案を承認してフォームへ反映" }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("フォーム 画像20")).toHaveValue(
        proposedOrder[19],
      );
    });
    proposedOrder.forEach((url, index) => {
      expect(screen.getByLabelText(`フォーム 画像${index + 1}`)).toHaveValue(
        url,
      );
    });
    expect(
      screen.getByText("✓ Codex提案をフォームへ反映しました。内容を確認して保存してください。"),
    ).toBeInTheDocument();
  });
});
