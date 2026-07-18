"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { RuleViolationReason } from "@/lib/rule-audit/detect";

type AuditedProduct = {
  id: string;
  ne_code: string;
  product_name: string;
  reasons: RuleViolationReason[];
};

type AuditResponse =
  | { ok: true; products: AuditedProduct[] }
  | { ok: false; error: string };

const REASON_LABEL: Record<RuleViolationReason, string> = {
  description_html: "PC用販売説明文が空欄でない",
  image_naming: "画像ファイル名が規則外",
};

export default function RuleAuditPage() {
  const [products, setProducts] = useState<AuditedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshAudit = async () => {
    setLoading(true);
    setError(null);
    try {
      setProducts(await requestRuleAudit());
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    void requestRuleAudit()
      .then((auditedProducts) => {
        if (active) setProducts(auditedProducts);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">ルール監査</h1>
          <p className="mt-1 text-sm text-slate-500">
            PC用販売説明文と楽天基準の画像ファイル名を商品ごとに確認します。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refreshAudit()}
          disabled={loading}
          className="rounded border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "確認中…" : "再確認"}
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          ⚠ {error}
        </div>
      )}

      {!error && loading && (
        <div className="rounded border border-slate-200 bg-white p-6 text-sm text-slate-500">
          商品ルールを確認しています…
        </div>
      )}

      {!error && !loading && products.length === 0 && (
        <div className="rounded border border-green-200 bg-green-50 p-6 text-sm text-green-800">
          違反商品はありません。
        </div>
      )}

      {!error && !loading && products.length > 0 && (
        <section className="overflow-hidden rounded border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3 text-sm text-slate-600">
            違反商品 <span className="font-semibold text-slate-900">{products.length}</span> 件
          </div>
          <ul className="divide-y divide-slate-200">
            {products.map((product) => (
              <li key={product.id} className="flex flex-wrap items-center gap-3 px-4 py-4">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs text-slate-500">{product.ne_code}</div>
                  <div className="truncate font-medium text-slate-900">{product.product_name}</div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {product.reasons.map((reason) => (
                    <span
                      key={reason}
                      className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800"
                    >
                      {REASON_LABEL[reason]}
                    </span>
                  ))}
                </div>
                <Link
                  href={`/products/${product.id}`}
                  className="rounded border border-blue-300 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
                >
                  商品を編集
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

async function requestRuleAudit(): Promise<AuditedProduct[]> {
  const response = await fetch("/api/rule-audit", { cache: "no-store" });
  const body = (await response.json()) as AuditResponse;
  if (!response.ok || !body.ok) {
    throw new Error(
      body.ok ? `監査に失敗しました (HTTP ${response.status})` : body.error,
    );
  }
  return body.products;
}

function errorMessage(cause: unknown): string {
  return "通信エラー: " + (cause instanceof Error ? cause.message : String(cause));
}
