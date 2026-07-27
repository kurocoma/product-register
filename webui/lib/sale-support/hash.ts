import { createHash } from "node:crypto";

/**
 * プレビュー（dry-run）で表示した実行内容を commit へ束縛する hash。
 * research-import の hashResearchImportPlan と同じ考え方: プレビュー後に
 * 楽天側の現在値・対象集合・オプションが変わったら hash が変わり、409 で再プレビューを促す。
 * 入力はサービス層が決定的なキー順で組み立てたプラン要約（JSON化が安定）。
 */
export function hashSaleSupportPlan(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
