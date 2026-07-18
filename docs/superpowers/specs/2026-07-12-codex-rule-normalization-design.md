# 商品説明文/画像ルール逸脱の検出とCodexによる再編集・反映 詳細設計書

> 作成: 2026-07-12 / 商品登録アプリ(webui) / Next.js + Supabase
> 元資料: `docs/superpowers/specs/2026-07-12-codex-rule-normalization-spec.md`（要件定義書）、
> `docs/kabeuchi/2026-07-12-codex-rule-normalization.md`（壁打ちサマリ）

## 1. アーキテクチャ概要

```
[商品一覧/DB] --(走査)--> [検出ロジック(純粋関数)] --> [ルール監査ページ]
                                                              |
                                                     商品を選んで編集画面へ
                                                              |
[商品編集画面] --「Codexでルール適用」--> [API Route] --child_process--> [codex app-server]
                                              |                              |
                                        お手本商品データ +              JSON提案
                                        対象商品データ(画像URL含む)  <-----+
                                              |
                                        差分表示 → 承認 → 保存
                                              |
                              (画像命名NGの場合) 実ファイル再アップロード
                                              |
                              既存の「差分確認→反映」フローでYahoo/楽天へ反映
```

- 検出ロジックは既存の `webui/lib/converters/` 群と同じ層に純粋関数として追加する
  （新規ファイル: `webui/lib/rule-audit/detect.ts` 想定）。
- Codex連携はサーバーサイド専用（Next.js API Route）に閉じ込め、ブラウザから直接
  `child_process` を呼ばない。
- 既存の「モール既存商品の編集（取込→差分→反映）」の設計思想
  （保存済み内容とモール現状を比較し、変更項目だけ送信）を踏襲し、
  Codex提案も「現状 vs 提案」の差分として同じ見せ方に寄せる。

## 2. データ設計

- **新規テーブル・カラムの追加は行わない**（YAGNI）。検出条件は既存の
  `sale_description_pc` / `image_url_1..20` / `description_pc` / `description_sp`
  から導出できる純粋な計算であり、永続化の必要がない。
- ルール監査ページは、商品一覧取得時に検出ロジックをその場で適用して
  違反商品を絞り込む（バッチジョブや事前計算テーブルは持たない）。
- Codexの提案内容は**ステートレスに扱う**（DBに一時保存しない）。
  APIレスポンスとしてブラウザに返し、承認時にブラウザから改めて
  「対象商品ID + 承認された提案内容」を保存APIへ渡す。
  理由: 既存の差分確認フローも同様にステートレスであり、設計の一貫性を保つため。
  （代替案: サーバー側に一時保存してIDで参照する方式もあるが、複雑さに見合う
  理由が無いため不採用）

## 3. 画面設計

### 3.1 ルール監査ページ（新規）

- パス: `/rule-audit`（仮称。既存のルーティング慣習に合わせて確定する）
- 表示項目: 商品名(NEコード)、違反理由バッジ（複数可: 「説明文HTML」「画像命名」
  「構造」）、商品編集画面へのリンク
- 一覧のみ。ここから直接編集・反映はしない（既存の商品編集画面に遷移させる）。

### 3.2 商品編集画面（既存拡張）

- 既存の「✏️ モール既存商品の編集（取込→差分→反映）」パネル内に
  「🤖 Codexでルール適用」ボタンを追加。
- クリック時の流れ:
  1. サーバーへ「対象商品ID」を送信（お手本商品IDは固定値としてサーバー側で保持）
  2. ローディング表示（Codex生成は数十秒かかり得るため、待機中である旨を明示）
  3. 提案が返ったら、既存の「差分を確認」と同様の見た目で
     現状 vs 提案の差分（説明文HTML、画像URL順序・命名）を表示
  4. 「承認」を押すと、提案内容がフォームへ反映される（この時点ではまだ未保存）
  5. 画像命名が変わる項目があれば、保存時に実ファイル再アップロードが必要な旨を
     案内する
  6. 通常の「保存」→「◯◯へ反映」で確定（既存フローに合流）

## 4. API / インタフェース設計

| エンドポイント | メソッド | 役割 |
|---|---|---|
| `/api/rule-audit` | GET | 全商品を走査し違反商品一覧を返す |
| `/api/products/[id]/codex-normalize` | POST | 対象商品IDを受け取り、codex app-serverを呼び出し提案JSONを返す |

