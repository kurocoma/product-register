# WebUI Plan 1: Foundation (Next.js + Supabase 骨格) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Next.js プロジェクトを `webui/` に scaffold し、 Supabase Auth + DB スキーマ + サイドナビレイアウト + 認証ガード + 各画面の placeholder ページを揃え、 ログイン後にダッシュボード骨格が表示される状態を作る。

**Architecture:** Next.js 15 App Router + TypeScript (strict) + Tailwind + shadcn/ui + Supabase (Auth/DB/RLS)。 認証は Email Magic Link + Google OAuth。 DB は 5 テーブル (products / settings / maker_codes / history / product_templates) + RLS。 全 9 画面は placeholder のみ作成し、 中身は Plan 3〜5 で実装。

**Tech Stack:** Next.js 15, React 19, TypeScript 5, Tailwind CSS, shadcn/ui, Supabase (`@supabase/ssr` + `@supabase/supabase-js`), Vitest, Zod

**設計書:** [docs/superpowers/specs/2026-05-20-webui-mockup-design.md](../specs/2026-05-20-webui-mockup-design.md)

---

## 前提

- 開発環境: Node.js 20+, pnpm
- Supabase アカウント (新規プロジェクト作成可能)
- 既存リポジトリの `webui/` を作業ディレクトリにする (monorepo 構成)

## ファイル構成

```
webui/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
├── .env.local                # SUPABASE_URL / SUPABASE_ANON_KEY
├── .env.local.example
├── middleware.ts             # 認証ガード
├── app/
│   ├── layout.tsx            # ルートレイアウト
│   ├── globals.css
│   ├── (auth)/
│   │   └── login/page.tsx    # ログイン画面
│   ├── (main)/
│   │   ├── layout.tsx        # サイドナビレイアウト
│   │   ├── page.tsx          # ダッシュボード (4カードのみ、 ダミーデータ)
│   │   ├── products/page.tsx        # 商品一覧 placeholder
│   │   ├── products/[id]/page.tsx   # 商品編集 placeholder
│   │   ├── csv/page.tsx              # CSV ダウンロード placeholder
│   │   ├── templates/page.tsx        # テンプレート管理 placeholder
│   │   ├── history/page.tsx          # 作業履歴 placeholder
│   │   ├── settings/page.tsx         # 設定 placeholder
│   │   └── help/page.tsx             # ヘルプ placeholder
│   └── auth/
│       └── callback/route.ts  # Supabase Auth コールバック
├── components/
│   ├── nav/SideNav.tsx
│   └── ui/                    # shadcn/ui コンポーネント (Button, Card, etc.)
├── lib/
│   ├── supabase/
│   │   ├── client.ts          # ブラウザクライアント
│   │   ├── server.ts          # サーバーコンポーネント用
│   │   └── middleware.ts      # ミドルウェア用
│   └── types/
│       └── database.types.ts  # supabase gen 型定義
├── supabase/
│   ├── migrations/
│   │   ├── 20260524000001_create_products.sql
│   │   ├── 20260524000002_create_settings.sql
│   │   ├── 20260524000003_create_maker_codes.sql
│   │   ├── 20260524000004_create_history.sql
│   │   ├── 20260524000005_create_product_templates.sql
│   │   └── 20260524000006_rls_policies.sql
│   └── config.toml
└── tests/
    └── setup.ts
```

---

## Task 1: Next.js プロジェクト scaffold

**Files:** webui/ 配下全体

- [ ] **Step 1: pnpm 利用可能か確認**

Run: `pnpm --version`
Expected: バージョン表示。 なければ `npm install -g pnpm`

- [ ] **Step 2: Next.js プロジェクト作成**

```powershell
cd "c:\Users\hppym\開発案件\商品登録アプリ作成"
pnpm create next-app@latest webui --typescript --tailwind --app --src-dir false --import-alias "@/*" --use-pnpm
```

対話: ESLint=Yes, Turbopack=No
Expected: `webui/` 配下に Next.js 15 プロジェクトが生成される

- [ ] **Step 3: 動作確認**

```powershell
cd webui
pnpm dev
```

Expected: `http://localhost:3000` で Next.js デフォルト画面表示。 確認後 Ctrl+C で終了

- [ ] **Step 4: コミット**

```bash
cd "c:\Users\hppym\開発案件\商品登録アプリ作成"
git add webui/
git commit -m "feat(webui): Next.js 15 scaffold (TypeScript + Tailwind + App Router)"
```

