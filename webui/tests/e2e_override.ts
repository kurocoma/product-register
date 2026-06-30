// 文字数オーバー手動リライト(override)の実機E2E。
//   override 付きで commit(display=0) → Yahoo から読み戻して name/headline/explanation を照合 → 復元。
// 使い方(webui): npx tsx tests/e2e_override.ts [--code=r0101-1]
// 実機スクリプト（外部 supabase-ssr アダプタの緩い型のため any を許容）。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
(async () => {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
  const CODE = (process.argv.find((x) => x.startsWith("--code="))?.split("=")[1]) || "r0101-1";

  const { createClient } = await import("@supabase/supabase-js");
  const { createServerClient } = await import("@supabase/ssr");
  const { getRakutenCredentialsFromEnv } = await import("@/lib/rakuten/credentials");
  const { getItem: rakutenGet } = await import("@/lib/rakuten/item-client");
  const { parseRakutenItem } = await import("@/lib/converters/rakuten-item-parser");
  const { buildImportedProduct } = await import("@/lib/converters/mall-import");
  const { getYahooConfig, getYahooAccessToken } = await import("@/lib/yahoo/auth");
  const { getItem: yahooGet } = await import("@/lib/yahoo/item-client");

  const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, SVC = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const user = list.users.find((u) => u.email === "kurocommerce@gmail.com")!;
  const jar = new Map<string, string>();
  const ssr = createServerClient(URL_, ANON, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l: any) => l.forEach(({ name, value }: any) => jar.set(name, value)) } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email! });
  await ssr.auth.verifyOtp({ type: "magiclink", token_hash: (link as any).properties.hashed_token });
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");

  const ov = { name: `【E2E】${CODE}リライト名`, headline: `【E2E】リライトしたキャッチ`, explanation: `【E2E】リライトした説明文。` };
  const post = (overrides: any) => fetch("http://localhost:3000/api/migrate/rakuten-to-yahoo", {
    method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ manageNumbers: [CODE], dryRun: false, preserveExistingDisplay: true, overrides }),
  }).then((r) => r.json());

  const r1 = await post({ [CODE]: ov });
  console.log("commit(override):", r1.results?.[0]?.status);

  const cred = getRakutenCredentialsFromEnv()!;
  const built = buildImportedProduct("rakuten", CODE, parseRakutenItem((await rakutenGet(cred, CODE)).json!));
  const neCode = built.ok ? built.product.ne_code : "";
  const cfg = getYahooConfig()!;
  const token = await getYahooAccessToken(cfg);
  const raw = (await yahooGet(token, cfg.sellerId, neCode)).raw;
  const tag = (n: string) => {
    const m = raw.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`, "i"));
    return m ? m[1].replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "").trim() : "";
  };
  const check = (label: string, got: string, want: string) => console.log(`${got.startsWith(want.slice(0, 12)) ? "✅" : "❌"} ${label}: Yahoo="${got.slice(0, 30)}" / 期待先頭="${want.slice(0, 16)}"`);
  check("商品名(name)", tag("Name"), ov.name);
  check("キャッチコピー(headline)", tag("Headline"), ov.headline);
  check("商品情報(explanation)", tag("Explanation"), ov.explanation);

  // 復元（override なしで再登録 → 通常の移行値へ戻す）
  await post({});
  console.log("復元: override なしで再登録しました");
})();
