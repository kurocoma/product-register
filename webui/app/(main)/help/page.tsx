import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** ヘルプ（困ったとき用）。
 * 各セクションの id は components/help/HelpLink.tsx のアンカー一覧と一致させること。
 * 例: /help#screen-history で「作業履歴」の手順へ直接飛ぶ。
 */

function HelpSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2 text-slate-700">{children}</CardContent>
      </Card>
    </section>
  );
}

function Term({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-semibold">{name}</dt>
      <dd className="text-slate-600 ml-0">{children}</dd>
    </div>
  );
}

const SCREEN_TOC = [
  { id: "screen-dashboard", label: "ダッシュボード" },
  { id: "screen-products", label: "商品一覧" },
  { id: "screen-product-edit", label: "商品編集" },
  { id: "screen-bulk-register", label: "一括登録" },
  { id: "screen-bulk-images", label: "画像一括アップロード" },
  { id: "screen-migrate", label: "楽天→Yahoo 一括移行" },
  { id: "screen-sale-support", label: "セール支援" },
  { id: "screen-related-import", label: "関連商品（セット）取込" },
  { id: "screen-csv", label: "CSV ダウンロード" },
  { id: "screen-templates", label: "テンプレート管理" },
  { id: "screen-masters", label: "マスタ取込" },
  { id: "screen-masters-related", label: "関連商品抽出" },
  { id: "screen-rule-audit", label: "ルール監査" },
  { id: "screen-history", label: "作業履歴" },
  { id: "screen-settings", label: "設定" },
];