---

## Task 2: 開発依存パッケージ追加

**Files:** webui/package.json

- [ ] **Step 1: Supabase + Zod + Vitest を追加**

```powershell
cd webui
pnpm add @supabase/supabase-js @supabase/ssr zod
pnpm add -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 2: vitest.config.ts を作成**

`webui/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
```

```powershell
pnpm add -D @vitejs/plugin-react
```

- [ ] **Step 3: tests/setup.ts を作成**

`webui/tests/setup.ts`:
```typescript
import "@testing-library/jest-dom";
```

- [ ] **Step 4: package.json に test スクリプト追加**

`webui/package.json` の `scripts` に追加:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: スモークテスト**

`webui/tests/smoke.test.ts`:
```typescript
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("vitest works", () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `pnpm test`
Expected: 1 passed

- [ ] **Step 6: コミット**

```bash
git add webui/package.json webui/pnpm-lock.yaml webui/vitest.config.ts webui/tests/
git commit -m "feat(webui): add Supabase / Zod / Vitest dev dependencies"
```

---

## Task 3: shadcn/ui セットアップ

**Files:** webui/components/ui/

- [ ] **Step 1: shadcn/ui 初期化**

```powershell
cd webui
pnpm dlx shadcn@latest init
```

対話: style=Default, baseColor=Slate, CSS variables=Yes

- [ ] **Step 2: 基本コンポーネント追加**

```powershell
pnpm dlx shadcn@latest add button card input label form table dialog dropdown-menu tabs accordion
```

- [ ] **Step 3: コミット**

```bash
git add webui/components webui/lib webui/app/globals.css webui/components.json
git commit -m "feat(webui): shadcn/ui setup with Button/Card/Input/Form/Table/Tabs/Accordion"
```

---

## Task 4: Supabase プロジェクト作成 + 環境変数

**Files:** webui/.env.local, webui/.env.local.example, webui/.gitignore

- [ ] **Step 1: Supabase プロジェクト作成**

Web で `https://supabase.com/dashboard` にログインし、新規プロジェクト作成:
- Name: `product-register-webui`
- Region: 東京 (ap-northeast-1)
- DB password: 強固なものを生成
- Plan: Free でOK

完了後、 Settings → API から:
- `Project URL` (例: `https://xxxxx.supabase.co`)
- `anon public key`

をメモ。

- [ ] **Step 2: .env.local 作成**

`webui/.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx...
```

- [ ] **Step 3: .env.local.example 作成 (コミット用)**

`webui/.env.local.example`:
```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

- [ ] **Step 4: .gitignore 確認**

`webui/.gitignore` に `.env.local` が含まれているか確認 (Next.js デフォルトで含まれる)。 なければ追加。

- [ ] **Step 5: コミット**

```bash
git add webui/.env.local.example webui/.gitignore
git commit -m "feat(webui): Supabase env vars setup (.env.local.example)"
```

---

## Task 5: Supabase クライアント (ブラウザ / サーバー / ミドルウェア)

**Files:** webui/lib/supabase/

- [ ] **Step 1: failing テスト**

`webui/lib/supabase/client.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { createClient } from "./client";

describe("supabase browser client", () => {
  it("can be instantiated", () => {
    const client = createClient();
    expect(client).toBeDefined();
    expect(client.auth).toBeDefined();
  });
});
```

Run: `pnpm test webui/lib/supabase/client.test.ts`
Expected: FAIL (no client.ts)

- [ ] **Step 2: ブラウザクライアント実装**

`webui/lib/supabase/client.ts`:
```typescript
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] **Step 3: サーバークライアント実装**

`webui/lib/supabase/server.ts`:
```typescript
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {}
        },
      },
    },
  );
}
```

- [ ] **Step 4: ミドルウェア用クライアント**

`webui/lib/supabase/middleware.ts`:
```typescript
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  return { supabaseResponse, user };
}
```

- [ ] **Step 5: テスト通過確認**

Run: `pnpm test`
Expected: smoke + client test 2 件パス

- [ ] **Step 6: コミット**

```bash
git add webui/lib/supabase/
git commit -m "feat(webui): add Supabase client modules (browser/server/middleware)"
```

---

## Task 6: 認証ミドルウェア + 認証ガード

**Files:** webui/middleware.ts, webui/app/auth/callback/route.ts

- [ ] **Step 1: ミドルウェア作成**

