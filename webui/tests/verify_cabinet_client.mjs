// cabinet-client.ts の検証（esaAuthHeader=純粋関数、resolveFolderId/searchFile=実機読み取り）。
// 実行: npx tsx tests/verify_cabinet_client.mjs
import { readFileSync } from "node:fs";
import { esaAuthHeader, searchFile, resolveFolderId } from "../lib/rakuten/cabinet-client.ts";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim();
const cred = { serviceSecret: get("RAKUTEN_SERVICE_SECRET"), licenseKey: get("RAKUTEN_LICENSE_KEY") };

let fail = 0;
const check = (label, cond, detail) => { if (!cond) fail++; console.log(`${cond ? "✅" : "❌"} ${label}${detail ? "  " + detail : ""}`); };

// 1) esaAuthHeader 純粋関数（"aaa:bbb" -> base64 "YWFhOmJiYg==")
check("esaAuthHeader", esaAuthHeader("aaa", "bbb") === "ESA YWFhOmJiYg==", esaAuthHeader("aaa", "bbb"));

// 2) searchFile で既知ファイルが引ける
const hits = await searchFile(cred, "t002-0093-1");
check("searchFile ヒットあり", hits.length > 0, `${hits.length}件`);
const thumHit = hits.find((h) => h.folderPath === "/thum02");
check("searchFile /thum02 を含む", !!thumHit, thumHit ? `folderId=${thumHit.folderId} url=${thumHit.fileUrl}` : "");

// 3) resolveFolderId で /thum02 → 10502933
await new Promise((r) => setTimeout(r, 1500)); // QPS配慮
const fid = await resolveFolderId(cred, "/thum02", "t002-0093-1");
check("resolveFolderId /thum02 = 10502933", fid === 10502933, `got=${fid}`);

console.log(fail === 0 ? "\n🎉 cabinet-client 検証パス" : `\n⚠ ${fail}件失敗`);
process.exit(fail === 0 ? 0 : 1);
