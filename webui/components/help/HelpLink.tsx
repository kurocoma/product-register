import Link from "next/link";
import { cn } from "@/lib/utils";

/** 画面ヘッダ用のヘルプ導線「?」。押すとヘルプページ内の「その画面の手順」へ直接飛ぶ。
 *
 * anchor はヘルプページ（app/(main)/help/page.tsx）のセクション id と一致させること:
 * - screen-dashboard      … ダッシュボード
 * - screen-products       … 商品一覧
 * - screen-product-edit   … 商品編集
 * - screen-bulk-register  … 一括登録
 * - screen-bulk-images    … 画像一括アップロード
 * - screen-migrate        … 楽天→Yahoo 一括移行
 * - screen-related-import … 関連商品（セット）取込
 * - screen-csv            … CSV ダウンロード
 * - screen-templates      … テンプレート管理
 * - screen-masters        … マスタ取込
 * - screen-masters-related … 関連商品抽出
 * - screen-rule-audit     … ルール監査
 * - screen-history        … 作業履歴
 * - screen-settings       … 設定
 * よくある失敗: fail-required（必須項目不足）/ fail-yahoo-image（it-14091 画像エラー）/
 * fail-category-mapping（カテゴリ対応表にない）。用語集: glossary。技術仕様: tech-spec。
 */
export function HelpLink({ anchor, className }: { anchor: string; className?: string }) {
  return (
    <Link
      href={`/help#${anchor}`}
      title="この画面のヘルプを見る"
      aria-label="この画面のヘルプを見る"
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-xs font-bold text-slate-500 no-underline hover:border-blue-400 hover:text-blue-600",
        className,
      )}
    >
      ?
    </Link>
  );
}