`webui/middleware.ts`:
```typescript
import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // 未ログインで保護領域にアクセスしたら /login へ
  if (!user && !pathname.startsWith("/login") && !pathname.startsWith("/auth")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  // ログイン済みで /login にアクセスしたら / へ
  if (user && pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
```

- [ ] **Step 2: Auth コールバックルート作成**

`webui/app/auth/callback/route.ts`:
```typescript
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
```

- [ ] **Step 3: コミット**

```bash
git add webui/middleware.ts webui/app/auth/
git commit -m "feat(webui): add auth middleware and OAuth callback route"
```

---

## Task 7: ログイン画面実装

**Files:** webui/app/(auth)/login/page.tsx, webui/components/auth/LoginCard.tsx

- [ ] **Step 1: LoginCard テスト**

`webui/components/auth/LoginCard.test.tsx`:
```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoginCard } from "./LoginCard";

describe("LoginCard", () => {
  it("renders email input and submit button", () => {
    render(<LoginCard />);
    expect(screen.getByLabelText(/メールアドレス/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Magic Link を送信/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Google でログイン/ })).toBeInTheDocument();
  });
});
```

Run: `pnpm test webui/components/auth/LoginCard.test.tsx`
Expected: FAIL (component not exist)

- [ ] **Step 2: LoginCard 実装**

`webui/components/auth/LoginCard.tsx`:
```typescript
"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginCard() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const sendMagicLink = async () => {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (!error) setSent(true);
  };

  const signInWithGoogle = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-center text-2xl">商品登録アプリ</CardTitle>
        <p className="text-center text-sm text-muted-foreground">
          EC商品データをまとめて登録
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {sent ? (
          <p className="text-center text-sm text-green-700">
            ログインリンクをメールに送信しました
          </p>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="email">メールアドレス</Label>
              <Input
                id="email"
                type="email"
                placeholder="your@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button onClick={sendMagicLink} className="w-full">
              Magic Link を送信
            </Button>
            <div className="text-center text-xs text-muted-foreground">または</div>
            <Button onClick={signInWithGoogle} variant="outline" className="w-full">
              Google でログイン
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: ログインページ作成**

`webui/app/(auth)/login/page.tsx`:
```typescript
import { LoginCard } from "@/components/auth/LoginCard";

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <LoginCard />
    </main>
  );
}
```

- [ ] **Step 4: テスト通過確認**

Run: `pnpm test`
Expected: ALL pass

- [ ] **Step 5: ブラウザ動作確認**

Run: `pnpm dev`
ブラウザで `http://localhost:3000` → `/login` にリダイレクトされ、 LoginCard が表示されることを確認

- [ ] **Step 6: コミット**

```bash
git add webui/app/(auth) webui/components/auth/
git commit -m "feat(webui): login screen with Magic Link + Google OAuth"
```

---

## Task 8: Supabase DB マイグレーション

**Files:** webui/supabase/migrations/

> **前提:** Supabase CLI が必要。 `npx supabase --version` で確認、 なければ `pnpm add -D supabase` で webui ローカルに導入。

- [ ] **Step 1: Supabase CLI ローカル導入 + link**

```powershell
cd webui
pnpm add -D supabase
npx supabase login    # ブラウザで認証
npx supabase init     # webui/supabase/ ディレクトリ初期化
npx supabase link --project-ref <project-ref>   # ステップ4で取得した URL の xxxxx 部分
```

- [ ] **Step 2: products マイグレーション**

`webui/supabase/migrations/20260524000001_create_products.sql`:
```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users NOT NULL,
  ne_code text NOT NULL,
  jan_code text NOT NULL,
  maker_code text NOT NULL,
  product_type text NOT NULL,
  quantity int NOT NULL,
  product_name text NOT NULL,
  display_name text NOT NULL,
  tax_rate int NOT NULL CHECK (tax_rate IN (8, 10)),
  cost_price int DEFAULT 0,
  selling_price int NOT NULL,
  shipping_type text NOT NULL,
  image_count int NOT NULL,
  delivery_method int NOT NULL,
  lead_time int NOT NULL,
  mall_category_id text NOT NULL,
  store_category text DEFAULT '',
  yahoo_category_id text DEFAULT '',
  yahoo_path text DEFAULT '',
  unit text DEFAULT '',
  yahoo_grouping_enabled bool NOT NULL DEFAULT false,
  yahoo_variation_title text DEFAULT '',
  description_pc text DEFAULT '',
  description_sp text DEFAULT '',
  catch_copy_pc text DEFAULT '',
  catch_copy_yahoo text DEFAULT '',
  -- 残り 50+ 列は柔軟性のため JSONB にまとめる
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, ne_code)
);

CREATE INDEX idx_products_user_id ON products(user_id);
CREATE INDEX idx_products_ne_code ON products(user_id, ne_code);
```

