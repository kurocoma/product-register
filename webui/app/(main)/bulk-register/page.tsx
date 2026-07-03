import { BulkGridEditor } from "@/components/product/BulkGridEditor";

// 一括登録: Excel「データ入力シート」と同じ列構成のグリッドで複数商品をまとめて登録する。
// 認証は (main) レイアウトで担保。モールへの送信はここでは行わない（保存先は products のみ）。
export default function BulkRegisterPage() {
  return <BulkGridEditor />;
}
