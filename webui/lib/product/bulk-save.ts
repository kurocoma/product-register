import type { ProductInput } from "./schema";

/** 一括保存（BulkGridEditor.save）の統合グループ保存規則の純関数層。
 *
 * 背景（孤児化バグの防止）: 先に各行をバリエーションキー無しで個別保存すると行ごとに
 * 別々の savedId（products.id）が付く。その後キーを付けて再保存すると1商品へ統合されるが、
 * 最初に見つかった savedId の商品だけを更新すると、残りの旧フラット商品が DB に孤児として
 * 残る（商品一覧に重複表示・NE 用 CSV で同一 SKU 行が二重出力される）。
 * → 統合先（primary）へ保存が成功した後、吸収された旧商品を削除して1商品化する。 */

/** グループ内の保存済みIDから、更新先（primary）と統合で不要になる旧商品ID（orphans）を決める。
 * primary = グループ内で最初に見つかった savedId（従来の更新先と同一 = 挙動互換）。
 * orphans = primary 以外の distinct な savedId。 */
export function resolveSavedIds(savedIds: (string | undefined)[]): {
  primaryId: string | undefined;
  orphanIds: string[];
} {
  const ids = savedIds.filter((id): id is string => typeof id === "string" && id !== "");
  const primaryId = ids.length > 0 ? ids[0] : undefined;
  const orphanIds = [...new Set(ids.filter((id) => id !== primaryId))];
  return { primaryId, orphanIds };
}

export type GroupSaveDeps = {
  /** 商品の作成・更新（id があれば更新）。失敗時は throw。 */
  upsert: (p: ProductInput, id?: string) => Promise<{ id: string }>;
  /** 商品の削除。失敗時は throw。 */
  remove: (id: string) => Promise<void>;
};

export type GroupSaveResult = {
  /** 保存後の products.id（グループ全行がこのIDを共有する）。 */
  savedId: string;
  /** 既存商品の更新だったか（false = 新規作成）。 */
  wasUpdate: boolean;
  /** 統合により削除（整理）した旧フラット商品のID。 */
  cleanedIds: string[];
  /** 削除に失敗した旧商品（保存自体は成功しているため呼び出し側はメッセージで知らせる）。 */
  cleanupFailed: { id: string; message: string }[];
};

/** 統合グループを1商品として保存し、吸収された旧フラット商品を削除する。
 * - 保存（upsert）が失敗したら例外をそのまま投げ、削除は一切行わない（誤削除ガード）。
 * - 削除は保存成功後のみ。個々の削除失敗で保存結果は覆さず cleanupFailed で返す。
 * - savedId が1つ以下のグループ（単独行・全行未保存）では従来どおり削除は発生しない。 */
export async function saveGroupWithCleanup(
  input: ProductInput,
  savedIds: (string | undefined)[],
  deps: GroupSaveDeps,
): Promise<GroupSaveResult> {
  const { primaryId, orphanIds } = resolveSavedIds(savedIds);
  const saved = await deps.upsert(input, primaryId); // 失敗時はここで throw（削除しない）

  const cleanedIds: string[] = [];
  const cleanupFailed: { id: string; message: string }[] = [];
  for (const id of orphanIds) {
    if (id === saved.id) continue; // 念のため: 保存先そのものは削除しない
    try {
      await deps.remove(id);
      cleanedIds.push(id);
    } catch (e) {
      cleanupFailed.push({ id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { savedId: saved.id, wasUpdate: !!primaryId, cleanedIds, cleanupFailed };
}
