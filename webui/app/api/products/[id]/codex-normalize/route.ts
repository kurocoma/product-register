import { NextResponse } from "next/server";
import type { ProductInput } from "@/lib/product/schema";
import {
  dbRowToProductInput,
  getProduct,
} from "@/lib/product/repository";
import { requestCodexRuleProposal } from "@/lib/rule-audit/codex-client";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const REFERENCE_PRODUCT_ID = "50bb4aea-99a4-426b-a21d-08902f96980e";

type NormalizeRequestBody = {
  productId?: unknown;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as NormalizeRequestBody;

  if (typeof body.productId !== "string" || body.productId !== id) {
    return NextResponse.json(
      { ok: false, error: "商品IDがリクエストパスと一致しません" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });
  }

  try {
    const [targetRow, referenceRow] = await Promise.all([
      getProduct(supabase, id),
      getProduct(supabase, REFERENCE_PRODUCT_ID),
    ]);

    if (!targetRow) {
      return NextResponse.json(
        { ok: false, error: "対象商品が見つかりません" },
        { status: 404 },
      );
    }
    if (!referenceRow) {
      return NextResponse.json(
        { ok: false, error: "固定のお手本商品が見つかりません" },
        { status: 500 },
      );
    }

    const target = dbRowToProductInput(targetRow);
    const reference = dbRowToProductInput(referenceRow);
    const targetImages = productImageUrls(target);
    const referenceImages = productImageUrls(reference);

    const proposal = await requestCodexRuleProposal({
      prompt: buildNormalizationPrompt(target, reference),
      imageUrls: [...referenceImages, ...targetImages],
    });

    if (proposal.sale_description_pc !== "") {
      throw new Error("Codex提案の sale_description_pc が空文字列ではありません");
    }
    if (!sameImagePool(targetImages, proposal.image_order)) {
      throw new Error("Codex提案の image_order が対象商品の既存画像URL集合と一致しません");
    }

    return NextResponse.json({
      ok: true,
      proposal,
      reference_product_id: REFERENCE_PRODUCT_ID,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Codex提案の生成に失敗しました: " +
          (error instanceof Error ? error.message : String(error)),
      },
      { status: 502 },
    );
  }
}

function productImageUrls(product: ProductInput): string[] {
  return Array.from({ length: 20 }, (_, index) => {
    const key = `image_url_${index + 1}` as keyof ProductInput;
    const value = product[key];
    return typeof value === "string" ? value.trim() : "";
  }).filter(Boolean);
}

function productContext(product: ProductInput): Record<string, unknown> {
  const withoutImageFields = Object.fromEntries(
    Object.entries(product).filter(
      ([key]) => !/^image_url_\d+$/.test(key) && key !== "is_single" && key !== "is_set",
    ),
  );
  return {
    ...withoutImageFields,
    image_urls: productImageUrls(product),
  };
}

function buildNormalizationPrompt(
  target: ProductInput,
  reference: ProductInput,
): string {
  return [
    "商品登録アプリの既存商品を、固定のお手本商品のルールに沿うよう再編集してください。",
    "販売説明文や既存HTMLにしかない商品固有情報を失わないよう、必要な情報は description_pc または description_sp に移してください。",
    "sale_description_pc は、画像から imgList を自動生成できる正しい形として空文字列を提案してください。",
    "image_order は対象商品の image_urls にある既存URLを、追加・削除・書き換えせず全件ちょうど1回ずつ使用し、順序だけを並べ替えてください。件数は現在と同じ（最大20件）にし、新しい画像URLは作らないでください。",
    "画像名が楽天基準（1枚目={ne_code}.jpg、2枚目以降={maker_code}-{JAN末尾4桁}_{番号}.jpg）と異なる場合だけ、image_naming_changes に from=現在URL、to=期待する新URLを入れてください。実ファイル操作は行わず提案だけにしてください。",
    "notes には、保持した訴求情報と画像順・命名の判断理由を日本語で簡潔に記載してください。",
    "",
    "固定のお手本商品 (reference_product_id=" + REFERENCE_PRODUCT_ID + "):",
    JSON.stringify(productContext(reference), null, 2),
    "",
    "対象商品:",
    JSON.stringify(productContext(target), null, 2),
    "",
    "この後に添付する画像入力は、お手本商品の画像、対象商品の画像の順です。URLは上記JSONの image_urls と対応します。",
    "指定された構造化JSONだけを返してください。",
  ].join("\n");
}

// 新規画像調達は要件定義上の次フェーズであるため、現フェーズでは制約を緩めず、
// 既存URL集合の完全一致を要求する。同じ制約をプロンプトにも明記している。
function sameImagePool(current: string[], proposed: string[]): boolean {
  if (current.length !== proposed.length) return false;
  const currentSorted = [...current].sort();
  const proposedSorted = [...proposed].sort();
  return currentSorted.every((url, index) => url === proposedSorted[index]);
}