- [ ] **Step 3: settings マイグレーション**

`webui/supabase/migrations/20260524000002_create_settings.sql`:
```sql
CREATE TABLE settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users,
  rakuten_store_id text DEFAULT '',
  rakuten_cabinet_url_base text DEFAULT '',
  yahoo_store_id text DEFAULT '',
  shopify_store_id text DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 4: maker_codes マイグレーション**

`webui/supabase/migrations/20260524000003_create_maker_codes.sql`:
```sql
CREATE TABLE maker_codes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users NOT NULL,
  maker_code text NOT NULL,
  maker_name text NOT NULL,
  product_code_prefix text DEFAULT '',
  UNIQUE (user_id, maker_code)
);
```

- [ ] **Step 5: history マイグレーション**

`webui/supabase/migrations/20260524000004_create_history.sql`:
```sql
CREATE TABLE history (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users NOT NULL,
  action text NOT NULL CHECK (action IN ('create', 'edit', 'csv_export', 'delete')),
  product_id uuid REFERENCES products ON DELETE SET NULL,
  detail jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_history_user_id ON history(user_id, created_at DESC);
```

- [ ] **Step 6: product_templates マイグレーション**

`webui/supabase/migrations/20260524000005_create_product_templates.sql`:
```sql
CREATE TABLE product_templates (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users NOT NULL,
  name text NOT NULL,
  category text DEFAULT '',
  template_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 7: RLS マイグレーション**

`webui/supabase/migrations/20260524000006_rls_policies.sql`:
```sql
-- products
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own products" ON products
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- settings
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own settings" ON settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- maker_codes
ALTER TABLE maker_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own maker codes" ON maker_codes
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- history
ALTER TABLE history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own history" ON history
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own history" ON history
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- product_templates
ALTER TABLE product_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own templates" ON product_templates
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

- [ ] **Step 8: マイグレーション適用**

```powershell
cd webui
npx supabase db push
```

Expected: 6 マイグレーション適用成功

- [ ] **Step 9: TypeScript 型生成**

```powershell
npx supabase gen types typescript --linked > lib/types/database.types.ts
```

- [ ] **Step 10: コミット**

```bash
git add webui/supabase/ webui/lib/types/database.types.ts webui/package.json webui/pnpm-lock.yaml
git commit -m "feat(webui): Supabase schema (products/settings/maker_codes/history/templates) + RLS"
```

---

## Task 9: サイドナビレイアウト + 各画面 placeholder

**Files:** webui/app/(main)/layout.tsx, 各 page.tsx

- [ ] **Step 1: SideNav テスト**

`webui/components/nav/SideNav.test.tsx`:
```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SideNav } from "./SideNav";

describe("SideNav", () => {
  it("renders all 8 menu items", () => {
    render(<SideNav />);
    expect(screen.getByText("ダッシュボード")).toBeInTheDocument();
    expect(screen.getByText("商品一覧")).toBeInTheDocument();
    expect(screen.getByText("商品編集")).toBeInTheDocument();
    expect(screen.getByText("CSV ダウンロード")).toBeInTheDocument();
    expect(screen.getByText("テンプレート管理")).toBeInTheDocument();
    expect(screen.getByText("作業履歴")).toBeInTheDocument();
    expect(screen.getByText("設定")).toBeInTheDocument();
    expect(screen.getByText("ヘルプ")).toBeInTheDocument();
  });
});
```

Run: `pnpm test webui/components/nav/SideNav.test.tsx`
Expected: FAIL

- [ ] **Step 2: SideNav 実装**

`webui/components/nav/SideNav.tsx`:
```typescript
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "ダッシュボード", icon: "🏠" },
  { href: "/products", label: "商品一覧", icon: "📦" },
  { href: "/products/new", label: "商品編集", icon: "✏️" },
  { href: "/csv", label: "CSV ダウンロード", icon: "📥" },
  { href: "/templates", label: "テンプレート管理", icon: "📋" },
  { href: "/history", label: "作業履歴", icon: "🕒" },
  { href: "/settings", label: "設定", icon: "⚙️" },
  { href: "/help", label: "ヘルプ", icon: "❓" },
];

