import { describe, it, expect } from "vitest";
import { classifyClipboard, parseClipboardColumn, parseTsv } from "./grid-rows";

/** 貼り付けルーティング（classifyClipboard）のテスト。
 * turn-000 の減点 C1: onCellPaste が生テキストの `\t` 有無で分岐していたため、
 * クォート済みセル内にタブを含む「1列コピー」が表取込（parseTsv）へ誤ルートされ、
 * NEコード列に HTML が入る不具合の再現ケースと、既存ルートの回帰ケースを固定する。 */
describe("classifyClipboard（貼り付けのルーティング判定 = クォート対応パース後の列数）", () => {
  it("減点C1の再現: クォート済みセル内にタブを含む1列コピーは column（表取込へ誤ルートしない）", () => {
    // タブでインデントされた複数行 HTML（free2 列相当）を Excel で1セルだけコピーした形
    const html = "<!--text--><p>\n\t<b>■ 商品の魅力</b>\n\t<br>沖縄限定の島レモネード。\n</p>";
    const clipboard = `"${html}"\r\n`;
    expect(classifyClipboard(clipboard)).toBe("column");
    // 列貼り付け側のパースでも 1セル=1値（タブ・改行が中身のまま保持される）
    expect(parseClipboardColumn(clipboard)).toEqual([html]);
  });

  it("クォート内タブ入りセルと通常セルが混ざった複数行の1列コピーも column", () => {
    const clipboard = '"a\tb"\r\nプレーン\r\n';
    expect(classifyClipboard(clipboard)).toBe("column");
    expect(parseClipboardColumn(clipboard)).toEqual(["a\tb", "プレーン"]);
  });

  it("タブなしの1列コピー（CRLF + 末尾改行 = Excel の実クリップボード形式）は column", () => {
    expect(classifyClipboard("あいう\r\nかきく\r\nさしす\r\n")).toBe("column");
  });

  it("セル内改行を含むクォート済み1列コピーは column（従来挙動の回帰）", () => {
    expect(classifyClipboard('"<p>1行目</p>\n<p>2行目</p>"\r\n"次のセル"\r\n')).toBe("column");
  });

  it("単一セル + 末尾改行（Excel の単一セルコピー）は column（1値として貼る従来挙動）", () => {
    expect(classifyClipboard("abc\r\n")).toBe("column");
  });

  it("タブ区切りの表全体コピーは table（従来の行取込ルート）", () => {
    expect(classifyClipboard("a009\t4514603474916\t商品A\r\na010\t4514603474917\t商品B\r\n")).toBe("table");
  });

  it("1行だけでも2列以上あれば table", () => {
    expect(classifyClipboard("a009\t4514603474916")).toBe("table");
  });

  it("クォート済みセル（セル内改行あり）と通常セルが並ぶ表コピーも table", () => {
    expect(classifyClipboard('"セル内\n改行"\tとなりの列\r\n')).toBe("table");
  });

  it("改行もタブもない単一値は single（ブラウザ標準の貼り付けに任せる）", () => {
    expect(classifyClipboard("abc")).toBe("single");
  });

  it("空文字は single", () => {
    expect(classifyClipboard("")).toBe("single");
  });

  it("誤ルートの実害の固定: クォート内タブ入り1列コピーを parseTsv に渡すと NEコード列に HTML が入る", () => {
    // classifyClipboard が column と判定すべき理由（table ルートだとこの壊れた行になる）を証拠として残す
    const clipboard = '"<p>\t<b>■ 商品の魅力</b></p>"\r\n';
    const rows = parseTsv(clipboard);
    expect(rows).toHaveLength(1);
    expect(rows[0].ne_code).toContain("■ 商品の魅力"); // ← 表取込では HTML が NEコードに入ってしまう
    expect(classifyClipboard(clipboard)).toBe("column"); // だから列貼り付けへルートする
  });
});