### `/api/products/[id]/codex-normalize` 入出力（案）

```
Request:  { productId: string }
Response: {
  proposal: {
    sale_description_pc: string,   // 提案後の値（空文字列を含む）
    description_pc: string,
    description_sp: string,
    image_order: string[],         // 提案後の画像URL並び（既存プールからの並べ替え）
    image_naming_changes: [{ from: string, to: string }],
    notes: string                  // Codexが付与した判断理由・保持した訴求情報の説明
  },
  reference_product_id: string    // 使用したお手本商品ID
}
```

上記は「アプリの外部インタフェース」であり、`codex app-server`との実際の通信は
この内部で吸収する。

### 4.1 codex app-server との実通信プロトコル（技術調査済み、2026-07-12）

ローカル環境の `codex` CLI（v0.145.0-alpha.4、認証済み・稼働確認済み）で
`codex app-server generate-json-schema --out <dir>` を実行し、実際の
JSON-RPCプロトコルスキーマを取得して確認した。

- **トランスポート**: 既定 `stdio://`（`--listen` で `unix://`/`ws://` も選択可）。
  `child_process.spawn('codex', ['app-server'])` を起動し、stdin/stdoutで
  JSON-RPCメッセージ（`JSONRPCRequest`/`JSONRPCResponse`/`JSONRPCNotification`）
  をやり取りする設計で問題ない。
- **呼び出しフロー**:
  1. `initialize`（`clientInfo: {name, version}` 必須）でハンドシェイク
  2. `thread/start`（`ThreadStartParams`: `cwd`, `sandbox`, `approvalPolicy`等）→
     応答で `threadId` を取得
  3. `turn/start`（`TurnStartParams`: 必須 `threadId` + `input: UserInput[]`）で
     プロンプトを送信
  4. `turn/started` → （進捗系notification） → `turn/completed` の
     `ServerNotification` を待って結果を受け取る
- **画像入力**: `UserInput` は `oneOf` で `TextUserInput`
  （`{type:"text", text:"..."}`）と `ImageUserInput`
  （`{type:"image", url:"..."}`、リモートURLをそのまま渡せる）を混在配列で渡せる。
  ローカルファイルなら `LocalImageUserInput`（`{type:"localImage", path:"..."}`）。
  → 要件定義書5.3「画像URL経由での画像内容判断」はこの`image`入力タイプで実現できる。
- **構造化出力（重要）**: `TurnStartParams.outputSchema` に任意のJSON Schemaを
  渡すと、Codexの最終応答（agent message）がそのスキーマに準拠する形に
  制約される（Structured Output）。4章の`proposal`レスポンス契約をそのまま
  `outputSchema`として渡せば、パース・バリデーションの手間が減る。
- **常駐化**: 案Bを取る場合、独自にプロセス管理を実装しなくても
  `codex app-server daemon` という公式の常駐デーモンサブコマンドがある
  （`--listen unix://`等と組み合わせ）。将来案B移行時はまずこれを検討する。
- 生成したスキーマ一式（`ClientRequest.json`, `ServerNotification.json`,
  `TurnStartParams.json`, `UserInput`定義 等）はスクラッチパッドに出力済み。
  実装着手時に `codex app-server generate-json-schema --out <dir>` を再実行し、
  型定義（`--experimental`を付ければ実験的フィールドも含む）をプロジェクト内
  （例: `webui/lib/rule-audit/codex-schema/`）に取り込んでから実装するとよい。

**残る未確定**: 認証はCLIの`~/.codex/auth.json`（ChatGPT authモード）に
依存しており、アプリのサーバープロセスから起動した`codex`もこのローカル
認証情報を継承する想定（未検証）。`turn/completed`のペイロード構造
（`ServerNotification.json`内定義）の詳細と、エラー時のハンドリング
（`turn/interrupt`等）は実装時に確認する。

### Codexプロセスのライフサイクル（設計判断・要確認）

- **案A（推奨）**: リクエストごとに `child_process.spawn('codex', ['app-server'])`
  を起動し、応答を受け取ったら終了する。実装が単純。ローカル開発限定・
  低頻度利用が前提なので同時実行の懸念も小さい。
- **案B**: サーバー起動時に1プロセスを常駐させ、リクエストのたびにJSON-RPC
  メッセージを送る。プロセス起動コスト（数秒）を毎回払わずに済むが、
  プロセス管理（クラッシュ時の再起動、同時リクエストのキューイング）の
  実装が増える。
