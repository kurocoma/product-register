// 自動保存ステートマシン（純関数）の公開境界（barrel）。
// 他機能からは "@/lib/autosave" 経由で import する（内部ファイル直 import は段階的に廃止）。
export * from "./machine";
