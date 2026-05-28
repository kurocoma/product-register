import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function HelpPage() {
  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold">ヘルプ</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">📖 使い方ガイド</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <ol className="list-decimal list-inside space-y-1">
            <li><strong>新規商品の登録</strong>: 「商品一覧」→「+ 新規商品」</li>
            <li><strong>左ペインのフォーム編集</strong>: 7 アコーディオン (基本/配送/説明/Yahoo grouping/バリエーション/画像 URL 20/商品属性 5)</li>
            <li><strong>右ペインのプレビュー</strong>: 楽天/Yahoo/Shopify タブで本番ストア風 UI を確認</li>
            <li><strong>自動保存</strong>: 入力 800ms 後に自動保存 (手動「保存」ボタンも併設)</li>
            <li><strong>CSV ダウンロード</strong>: 1 商品ごと (編集画面右下) または 一括 (「CSV ダウンロード」メニュー)</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">📋 モール仕様 (Phase 1 検証済み)</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <ul className="space-y-1">
            <li><strong>楽天 RMS</strong>: 親子構造、108 列、cp932 (Shift_JIS)</li>
            <li><strong>Yahoo!ショッピング</strong>: 85 列、grouping-id + variation1 で集約、cp932</li>
            <li><strong>ネクストエンジン (NE)</strong>: 単品 94 列 + セット 92 列、utf-8 (BOMなし)</li>
            <li><strong>Shopify</strong>: 60 列、画像複数行展開、utf-8 (BOM付き)、日本/国際マーケット対応</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">⚙️ 技術仕様</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <ul className="space-y-1">
            <li>Next.js 16 (App Router) + React 19 + TypeScript</li>
            <li>Supabase (Auth + DB + RLS)</li>
            <li>Tailwind CSS 4 + 自前 UI コンポーネント</li>
            <li>Vitest + 70 テストパス (Phase 1 Python ロジック移植版)</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
