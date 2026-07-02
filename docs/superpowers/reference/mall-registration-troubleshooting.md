# 商品登録（楽天・Yahoo）逆引きトラブルシューティング

実機E2Eで得た知見の逆引き資料。**症状 / エラーコード → 原因 → 対処 → 根拠（ファイル・実測日）** の形式。
最終更新: 2026-07-03（登録系E2E 3周連続 9/9 green + バリエーション検証の実測を反映）。

## 目次

1. [E2E 実行の前提と手順](#1-e2e-実行の前提と手順)
2. [エラーコード逆引き（楽天 ItemAPI 2.0）](#2-エラーコード逆引き楽天-itemapi-20)
   - IE0418 / IE0228 / GE0014 / IE0269 / IE0153 / IE0229
3. [エラーコード逆引き（Yahoo!ショッピング）](#3-エラーコード逆引きyahooショッピング)
   - it-14091 / im-02005 / it-01004 / pm-05001
4. [症状から引く（エラーコードが出ないケース）](#4-症状から引くエラーコードが出ないケース)
5. [仕様・規約の逆引き（安全既定・命名規約）](#5-仕様規約の逆引き安全既定命名規約)
6. [反復実行の安定性記録（flake 調査）](#6-反復実行の安定性記録flake-調査)
7. [新知見（2026-07-03 バリエーション検証）](#7-新知見2026-07-03-バリエーション検証)

検索キーワード: 商品登録 一括登録 bulk register dry-run commit 楽天 items.upsert items.patch items.delete
Yahoo editItem getItem deleteItem reservePublish submit 反映予約 JAN チェックディジット ジャンル必須属性
genreId manageNumber 上書きガード overwrite mall_listed 後始末 cleanup 倉庫 非公開 display=0 多SKU variants
variantSelectors 75字 文字数 切詰め truncation

---

## 1. E2E 実行の前提と手順

### 前提

| 項目 | 内容 |
|---|---|
| dev server | `webui/` で Next.js dev server が `http://localhost:3000` に稼働していること |
| env | `webui/.env.local` に Supabase（`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`）、楽天 ESA（`getRakutenCredentialsFromEnv` が読む鍵）、Yahoo OAuth（`getYahooConfig` が読む鍵）が設定済み |
| 実行ユーザー | E2E は Supabase の `kmzt.i-0001@kurocommerce.com` に magiclink でログインして API を叩く |
| 実モール送信 | E2E は実際に楽天/Yahoo のストアへ登録する。**安全規約（下記）厳守** |

### 安全規約（テスト商品）

- **命名**: maker_code は `zzz` 系（多SKUの旧E2Eは `zzv`）。楽天 manageNumber は `zzz-<JAN下4桁>`、Yahoo item_code は `zzz-...`。本番商品と衝突しない。
- **JAN**: 必ず有効なチェックディジットで作る（不正JANは楽天 IE0228 → §2）。検証用の実測済み有効JAN例: `4955028005994` / `4955028004997` / `4955028003990`。
- **掲載状態**: 楽天は必ず倉庫=非公開（`hideItem: true`）+ サーチ在庫非表示 + 在庫0。Yahoo は必ず `display=0`（非公開）。
- **publish / submit（反映予約）は一切呼ばない**。Yahoo の `reservePublish` はストア全体単位のため、テストで呼ぶと無関係の編集中項目まで公開反映されうる（→ §5）。
- **同時最大5件**まで。E2E 完走後にモール（楽天 `items.delete` / Yahoo `deleteItem`）と DB（`products` 行）の両方から削除する。
- Yahoo で `item_image_urls` を送る場合は参照画像を先に lib アップロードする（無いと it-14091 → §3）。画像を送らないテストは `image_count: 0`。

### 実行コマンド（`webui/` で実行）

```bash
# 登録系E2E 一式を3周（反復・flake確認。結果JSONは --out へ）
npx tsx tests/run_e2e_repeat.mjs --rounds 3 --out ../logs/e2e_repeat_runs.json

# 個別実行
npx tsx tests/e2e_bulk_register.mjs           # 一括登録（楽天dry-run/commit/上書きガード + Yahoo）
npx tsx tests/e2e_register_rakuten.mjs        # 楽天 単品登録（upsert→get→delete）
npx tsx tests/e2e_register_yahoo_nosubmit.mjs # Yahoo 登録（editItemのみ・反映予約なし）
npx tsx tests/e2e_bulk_variations.mjs         # バリエーション検証（多SKU/属性なし/75字境界）

# 品質ゲート
npx vitest run        # ユニット/ルートテスト
npx tsc --noEmit      # 型チェック
```

`tests/e2e_register_yahoo.mjs`（本家）は commit で `submit: true`（reservePublish）まで行うため、
**submit 禁止の運用では `e2e_register_yahoo_nosubmit.mjs` を使う**（同一フローの安全変種、2026-07-03 追加）。

---

## 2. エラーコード逆引き（楽天 ItemAPI 2.0）

### IE0418 — Invalid attribute or genreId is set.（ジャンル必須属性の欠落）

| | |
|---|---|
| 症状 | `items.upsert` が HTTP 400。`The mandatory attributes are missing. attributeNames: メーカー型番, タイトル, 発売元`（ジャンル 553575 の場合）。`propertyPath: variants.{SKUキー}.attributes` |
| 原因 | ジャンル（genreId）ごとに定義された必須商品属性が `variants.{}.attributes[]` に入っていない |
| 対処 | 対象ジャンルの必須属性（例: 553575 は「メーカー型番」「タイトル」「発売元」）を商品の `extra.attributes` に `{item, value}` で持たせる。属性はSKU（variant）に同梱される |
| 注意 | **dry-run では検出されない**（`validateUpsertBody` は属性を検査しない）。commit で初めて発覚する → §7 新知見1 |
| 根拠 | 実測 2026-07-03（`tests/e2e_bulk_variations.mjs` V2）。生成側: `webui/lib/converters/rakuten-api.ts` `buildRakutenAttributes` |

実測レスポンス（2026-07-03、属性なし商品を upsert）:

```json
{"errors":[{"code":"IE0418","message":"Invalid attribute or genreId is set.",
  "metadata":{"details":[{"code":"invalidAllMandatoryAttributes",
    "message":"The mandatory attributes are missing. attributeNames: メーカー型番, タイトル, 発売元"}],
  "propertyPath":"variants.zzz-4997-1.attributes"}}]}
```

### IE0228 — Invalid articleNumber is set.（JAN チェックディジット不正）

| | |
|---|---|
| 症状 | `items.upsert` が HTTP 400。`propertyPath: variants.{SKUキー}.articleNumber.value` |
| 原因 | `articleNumber.value` に入れた13桁JANのチェックディジットが不正（例: `4955028001999`。正しくは `...1996`） |
| 対処 | テストJANも必ず有効なチェックディジットで生成する。JANが無い/不正な商品は `articleNumber: { exemptionReason: 3 }`（店舗オリジナル）で送る（13桁数字でなければ変換層が自動で exemptionReason に倒す） |
| 根拠 | 実測 2026-07-03（不正JAN `4955028001999` を直接 upsert → 400 IE0228）。変換: `webui/lib/converters/rakuten-api.ts` L147-148 |

### GE0014 — Not found for inputs（対象商品なし）

| | |
|---|---|
| 症状 | `items.delete` / `items.get` が HTTP 404。`{"errors":[{"code":"GE0014","message":"Not found for inputs; manageNumber=..."}]}` |
| 原因 | 指定 manageNumber の商品が存在しない（既に削除済み・登録前・番号違い） |
| 対処 | 後始末の二重削除では正常系として扱ってよい（削除済みの証拠）。登録直後の get で出る場合は反映ラグ → 2秒程度待って再取得（E2E は `sleep(2000)` 後に確認している） |
| 根拠 | 実測 2026-07-03（存在しない `zzz-nonexistent-0000` を delete → 404 GE0014）。`webui/lib/rakuten/item-client.ts` `deleteItem` |

### IE0269 — 多SKUで variantSelectors 欠落

| | |
|---|---|
| 症状 | 多SKU（variants 2件以上）の upsert が拒否される |
| 原因 | 多SKUでは `variantSelectors`（バリエーション軸）+ 各 variant の `selectorValues` が必須 |
| 対処 | アプリの変換層が単軸 `type`（表示名は `yahoo_variation_title` か「タイプ」）と選択肢ラベル（`variation_value` → 数量 → 連番の順で採用・重複は連番付与）を自動生成する。直接 body を組む場合は同様に付与する |
| 根拠 | `webui/lib/converters/rakuten-api.ts` L137-141（実機検証済みコメント）。一括経路での自動生成は実測 2026-07-03（§7 新知見3） |

### IE0153 / patch の shipping マージ罠

| | |
|---|---|
| 症状 | `items.patch` で送料モード切替（個別送料⇔送料無料など）が反映されない・IE0153 になる |
| 原因 | patch の `shipping`(object) はマージ動作（省略キーは旧値保持）。個別送料fee付きSKUに `postageIncluded: true` だけ送ると矛盾状態になる |
| 対処 | 切り替えで使わなくなるキーを明示的に `null` で送ってクリアする（`buildVariantShippingForPatch`。null クリアは実機で成功確認済み） |
| 根拠 | `webui/lib/converters/rakuten-api.ts` L33-59（実機検証済みコメント） |

### 409 Conflict — patch での variant 追加/削除

| | |
|---|---|
| 症状 | SKU（variant）の追加・削除を patch で送ると 409 になる／別variant新規作成と誤認され IE0269/IE0229/IE0418 |
| 原因 | patch は既存 variant キー前提。キー集合が変わる操作は patch で表現できない |
| 対処 | variant の追加・削除を伴う変更は upsert（全置換）で送る |
| 根拠 | `webui/lib/converters/rakuten-patch.ts` L79 コメント（実機検証由来）。MEMORY: 多SKU対応(P1-P5a) |

---

## 3. エラーコード逆引き（Yahoo!ショッピング）

### it-14091 — 画像未存在／画像紐づけ未伝播

| | |
|---|---|
| 症状 | `editItem` がエラーまたは warning（Message は CDATA で返ることがある） |
| 原因 | `item_image_urls` が参照する画像が lib（追加画像）に存在しない、またはアップロード直後で紐づけが未伝播 |
| 対処 | (1) 画像を先に `uploadLibImage` でアップロードしてから editItem（実フロー順）。(2) アップ直後なら 1.5〜2秒待つ。(3) 移行経路は短い待機後1回だけ自動リトライ実装あり。(4) 画像を送らないテストは `image_count: 0` にして `item_image_urls` 自体を送らない |
| 根拠 | `webui/tests/e2e_bulk_register.mjs` L55-56 / `webui/lib/migrate/executor.ts` L289-427 / `webui/lib/yahoo/item-client.ts` L20。反復実測 2026-07-03: 画像先行アップ+1.5s待機の順なら 3周連続で再発なし |

### im-02005 — 画像未存在（画像API側）

| | |
|---|---|
| 症状 | editItem 失敗。メッセージに `im-02005` |
| 原因 | 参照画像が存在しない（it-14091 と同族。伝播遅延の可能性あり） |
| 対処 | it-14091 と同じ（待機→リトライ、参照整合の再構築） |
| 根拠 | `webui/lib/migrate/executor.ts` L422-427（`isImageNotReady` 判定） |

### it-01004 — item_code 書式不正

| | |
|---|---|
| 症状 | editItem が item_code を拒否 |
| 原因 | item_code に使える文字は半角英数とハイフンのみ・99文字以内（`_` 等は不可） |
| 対処 | アプリは `validateEditItemParams` が送信前に検査して dry-run の missing に載せる（前倒し検出）。NEコード由来の item_code に `_` を入れない |
| 根拠 | `webui/lib/yahoo/item-mapper.ts` L305-309 |

### pm-05001 — 未反映の項目がない

| | |
|---|---|
| 症状 | `reservePublish`（反映予約）がエラーを返す |
| 原因 | 反映すべき編集中項目が無い（既に反映済み） |
| 対処 | 「既に反映済み」として成功扱いにする（クライアント実装済み） |
| 根拠 | `webui/lib/yahoo/item-client.ts` L97-115 |

---

## 4. 症状から引く（エラーコードが出ないケース）

### 「dry-run で invalid になる（楽天）」

- **missing に `genreId(6桁)`**: `mall_category_id` が空か6桁数字でない。楽天ジャンルID（6桁）を設定する。
  dry-run（一括: `POST /api/register/bulk/rakuten` 既定 / 単品: `GET /api/register/rakuten/[id]?dryRun=1`）で
  invalid 判定になり、commit 対象から自動で外れる（invalid 商品が混ざっていても他の商品は登録される）。
  根拠: `webui/lib/converters/rakuten-api.ts` `validateUpsertBody` L193 / 実測: `tests/e2e_bulk_register.mjs` P3（3周連続で invalid=1 検出）。
- **注意**: ジャンル必須属性の欠落は dry-run で検出されない（IE0418 → §2）。

### 「commit したのに登録されずスキップされた」

- 既存商品あり + `overwrite` 未指定 → `action: "skip"`, `willOverwrite: true`,
  エラー文言「既存商品があるためスキップしました…」で止まる（上書きガード。安全側既定）。
  上書きしたいときだけ `overwrite: true` を明示する。
  根拠: `webui/app/api/register/bulk/[mall]/route.ts` L114-127 / 実測: `tests/e2e_bulk_register.mjs` 手順5（3周連続で skip 確認）。

### 「commit したつもりが dry-run になっていた」

- 一括登録 API は **`dryRun` 既定 true（安全側）**。実登録は `dryRun: false` を明示したときだけ。
  根拠: `webui/app/api/register/bulk/[mall]/route.ts` L75 / 実測: `tests/e2e_bulk_register.mjs` 手順1（`dryRun` 未指定 → `j.dryRun === true` を3周連続確認）。

### 「登録直後に items.get / getItem で見つからない」

- モール側反映ラグ。楽天/Yahoo とも登録成功（HTTP 200/201）から取得可能まで少し間がある。
  E2E は 2〜2.5秒待ってから確認している（この待機で 2026-07-03 の 9/9 実行すべて一発検出。flake なし）。
  それでも見つからない場合は manageNumber / item_code の取り違えを疑う（→ §5 manageNumber 規約）。

### 「楽天の検索(items.search)で直近登録した商品が引けない」

- items.search の検索インデックス反映は最大24h遅延。直近登録の引き当てには items.get（管理番号直指定）を使う。
  根拠: `webui/lib/rakuten/item-client.ts` L98-101 コメント。

### 「Yahoo に登録したのにストアに出ない」

- 仕様どおり。`editItem` は編集領域への書き込みで、`reservePublish`（反映予約）するまで公開ストアに反映されない。
  さらに安全登録の既定は `display=0`（非表示）。公開には display=1 + 反映予約 + 在庫>0 が必要。
  テストでは反映予約を**呼ばないこと**（→ §5 submit 分離）。
  根拠: `webui/lib/register/yahoo-register-service.ts` / 実測: submit なしでも getItem で確認できることを 2026-07-03 に9回連続確認。

### 「商品名が勝手に短くなった（Yahoo）」

- name は全角換算75・コードポイント75の二重上限へ**自動切詰め**される（拒否ではない）。
  headline(30)/explanation(500)/meta_desc(80) 等も同様の上限表で整形される。
  切詰めが起きる商品は dry-run の truncation 警告（`detectYahooTruncations`）で事前に分かる。
  根拠: `webui/lib/yahoo/item-mapper.ts` L30-46 / 実機実測 2026-07-03（§7 新知見2: 80字→75字で登録成功）。

---

## 5. 仕様・規約の逆引き（安全既定・命名規約）

### manageNumber 規約（楽天）— 「どの管理番号で登録されるか」

1. **`rakuten_manage_number`（実管理番号）が保存されていれば最優先**。取込商品（モール→アプリ）は
   非規約書式の番号でも同一商品へ往復する（編集→反映で別商品を作らない）。
2. 未保存（アプリ新規作成）は `baseCodeOf` = `maker_code-JAN下4桁`（例: maker `zzz` + JAN `...2542` → `zzz-2542`）を冪等キーに使う。

根拠: `webui/lib/converters/rakuten-api.ts` `buildRakutenManageNumber` L98-106 / 実測: `tests/e2e_register_rakuten.mjs`（`zzz-2542` を3周連続確認）。

### Yahoo variant キー（楽天）

- upsert の `variants.{key}` の key は `sku_manage_number`（あれば）→ `ne_code`。在庫APIの variantId も同じキーを使う（不一致だと在庫が付かない）。
  根拠: `webui/lib/converters/rakuten-api.ts` L146 / `webui/lib/register/rakuten-register-service.ts` L129-137。

### mall_listed 更新 — 「登録済みフラグはいつ立つか」

- commit 成功時に `products.extra.mall_listed.rakuten|yahoo = true` を記録（楽天は `rakuten_manage_number` も保存）。
  一覧画面の「反映」ボタン活性判定に使う。**記録失敗は登録自体を妨げない**（ベストエフォート）。
  根拠: `webui/lib/register/rakuten-register-service.ts` L117-126 / `yahoo-register-service.ts` L144-152 / 実測: `tests/e2e_bulk_register.mjs` 手順4（3周連続確認）。

### Yahoo submit（反映）分離 — 「登録と公開反映は別操作」

- 登録(editItem) と 反映(reservePublish) は分離されている。反映は**ストア全体単位**（商品単位指定不可・mode=1）。
- 一括登録では商品ごとに予約せず、全件処理後に1回だけ（または `action:"submit"` の専用口を1回）呼ぶ設計。
  反映予約の成否は最終商品の登録成否から独立。
- **テストでは reservePublish を呼ばない**: 呼ぶと無関係の編集中項目まで公開されうる。submit なしでも getItem（編集領域）で登録確認できる。
- 補足: 商品単位の submitItem API はクライアントに存在するが、反映経路では使わない（反映は reservePublish）。
  根拠: `webui/app/api/register/bulk/[mall]/route.ts` L46-61, L164-174 / `webui/lib/yahoo/item-client.ts` L97-115 / `webui/lib/register/yahoo-register-service.ts` L163-165。

### 安全登録の既定値

| モール | 既定（publish 未指定） | 内容 |
|---|---|---|
| 楽天 | `hideItem: true` + `hideStock` + 在庫0 | 倉庫（非公開）・サーチ在庫非表示 |
| Yahoo | `display: "0"`（更新時は display 不送信=公開状態維持） | 非表示。反映予約もしない |

根拠: `webui/lib/register/rakuten-register-service.ts` L95-97 / `yahoo-register-service.ts` L110-113 / `item-mapper.ts` L258-263。

### 後始末手順（テスト商品の削除）

1. Yahoo: `deleteItem(token, sellerId, item_code)`（`OK` で成功）。lib画像を使った場合は `deleteLibImage` も。
2. 楽天: `deleteItem(cred, manageNumber)`（HTTP 204 で成功。存在しなければ 404 GE0014 → 削除済みとみなせる）。
3. DB: `products` から `ne_code` in (テストコード) で削除。
4. 順序は「モール → DB」（DB を先に消すと管理番号の手掛かりを失う）。

根拠: 各E2Eの後始末ブロック（`tests/e2e_bulk_register.mjs` L134-141 ほか）/ 実測 2026-07-03: 9回の実行すべてで削除成功（204 / OK）。

---

## 6. 反復実行の安定性記録（flake 調査）

2026-07-03、登録系E2E一式を `tests/run_e2e_repeat.mjs` で3周連続実行（逐次・周回間3秒休止）。

| # | e2e_bulk_register | e2e_register_rakuten | e2e_register_yahoo_nosubmit |
|---|---|---|---|
| Round 1 | PASS 13.0s | PASS 7.3s | PASS 10.4s |
| Round 2 | PASS 13.1s | PASS 6.3s | PASS 10.3s |
| Round 3 | PASS 12.5s | PASS 6.3s | PASS 10.2s |

- **9/9 成功（100%）・flake 検出なし**。所要合計 89.4 秒。結果JSON: `.loop/current/turns/turn-000-e2e-runs.json`（実行時成果物）。
- 安定に効いている既存対策: 登録→確認の間の 2〜2.5s 待機（反映ラグ吸収）、画像先行アップ後の 1.5s 待機（it-14091 回避）、
  モールAPIへの逐次実行（並列送信しない）、テスト冒頭での前回残骸の掃除（delete → insert）。
- 同一商品の「登録→削除→再登録」を3周繰り返しても、楽天/Yahoo とも削除直後の同番号再登録で拒否・残骸は観測されなかった。

---

## 7. 新知見（2026-07-03 バリエーション検証）

`tests/e2e_bulk_variations.mjs`（テスト商品3件・倉庫/非表示・後始末込み）で新たに実測確認した事実。

### 新知見1: ジャンル必須属性の欠落は dry-run をすり抜け、commit で IE0418 になる

- 属性なし商品は一括 dry-run で **valid 判定**（`validateUpsertBody` は genreId/価格等のみ検査し属性を見ない）。
- commit（items.upsert）で初めて HTTP 400 IE0418（§2 の実測レスポンス）。商品は作成されない（直後の items.get は 404）。
- 含意: 「dry-run が通った＝登録できる」ではない。ジャンル必須属性は事前検証の空白地帯なので、
  新ジャンルの商品を初めて登録するときは1件で commit を試してから一括する。

### 新知見2: Yahoo 商品名は75字上限で「拒否」ではなく「自動切詰め」で登録成功する

- 全角80字の商品名 → dry-run は valid、送信 params の name は75字に切詰め済み、editItem 成功、
  **実機 getItem の Name も75字**（切詰めた値がそのまま登録される）。
- 含意: 長い商品名はエラーにならないぶん、末尾の重要語（容量・セット数など）が silently 消える。
  切詰め有無は dry-run の truncation 警告で事前確認する。

### 新知見3: 多SKU商品は一括登録経路（bulk）でも variantSelectors が自動生成され、SKU別価格で登録される

- variants 2件（Aタイプ1980円 / Bタイプ2980円・SKU管理番号指定）を `POST /api/register/bulk/rakuten` で commit →
  items.get で `variants.{zzz-5994-a, zzz-5994-b}` 両方の存在・各 standardPrice・単軸 `variantSelectors`
  （values = Aタイプ/Bタイプ）を確認。既存E2Eは単品×bulk と 多SKU×単品route のみで、この組合せは初検証。

### 新知見4: 不正チェックディジットJANの楽天拒否コードは IE0228（実測で確定）

- 従来「不正JANは拒否される」とだけ記録されていたが、コードは **IE0228 / HTTP 400 /
  propertyPath: variants.{key}.articleNumber.value** と実測で確定（§2）。

### 新知見5: GE0014 は HTTP 404 の errors[] で返る（削除の冪等化に使える）

- `items.delete` を存在しない番号に対して実行 → `404 {"errors":[{"code":"GE0014",...}]}`（§2）。
  後始末の二重実行は「404+GE0014 なら成功扱い」で冪等にできる。