export default function HelpPage() {
  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold">ヘルプ</h1>
      <p className="text-sm text-slate-500">
        困ったときはこのページ。各画面の「?」ボタンからも、その画面の説明へ直接飛べます。
      </p>

      {/* 目次 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">📑 目次</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-3">
          <div>
            <p className="font-semibold mb-1">
              <a href="#screen-dashboard" className="text-blue-600 hover:underline">
                1. 画面ごとの手順
              </a>
            </p>
            <ul className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-slate-600">
              {SCREEN_TOC.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-blue-600 hover:underline">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <ul className="space-y-1">
            <li>
              <a href="#fail-required" className="text-blue-600 hover:underline">
                2. よくある失敗と直し方
              </a>
            </li>
            <li>
              <a href="#glossary" className="text-blue-600 hover:underline">
                3. 用語集
              </a>
            </li>
            <li>
              <a href="#tech-spec" className="text-blue-600 hover:underline">
                4. 技術仕様（開発者向け）
              </a>
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* 1. 画面ごとの手順 */}
      <h2 className="text-lg font-bold pt-2">📖 1. 画面ごとの手順</h2>

      <HelpSection id="screen-dashboard" title="🏠 ダッシュボード">
        <p>ログイン直後に開く「全体のようす」を見る画面です。登録済みの商品数や最近の状況をひと目で確認できます。</p>
        <p>ここから作業は始めません。左のメニューで目的の画面（商品一覧・CSV ダウンロードなど）へ移動してください。</p>
      </HelpSection>

      <HelpSection id="screen-products" title="📦 商品一覧">
        <p>登録済み商品を探して、その場で価格を直したり、モール（楽天・Yahoo）へ反映したりする画面です。</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>上の検索ボックスに NEコード・商品名・JANコード のどれかを入力して絞り込む</li>
          <li>「楽天: 掲載中/未掲載」「Yahoo: 掲載中/未掲載」のプルダウンでさらに絞り込める</li>
          <li>価格の欄はその場で書き換え可能。入力をやめて 0.7 秒で自動保存される</li>
          <li>行の「楽天へ反映」「Yahooへ反映」ボタンで、そのモールの実ページに価格を反映</li>
          <li>チェックを付けて「一括反映」「一括モール登録」も可能（失敗した分だけ再実行ボタンあり）</li>
          <li>チェックした商品は「選択を一括CSV出力」で CSV ダウンロード画面へ引き継げる</li>
        </ol>
        <p className="text-slate-500">💡 反映やモール登録の前に、まずドライラン（お試し実行）で内容を確認できます。</p>
      </HelpSection>

      <HelpSection id="screen-product-edit" title="✏️ 商品編集">
        <p>1 商品の中身を作り込む画面です。左がフォーム、右が本番ストア風のプレビュー（楽天/Yahoo/Shopify タブ）。</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>左のフォームを上から入力。入力をやめて 0.8 秒で自動保存される（保存ボタンを押し忘れても大丈夫）</li>
          <li>「モール基本」のカテゴリID を入力すると、Yahoo カテゴリとそのカテゴリの必須属性が自動で読み込まれる</li>
          <li>画像は複数枚まとめて選択、またはドラッグ&ドロップで一度にアップロードできる</li>
          <li>よく使う内容は「テンプレートとして保存」しておくと、次回の新規作成が速くなる</li>
        </ol>
        <p className="text-slate-500">
          ⚠ 「保存できませんでした」と出ても自動で再試行されます。急ぐときは「今すぐ保存し直す」ボタンを押してください。
        </p>
      </HelpSection>

      <HelpSection id="screen-bulk-register" title="🗂 一括登録">
        <p>複数の商品をまとめて表形式（グリッド）で入力し、モールへ一括で登録する画面です。</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>グリッドに商品を入力（コピー&ペーストで複数行まとめて貼り付けも可能）</li>
          <li>まずドライラン（お試し実行）で内容をチェックし、エラーがないか確認する</li>
          <li>問題なければ本実行でモールへ登録する</li>
        </ol>
        <p className="text-slate-500">💡 失敗した行があっても途中で止まらず、失敗した分だけ後から再実行できます。</p>
      </HelpSection>

      <HelpSection id="screen-bulk-images" title="🖼 画像一括アップロード">
        <p>1つの商品の画像をまとめてモール（楽天 R-Cabinet / Yahoo / Shopify）へアップロードする画面です。1回の実行で扱えるのは1商品です。</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>対象の商品を検索で選ぶ（または商品コードを直接入力する）</li>
          <li>画像ファイルをドラッグ＆ドロップで取り込み、並び順を確認・入れ替えする</li>
          <li>アップロード先のモールを選んで実行する（アップロード後の画像名は商品コードから自動で決まる）</li>
        </ol>
        <p className="text-slate-500">💡 楽天に登録済みの商品は、現在の画像を読み込んでから並び替え・差し替えできます。商品編集画面の画像パネルでも同じことができます。</p>
      </HelpSection>

      <HelpSection id="screen-migrate" title="🚚 楽天→Yahoo 一括移行">
        <p>楽天に登録済みの商品を取り込んで Yahoo 向けに変換し、まとめて Yahoo へ登録する画面です。</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>楽天から商品を取り込む（管理番号などで指定）</li>
          <li>カテゴリは楽天ジャンル→Yahoo カテゴリの対応表で自動変換される</li>
          <li>対応表に見つからない商品は Yahoo カテゴリID を手入力してから登録する</li>
          <li>ドライランで確認 → Yahoo へ登録</li>
        </ol>
      </HelpSection>

      <HelpSection id="screen-sale-support" title="🏷 セール支援（楽天スーパーセール）">
        <p>楽天の商品を一括で値引きし、販売期間（購入可能期間）を設定する画面です。実行前に元価格の控えとして「-SS 倉庫コピー」（非公開）を自動作成するので、セール後に元へ戻せます。</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>「セール適用」タブに商品管理番号を貼り付け、値引き％・販売期間・二重価格の有無を指定する</li>
          <li>「プレビュー」で SKU ごとの割引後価格（税込×(1-％) 切り捨て）を確認する</li>
          <li>「実行」で -SS コピー作成 → 値引き・期間設定 → 読み戻し検証まで一括実行される</li>
          <li>セール終了後は「復元」タブで -SS コピーを選び、価格・二重価格・販売期間を書き戻す（-SS は削除するか残すかを選べる）</li>
        </ol>
        <p className="text-slate-500">
          💡 既に -SS コピーがある商品は上書きせず対象外になります。定期購入価格は変更しません。
        </p>
      </HelpSection>

      <HelpSection id="screen-related-import" title="🧩 関連商品（セット）取込">
        <p>単品に対する「セット商品」（例: 1本に対する 6本セット）を関連付けて取り込む画面です。</p>
        <p>取り込むと、1 つの商品ページの中に単品/セットのバリエーション（SKU）としてまとまり、SKU ごとに価格・配送を編集できるようになります。</p>
      </HelpSection>

      <HelpSection id="screen-csv" title="📥 CSV ダウンロード">
        <p>登録済み商品を各モール向けの CSV ファイルにして、まとめてダウンロードする画面です。</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>検索ボックス（NEコード・商品名）で対象商品を絞り込む</li>
          <li>「絞り込んだ結果だけ全選択」で、いま見えている商品をまとめてチェック</li>
          <li>5 形式（楽天 / Yahoo / NE単品 / NEセット / Shopify）が 1 つの ZIP でダウンロードされる</li>
        </ol>
        <p className="text-slate-500">💡 商品一覧でチェックして「選択を一括CSV出力」から来ると、最初からチェックが付いた状態で開きます。</p>
      </HelpSection>

      <HelpSection id="screen-templates" title="📋 テンプレート管理">
        <p>商品編集画面の「テンプレートとして保存」で作ったひな型を一覧・削除する画面です。</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>よく使う商品を開き、商品編集で「テンプレートとして保存」（名前を付ける）</li>
          <li>新規商品を作るときに「テンプレートから始める」を選ぶと、保存した内容がフォームに流し込まれる</li>
        </ol>
        <p className="text-slate-500">
          💡 商品固有の項目（NEコード・JANコード・商品名・価格）は流し込まれず空のままです。うっかり別商品の値を引き継ぐ事故を防ぐためです。
        </p>
      </HelpSection>

      <HelpSection id="screen-masters" title="🗄 マスタ取込">
        <p>NE（ネクストエンジン）の商品マスタや Excel の商品管理シートを取り込んで、アプリ内の「統合商品マスタ」（台帳）を作る画面です。</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>NE や Excel から出力した CSV / シートを用意する</li>
          <li>取込元（NE 各マスタ / Excel）ごとにファイルを選んで取り込む</li>
          <li>NEコードを軸に 1 つの台帳へ統合される</li>
        </ol>
      </HelpSection>

      <HelpSection id="screen-masters-related" title="🔎 関連商品抽出">
        <p>取り込んだマスタから「一緒に見直すべき関連商品」を探す画面です。</p>
        <p>例えば単品を値上げするとき、その単品を含むセット商品を漏れなく洗い出せます。値上げ・価格改定の下調べに使ってください。</p>
      </HelpSection>

      <HelpSection id="screen-rule-audit" title="🧭 ルール監査">
        <p>登録済みの商品が命名・説明文などの社内ルールに合っているかを一括チェックする画面です。出品前の点検に使ってください。</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>画面を開くと全商品がスキャンされ、ルール違反のある商品が理由付きで一覧表示される</li>
          <li>行のリンクから商品編集画面を開いて修正する</li>
          <li>商品編集のモール別パネルでは、AI（Codex）による修正案の提案も使える</li>
        </ol>
      </HelpSection>

      <HelpSection id="screen-history" title="🕒 作業履歴">
        <p>「あれ、いつ変えたっけ？」を調べる画面です。新規作成・編集・削除・CSV 出力の記録が新しい順に並びます。</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>「操作の種類」「商品コード」「期間（今日/今週/日付指定）」で絞り込む</li>
          <li>商品コードを押すと、その商品の編集画面が開く（削除済みの商品はリンクなし）</li>
          <li>「さらに100件表示」で、より古い記録をたどれる</li>
        </ol>
      </HelpSection>

      <HelpSection id="screen-settings" title="⚙️ 設定">
        <p>アプリの設定画面です。現在は準備中で、今後のアップデートで使えるようになる予定です。</p>
      </HelpSection>

      {/* 2. よくある失敗と直し方 */}
      <h2 className="text-lg font-bold pt-2">🚑 2. よくある失敗と直し方</h2>
      <p className="text-sm text-slate-500">アプリが実際に出すメッセージ別に、直し方をまとめました。</p>

      <HelpSection id="fail-required" title="「必須項目不足: …」と出て登録できない">
        <p>モールへの登録に必要な項目が埋まっていません。商品編集画面を開き、メッセージに書かれた欄を入力してください。</p>
        <p>
          楽天は商品のジャンル（カテゴリ）ごとに「必ず書く属性」（内容量・原産国など）が決まっており、これは商品編集の「商品属性」欄に入力します。
        </p>
        <p className="text-slate-500">
          💡 カテゴリID を入力すると必須属性の項目が自動で読み込まれます（項目は自動で並びますが、値は自分で入力してください）。
        </p>
      </HelpSection>

      <HelpSection id="fail-yahoo-image" title="Yahoo 登録で画像エラー（it-14091）が出る">
        <p>Yahoo に商品を登録するとき、画像がまだ Yahoo 側の画像置き場（lib）に無いと、このエラーになります。</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>商品編集の画像アップロード欄で「⤴ 取込画像をYahoo libへ転送」を押す</li>
          <li>転送が終わってから、あらためて「Yahooへ登録」を押す</li>
        </ol>
        <p className="text-slate-500">💡 順番が大事です。「先に画像、あとで登録」と覚えてください。</p>
      </HelpSection>

      <HelpSection
        id="fail-category-mapping"
        title="「カテゴリID … に対応するYahooカテゴリが見つかりませんでした」"
      >
        <p>楽天のジャンルから Yahoo のカテゴリへ自動変換する対応表に、その商品のカテゴリが載っていなかったときに出ます。</p>
        <p>
          商品編集の「Yahoo grouping」セクションで Yahoo カテゴリID を手入力してください。Yahoo の店舗管理画面やカテゴリ一覧で、商品に合うカテゴリの番号を調べて貼り付けます。
        </p>
      </HelpSection>

      <HelpSection id="fail-ne-code" title="「このNEコードは既に使われています」">
        <p>NEコードは商品ごとの背番号で、同じ番号を 2 つの商品に付けることはできません。</p>
        <p>別の NEコードに変えて保存してください。既存商品を直したいだけなら、新規作成ではなく商品一覧からその商品を開いて編集します。</p>
      </HelpSection>

      <HelpSection id="fail-autosave" title="「⚠ 保存できませんでした」（自動保存の失敗）">
        <p>一時的な通信エラーなどで自動保存に失敗した状態です。自動で何度か再試行されるので、多くの場合は待つだけで直ります。</p>
        <ul className="list-disc list-inside space-y-1">
          <li>急ぐときは表示内の「今すぐ保存し直す」ボタンを押す</li>
          <li>直らないときはインターネット接続を確認する</li>
        </ul>
        <p className="text-slate-500">⚠ 保存に失敗したままページを閉じようとすると確認が出ます。入力を失わないよう、保存が済んでから閉じてください。</p>
      </HelpSection>

      {/* 3. 用語集 */}
      <h2 className="text-lg font-bold pt-2">📚 3. 用語集</h2>

      <HelpSection id="glossary" title="はじめての人のための用語集">
        <dl className="space-y-3">
          <Term name="モール">
            楽天市場・Yahoo!ショッピングなど、ネット上のショッピングセンターのこと。同じ商品でもモールごとに売り場（商品ページ）を作ります。
          </Term>
          <Term name="NEコード">
            ネクストエンジンで商品を管理するための「背番号」。このアプリでは商品 1 つに 1 つ、重複なしで付けます。
          </Term>
          <Term name="JANコード">
            商品パッケージのバーコードの数字（13 桁）。世界共通の商品番号で、同じ商品ならどのお店でも同じ番号です。
          </Term>
          <Term name="SKU">
            同じ商品ページの中の「買える単位」のこと。たとえば「1本」と「6本セット」は同じページでも別々の SKU で、それぞれに価格や送料を設定できます。
          </Term>
          <Term name="API">
            アプリとモールがプログラム同士で直接やり取りするための「窓口」。人が管理画面でポチポチやる操作を、アプリが代わりに自動で行えます。
          </Term>
          <Term name="CSV">
            表をカンマ区切りの文字にしたファイル。Excel で開けます。モールの管理画面に商品をまとめて登録するときの「持ち込み書類」のような役割です。
          </Term>
          <Term name="ZIP">
            複数のファイルを 1 つに圧縮した「まとめ袋」。CSV ダウンロードでは 5 形式の CSV が 1 つの ZIP で届きます。
          </Term>
          <Term name="ドライラン">
            本番には送らず「もし実行したらどうなるか」だけを確認するお試し実行。失敗しても実データには影響しないので、一括作業の前に必ず一度どうぞ。
          </Term>
          <Term name="R-Cabinet">
            楽天の画像置き場（倉庫）。楽天の商品ページに載せる画像は、まずここへアップロードしてから使います。
          </Term>
          <Term name="マスタ">
            商品情報の「台帳」。NE や Excel から取り込んだ元データのことで、アプリはこれを 1 つに統合して管理します。
          </Term>
          <Term name="カテゴリID・ジャンル">
            商品がモールのどの「売り場（棚）」に置かれるかを表す番号。楽天では「ジャンル」、Yahoo では「カテゴリ」と呼びますが、役割は同じです。
          </Term>
          <Term name="必須属性">
            カテゴリ（棚）ごとにモールが「これは必ず書いてください」と決めている項目。食品なら内容量や原産国など。足りないと登録が弾かれます。
          </Term>
          <Term name="自動保存">
            入力の手を止めて少し待つと、自動でサーバーに保存される仕組み。商品編集は約 0.8 秒、商品一覧の価格編集は約 0.7 秒で保存されます。
          </Term>
          <Term name="テンプレート">
            よく使う入力内容の「ひな型」。新規作成のときに流し込めば、毎回同じ説明文や設定を打ち直す手間がなくなります。
          </Term>
        </dl>
      </HelpSection>

      {/* 4. 技術仕様 */}
      <h2 className="text-lg font-bold pt-2">⚙️ 4. 技術仕様（開発者向け）</h2>

      <HelpSection id="tech-spec" title="技術仕様">
        <ul className="space-y-1">
          <li>Next.js 16 (App Router) + React 19 + TypeScript</li>
          <li>Supabase (Auth + DB + RLS)</li>
          <li>Tailwind CSS 4 + 自前 UI コンポーネント</li>
        </ul>
        <p className="font-semibold pt-2">モール CSV 仕様（Phase 1 検証済み）</p>
        <ul className="space-y-1">
          <li>楽天 RMS: 親子構造、108 列、cp932 (Shift_JIS)</li>
          <li>Yahoo!ショッピング: 85 列、grouping-id + variation1 で集約、cp932</li>
          <li>ネクストエンジン (NE): 単品 94 列 + セット 92 列、utf-8 (BOMなし)</li>
          <li>Shopify: 60 列、画像複数行展開、utf-8 (BOM付き)、日本/国際マーケット対応</li>
        </ul>
      </HelpSection>
    </div>
  );
}
