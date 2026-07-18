import { createHash } from "node:crypto";
import { ProductInputSchema, type ProductInput } from "./schema";

export const MAX_RESEARCH_IMPORT = 25;
export const APP_DRAFT_CONFIRMATION = "SAVE_APP_DRAFTS";

export type ParsedResearchImport = {
  ok: true;
  products: ProductInput[];
  dryRun: boolean;
  overwrite: boolean;
  productHash: string;
  expectedHash?: string;
};

export type ResearchImportExistingState = {
  id: string;
  ne_code: string;
  updated_at: string;
};

export type ResearchImportFieldDiff = {
  field: string;
  before: unknown;
  after: unknown;
};

export type ResearchImportError = {
  ok: false;
  status: number;
  error: string;
};

function issueSummary(index: number, issues: { path: PropertyKey[]; message: string }[]): string {
  const first = issues[0];
  if (!first) return `${index + 1}行目の商品データが不正です`;
  const path = first.path.length > 0 ? first.path.map(String).join(".") : "商品";
  return `${index + 1}行目 ${path}: ${first.message}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Zodが捨てた未知キーを再帰的に検出し、スペルミスのまま成功扱いしない。 */
function firstUnknownPath(raw: unknown, normalized: unknown, path = ""): string | null {
  if (Array.isArray(raw)) {
    if (!Array.isArray(normalized)) return null;
    for (let i = 0; i < raw.length; i++) {
      const found = firstUnknownPath(raw[i], normalized[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(raw) || !isRecord(normalized)) return null;
  for (const key of Object.keys(raw)) {
    const childPath = path ? `${path}.${key}` : key;
    if (!(key in normalized)) return childPath;
    const found = firstUnknownPath(raw[key], normalized[key], childPath);
    if (found) return found;
  }
  return null;
}

/** dry-runで確認した上書き意図とDB行バージョンをcommitへ束縛するhash。 */
export function hashResearchImportPlan(
  products: ProductInput[],
  overwrite: boolean,
  existing: ResearchImportExistingState[],
): string {
  const byCode = new Map(existing.map((row) => [row.ne_code, row]));
  const canonical = {
    products,
    overwrite,
    existing: products.map((product) => {
      const row = byCode.get(product.ne_code);
      return row ? { id: row.id, ne_code: row.ne_code, updated_at: row.updated_at } : null;
    }),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function diffValue(value: unknown): unknown {
  if (value === undefined) return null;
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (serialized.length <= 300) return value;
  return {
    preview: serialized.slice(0, 300),
    length: serialized.length,
    sha256: createHash("sha256").update(serialized).digest("hex"),
  };
}

/** 上書きpreview用。派生フィールドを除くトップレベル単位で全置換差分を示す。 */
export function diffResearchProduct(before: ProductInput, after: ProductInput): ResearchImportFieldDiff[] {
  const ignored = new Set(["is_single", "is_set"]);
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const diffs: ResearchImportFieldDiff[] = [];
  for (const field of [...fields].sort()) {
    if (ignored.has(field)) continue;
    const beforeValue = before[field as keyof ProductInput];
    const afterValue = after[field as keyof ProductInput];
    if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) continue;
    diffs.push({ field, before: diffValue(beforeValue), after: diffValue(afterValue) });
  }
  return diffs;
}

/**
 * Excel/Codex の調査結果をアプリ下書きへ渡す前の共通ゲート。
 * - dry-run を安全側既定にする
 * - 現行 ProductInputSchema で全件検証する
 * - 同一payload内のNEコード重複を止める
 * - commit時はdry-runで得たhashと明示確認語を必須にする
 */
export function parseResearchImportPayload(body: unknown): ParsedResearchImport | ResearchImportError {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "JSONオブジェクトを指定してください" };
  }

  const raw = body as Record<string, unknown>;
  if (!Array.isArray(raw.products) || raw.products.length === 0) {
    return { ok: false, status: 400, error: "products に1件以上の商品を指定してください" };
  }
  if (raw.products.length > MAX_RESEARCH_IMPORT) {
    return {
      ok: false,
      status: 400,
      error: `一度に処理できるのは${MAX_RESEARCH_IMPORT}件までです`,
    };
  }

  const products: ProductInput[] = [];
  for (let i = 0; i < raw.products.length; i++) {
    const parsed = ProductInputSchema.safeParse(raw.products[i]);
    if (!parsed.success) {
      return { ok: false, status: 400, error: issueSummary(i, parsed.error.issues) };
    }
    const unknownPath = firstUnknownPath(raw.products[i], parsed.data);
    if (unknownPath) {
      return { ok: false, status: 400, error: `${i + 1}行目に未対応フィールドがあります: ${unknownPath}` };
    }
    const neCode = parsed.data.ne_code.trim();
    if (neCode === "") {
      return { ok: false, status: 400, error: `${i + 1}行目 ne_code: NEコードは必須です` };
    }
    // lookup/hash/saveの全経路で同じ正規化値を使う。
    products.push(ProductInputSchema.parse({ ...parsed.data, ne_code: neCode }));
  }

  const seen = new Set<string>();
  for (const product of products) {
    const code = product.ne_code.trim();
    if (seen.has(code)) {
      return { ok: false, status: 400, error: `NEコードがpayload内で重複しています: ${code}` };
    }
    seen.add(code);
  }

  // Zodで正規化した値から計算するので、キー順や省略時defaultの違いでhashが揺れない。
  const productHash = createHash("sha256").update(JSON.stringify(products)).digest("hex");
  const dryRun = raw.dryRun !== false;
  const overwrite = raw.overwrite === true;

  if (!dryRun) {
    if (raw.confirmation !== APP_DRAFT_CONFIRMATION) {
      return {
        ok: false,
        status: 400,
        error: `下書き保存には confirmation: "${APP_DRAFT_CONFIRMATION}" が必要です`,
      };
    }
  }

  return {
    ok: true,
    products,
    dryRun,
    overwrite,
    productHash,
    ...(typeof raw.expectedHash === "string" ? { expectedHash: raw.expectedHash } : {}),
  };
}
