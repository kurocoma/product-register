import { describe, expect, it } from "vitest";
import type { ProductRow } from "@/lib/product/repository";
import {
  fetchAllProductRows,
  type RuleAuditQueryClient,
} from "./rule-audit-query";

type RangeCall = [from: number, to: number];

function makeRows(count: number): ProductRow[] {
  return Array.from(
    { length: count },
    (_, index) => ({ id: "row-" + index }) as ProductRow,
  );
}

function createFakeClient(rows: ProductRow[]) {
  const rangeCalls: RangeCall[] = [];
  const client: RuleAuditQueryClient = {
    from: () => ({
      select: () => ({
        order: () => ({
          range: async (from, to) => {
            rangeCalls.push([from, to]);
            return { data: rows.slice(from, to + 1), error: null };
          },
        }),
      }),
    }),
  };
  return { client, rangeCalls };
}

describe("fetchAllProductRows", () => {
  it("0件では最初のページだけ取得して空配列を返す", async () => {
    const { client, rangeCalls } = createFakeClient([]);

    await expect(fetchAllProductRows(client)).resolves.toEqual([]);
    expect(rangeCalls).toEqual([[0, 999]]);
  });

  it("1000件ちょうどでは満杯の1ページ後に空の2ページ目を確認する", async () => {
    const rows = makeRows(1_000);
    const { client, rangeCalls } = createFakeClient(rows);

    const result = await fetchAllProductRows(client);

    expect(result).toEqual(rows);
    expect(result).toHaveLength(1_000);
    expect(rangeCalls).toEqual([
      [0, 999],
      [1_000, 1_999],
    ]);
  });

  it("1001件では2ページ目の1件まで欠落なく結合する", async () => {
    const rows = makeRows(1_001);
    const { client, rangeCalls } = createFakeClient(rows);

    const result = await fetchAllProductRows(client);

    expect(result).toEqual(rows);
    expect(result.at(-1)?.id).toBe("row-1000");
    expect(rangeCalls).toEqual([
      [0, 999],
      [1_000, 1_999],
    ]);
  });

  it("range がエラーを返すとそのメッセージで例外を送出する", async () => {
    const client: RuleAuditQueryClient = {
      from: () => ({
        select: () => ({
          order: () => ({
            range: async () => ({
              data: null,
              error: { message: "商品一覧の取得に失敗しました" },
            }),
          }),
        }),
      }),
    };

    await expect(fetchAllProductRows(client)).rejects.toThrow(
      "商品一覧の取得に失敗しました",
    );
  });
});
