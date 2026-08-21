import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: runs, error } = await admin.from("point_boost_runs").select("*").order("started_at", { ascending: false }).limit(6);
if (error) { console.log("runs error:", error.message); process.exit(1); }
for (const r of runs) {
  const keys = Object.keys(r);
  console.log(`run ${String(r.id).slice(0,8)} trigger=${r.trigger} dry_run=${r.dry_run} status=${r.status} started=${r.started_at} finished=${r.finished_at ?? "-"}`);
  for (const k of keys) {
    if (["id","user_id","trigger","dry_run","status","started_at","finished_at"].includes(k)) continue;
    const v = r[k];
    if (v !== null && v !== "" && v !== undefined) console.log(`   ${k}: ${JSON.stringify(v).slice(0, 220)}`);
  }
}
if (runs.length) {
  const latest = runs[0];
  const { data: results, error: e2 } = await admin.from("point_boost_results").select("*").eq("run_id", latest.id);
  if (e2) console.log("results error:", e2.message);
  else {
    console.log(`\n最新run(${String(latest.id).slice(0,8)})のresults ${results.length}件:`);
    for (const x of results) {
      const label = x.manage_number ?? x.item_code ?? x.ne_code ?? "?";
      const rest = Object.entries(x).filter(([k]) => !["id","run_id","user_id","created_at"].includes(k)).map(([k,v]) => `${k}=${JSON.stringify(v)}`).join(" ");
      console.log(`  ${label}: ${rest.slice(0, 260)}`);
    }
  }
}
