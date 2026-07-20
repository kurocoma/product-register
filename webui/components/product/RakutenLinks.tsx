/** 楽天の外部リンク（RMS管理ページ・公開商品ページ）。
 * 商品一覧と商品編集（画像アップロードパネルの上）の両方から使う（260720依頼）。
 * サーバー専用コードを含む @/lib/rakuten barrel は使わず、純定数モジュールを直 import する
 * （lib/converters/image-url.ts と同じ経過措置パターン）。 */
import {
  DEFAULT_RAKUTEN_STORE,
  RAKUTEN_RMS_SHOP_ID,
  RAKUTEN_RMS_URL,
  rakutenItemPageUrl,
  rakutenRmsItemEditUrl,
} from "@/lib/rakuten/store";

const LINK_CLASS = "text-blue-600 hover:underline";

/** RMS メインメニューへのリンク（商品を特定しない場面用）。 */
export function RakutenRmsLink({ className }: { className?: string }) {
  return (
    <a href={RAKUTEN_RMS_URL} target="_blank" rel="noopener noreferrer" className={className ?? LINK_CLASS}>
      RMS管理ページ ↗
    </a>
  );
}

/** RMS の商品別編集ページへのリンク。管理番号が未設定（未掲載）のときは何も表示しない。 */
export function RakutenRmsItemEditLink({ manageNumber, className }: { manageNumber?: string; className?: string }) {
  const url = rakutenRmsItemEditUrl(RAKUTEN_RMS_SHOP_ID, manageNumber);
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={className ?? LINK_CLASS}>
      RMS編集ページ ↗
    </a>
  );
}

/** 公開商品ページへのリンク。楽天の管理番号が未設定（未掲載）のときは何も表示しない。 */
export function RakutenItemPageLink({ manageNumber, className }: { manageNumber?: string; className?: string }) {
  const url = rakutenItemPageUrl(DEFAULT_RAKUTEN_STORE, manageNumber);
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={className ?? LINK_CLASS}>
      楽天商品ページ ↗
    </a>
  );
}

/** 商品編集画面用: 画像アップロードパネルの上に置く横並びリンクバー。
 * 管理番号があれば RMS はその商品の編集ページへ直接飛ぶ。無ければメインメニュー。 */
export function RakutenLinksBar({ manageNumber }: { manageNumber?: string }) {
  const hasManage = (manageNumber ?? "").trim() !== "";
  return (
    <div className="bg-white border border-slate-200 rounded p-3 flex flex-wrap items-center gap-3 text-sm">
      <span className="font-semibold">🔗 楽天リンク</span>
      {hasManage ? <RakutenRmsItemEditLink manageNumber={manageNumber} /> : <RakutenRmsLink />}
      <RakutenItemPageLink manageNumber={manageNumber} />
      {!hasManage && (
        <span className="text-xs text-slate-400">（RMS編集・商品ページの直リンクは楽天の管理番号が入ると表示されます）</span>
      )}
    </div>
  );
}