export function SideNav() {
  const pathname = usePathname();
  return (
    <nav className="w-56 bg-slate-900 text-white min-h-screen p-4">
      <div className="font-bold text-lg mb-6 px-2">商品登録アプリ</div>
      <ul className="space-y-1">
        {items.map((item) => {
          const active = pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`flex items-center gap-2 px-3 py-2 rounded text-sm ${
                  active ? "bg-blue-600" : "hover:bg-slate-800"
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 3: (main) レイアウト作成**

`webui/app/(main)/layout.tsx`:
```typescript
import { SideNav } from "@/components/nav/SideNav";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <SideNav />
      <main className="flex-1 bg-slate-50">{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: 各 placeholder ページ作成**

`webui/app/(main)/page.tsx` (ダッシュボード骨格):
```typescript
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">ダッシュボード</h1>
      <div className="grid grid-cols-4 gap-4">
        <StatCard title="商品数" value={0} />
        <StatCard title="本日編集" value={0} accent />
        <StatCard title="CSV 出力" value={0} />
        <StatCard title="未対応アラート" value={0} warning />
      </div>
    </div>
  );
}

function StatCard({ title, value, accent, warning }: { title: string; value: number; accent?: boolean; warning?: boolean }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm text-slate-600">{title}</CardTitle></CardHeader>
      <CardContent>
        <div className={`text-3xl font-bold ${accent ? "text-orange-500" : warning ? "text-red-600" : "text-blue-700"}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
```

その他 6 ページの placeholder を順次作成 (同じパターンで `<h1>` だけ):

`webui/app/(main)/products/page.tsx`:
```typescript
export default function ProductsPage() {
  return <div className="p-6"><h1 className="text-2xl font-bold">商品一覧</h1><p className="text-slate-500 mt-2">Plan 3 で実装予定</p></div>;
}
```

同様に:
- `webui/app/(main)/products/[id]/page.tsx` → 「商品編集」
- `webui/app/(main)/csv/page.tsx` → 「CSV ダウンロード」
- `webui/app/(main)/templates/page.tsx` → 「テンプレート管理」
- `webui/app/(main)/history/page.tsx` → 「作業履歴」
- `webui/app/(main)/settings/page.tsx` → 「設定」
- `webui/app/(main)/help/page.tsx` → 「ヘルプ」

- [ ] **Step 5: 動作確認**

```powershell
pnpm dev
```

ブラウザで `http://localhost:3000` → /login → ログイン → ダッシュボード表示 → サイドナビ各メニューをクリックして遷移を確認

- [ ] **Step 6: コミット**

```bash
git add webui/app webui/components/nav/
git commit -m "feat(webui): sidebar layout + 8 placeholder pages + dashboard skeleton (4 cards)"
```

---

## Task 10: ログアウト機能

**Files:** webui/components/nav/SideNav.tsx (update), webui/app/auth/signout/route.ts

- [ ] **Step 1: ログアウトルート作成**

`webui/app/auth/signout/route.ts`:
```typescript
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
```

- [ ] **Step 2: SideNav にログアウトボタン追加**

`webui/components/nav/SideNav.tsx` の `</ul>` 直後に追加:
```typescript
<form action="/auth/signout" method="post" className="mt-8 px-2">
  <button type="submit" className="text-sm text-slate-400 hover:text-white">
    ログアウト
  </button>
</form>
```

- [ ] **Step 3: コミット**

```bash
git add webui/app/auth/signout webui/components/nav/SideNav.tsx
git commit -m "feat(webui): logout via SideNav button"
```

---

## Task 11: Plan 1 完了確認

- [ ] **Step 1: 全テストパス確認**

Run: `cd webui && pnpm test`
Expected: 全件パス

- [ ] **Step 2: ビルド確認**

Run: `pnpm build`
Expected: 型エラーなしで成功

- [ ] **Step 3: 動作確認チェックリスト**

- [ ] `/login` で LoginCard 表示
- [ ] Magic Link 送信が動作 (Supabase メールが届く)
- [ ] メールリンクから `/auth/callback` 経由でログイン成功
- [ ] サイドナビ 8 メニュー全て遷移可能
- [ ] ログアウトボタンで `/login` に戻る
- [ ] 未ログイン状態で `/products` 等にアクセスすると `/login` リダイレクト

- [ ] **Step 4: 完了コミット (タグ付け)**

```bash
git tag webui-plan-1-complete
```

Plan 1 完了 → Plan 2 (TypeScript CSV Converter) へ進む。
