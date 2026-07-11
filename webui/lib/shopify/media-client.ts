/** Shopify 商品画像アップロードクライアント。
 * 手元のバイナリを stagedUploadsCreate → staged URL へ multipart POST → productCreateMedia の
 * 3段階で商品メディアに追加する（Admin GraphQL 2026-01。docs: mutations/stagedUploadsCreate, productCreateMedia）。
 * メディア追加は非同期処理のため、成功=受理（status は後続で確認可能）。 */
import { shopifyGraphQL, formatUserErrors, type UserError } from "./graphql-client";
import type { ShopifyConfig } from "./auth";

const STAGED_UPLOADS_CREATE = `
mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets { url resourceUrl parameters { name value } }
    userErrors { field message }
  }
}`;

const PRODUCT_CREATE_MEDIA = `
mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
  productCreateMedia(productId: $productId, media: $media) {
    media { ... on MediaImage { id } mediaContentType status }
    mediaUserErrors { field message }
  }
}`;

type StagedTarget = {
  url: string;
  resourceUrl: string;
  parameters: { name: string; value: string }[];
};

export type ShopifyImageUploadResult = { ok: true; resourceUrl: string } | { ok: false; message: string };

/** 画像1枚を商品メディアへ追加する。productGid は gid://shopify/Product/... 形式。 */
export async function uploadProductImage(
  cfg: ShopifyConfig,
  opts: { productGid: string; fileName: string; jpeg: Buffer; alt?: string },
): Promise<ShopifyImageUploadResult> {
  // 1) ステージングアップロード先の発行
  const staged = await shopifyGraphQL(cfg, STAGED_UPLOADS_CREATE, {
    input: [
      {
        filename: opts.fileName,
        mimeType: "image/jpeg",
        httpMethod: "POST",
        resource: "PRODUCT_IMAGE",
        fileSize: String(opts.jpeg.byteLength),
      },
    ],
  });
  if (!staged.ok) return { ok: false, message: `stagedUploadsCreate 失敗: ${staged.message}` };
  const su = staged.data?.stagedUploadsCreate as
    | { stagedTargets?: StagedTarget[]; userErrors?: UserError[] }
    | undefined;
  const ue1 = formatUserErrors(su?.userErrors);
  if (ue1) return { ok: false, message: `stagedUploadsCreate 失敗: ${ue1}` };
  const target = su?.stagedTargets?.[0];
  if (!target?.url) return { ok: false, message: "stagedUploadsCreate 失敗: アップロード先が返りませんでした" };

  // 2) staged URL へ multipart POST（parameters を form へ先に載せ、最後に file）
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([new Uint8Array(opts.jpeg)], { type: "image/jpeg" }), opts.fileName);
  const up = await fetch(target.url, { method: "POST", body: form });
  if (!up.ok) {
    const text = await up.text();
    return { ok: false, message: `ステージングアップロード失敗 (HTTP ${up.status}): ${text.slice(0, 120)}` };
  }

  // 3) resourceUrl を originalSource として商品メディアへ追加
  const created = await shopifyGraphQL(cfg, PRODUCT_CREATE_MEDIA, {
    productId: opts.productGid,
    media: [
      {
        originalSource: target.resourceUrl,
        mediaContentType: "IMAGE",
        ...(opts.alt ? { alt: opts.alt } : {}),
      },
    ],
  });
  if (!created.ok) return { ok: false, message: `productCreateMedia 失敗: ${created.message}` };
  const pm = created.data?.productCreateMedia as { mediaUserErrors?: UserError[] } | undefined;
  const ue2 = formatUserErrors(pm?.mediaUserErrors);
  if (ue2) return { ok: false, message: `productCreateMedia 失敗: ${ue2}` };

  return { ok: true, resourceUrl: target.resourceUrl };
}
