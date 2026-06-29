/** 楽天→Yahoo 一括移行の純ロジック層（副作用なし・I/O 非依存）の公開窓口。
 * API ルート / UI / テストはここから import する。 */
export * from "./types";
export { parseManageNumbers } from "./manage-numbers";
export { buildItemPlan } from "./plan";
export { safeStateDefaults } from "./defaults";
export { aggregate, runItems } from "./result";