- 推奨: まず案Aで実装し、体感速度が問題になれば案Bへ移行する。

## 5. 計算・業務ロジック設計

### 5.1 検出ロジック（純粋関数、新規: `webui/lib/rule-audit/detect.ts`）

```
detectRuleViolation(product: ProductInput): {
  violated: boolean,
  reasons: ("description_html" | "image_naming" | "structure")[]
}
```

- `description_html`: `product.sale_description_pc !== ""`
- `image_naming`: `image_url_1..N` のファイル名が
  `webui/lib/converters/image-url.ts` の命名規則（楽天基準）と不一致
- `structure`: `description_pc`/`description_sp` のHTML構造が典型パターンと
  乖離（判定ロジックの厳密な定義は未確定。実装時にお手本含む複数正常商品の
  サンプルから帰納的にルール化する）

### 5.2 機械的修正ロジック（新規: `webui/lib/rule-audit/auto-fix.ts`）

- `sale_description_pc` を空文字列にする変更を提案する関数
  （Codexを呼ばずに済むケースの一次判定に使う）
- 画像ファイル名が規則外の場合の「期待されるファイル名」を算出する関数
  （実際のリネーム＝再アップロードの実行は既存の画像アップロードAPIに委譲）

### 5.3 Codex連携ロジック（新規: `webui/lib/rule-audit/codex-client.ts`）

- プロンプト組み立て: お手本商品データ + 対象商品データ（テキスト全般 + 画像URL）
  をCodexへの入力として構造化する
- レスポンスパース・バリデーション: Codexからの応答が期待するJSONスキーマに
  合致するか検証し、不一致なら安全側（提案を採用しない）に倒す

## 6. 権限・セキュリティ設計

- ローカル開発環境限定のため、追加の認証機構は設けない（既存アプリの認証方式
  に従う）。
- `codex app-server` を起動するサーバープロセスの実行権限・作業ディレクトリは
  必要最小限にする（対象商品データ以外のファイルシステムへアクセスさせない）。
- Codexへ渡す画像URLは既存の楽天R-Cabinet/Yahoo画像サーバーの公開URLであり、
  外部への新規データ流出経路にはならない想定。ただし商品説明文に個人情報等が
  含まれないことは前提とする（既存データの性質上、通常は問題ないと考えられる）。

## 7. テスト方針

- **検出ロジック**: ユニットテストで境界値をカバー
  （`sale_description_pc`が空/非空、画像ファイル名が規則通り/外れの境界、
  複数理由が同時に該当するケース）
- **機械的修正ロジック**: 入力商品→期待される修正後の値、を突き合わせるテスト
- **Codex連携**: 外部プロセスに依存するため、`codex app-server`本体は
  モック化してユニットテストする。実際のCodex呼び出しを含む動作確認は
  手動E2E（ローカル環境でお手本商品・対象商品の実データを使って確認）とする。
- 受入基準（要件定義書8章）との対応: ルール監査ページの一覧表示、差分表示、
  承認後の保存・反映まで一連の動作を手動E2Eで確認する。

## 8. 未確定事項と設計上の保留（決め方付き）

- ~~Codex app-serverの正確なJSON-RPCスキーマ~~ —
  **解消済み（2026-07-12技術調査）**。4.1節参照。`initialize`→`thread/start`→
  `turn/start`（`outputSchema`で構造化出力を強制可）→`turn/completed`待ち、
  画像は`ImageUserInput{type:"image",url}`で直接渡せることを確認済み。
  残るのはローカル認証継承の検証と`turn/completed`ペイロード詳細のみ
  （実装時に確認）。
- **Codexプロセスのライフバイクル方式（案A/B）** —
  保留（決め方: まず案Aで実装し、体感速度を見て必要なら案Bへ移行）
- **新しい画像素材の調達元**（既存20枠内の並べ替えのみか、新規アップロードも
  想定するか） —
  保留（決め方: 実装を進めながらユーザーが使用感を見て判断）
- **半自動フローの承認単位**（1商品ずつか、まとめて複数か） —
  保留（決め方: 実装しながら運用感を見て調整）
- **説明文HTML構造の「典型パターン」の厳密な定義** —
  保留（決め方: お手本含む複数正常商品サンプルから帰納的に定義）
- **ルール監査ページのパス名**（`/rule-audit`は仮称） —
  保留（決め方: 実装時に既存ルーティング命名慣習と照合して確定）
