"""
最終マージ: 自動採用(高/中) + LLM結果(results/*.json) + 候補なし を結合し、
楽天ジャンル→Yahooカテゴリ マッピングCSVを生成する。

出力: docs/rakuten_yahoo_category_mapping.csv (UTF-8 BOM)
列: rakuten_genre_id, rakuten_path, yahoo_category_id, yahoo_category_name,
    yahoo_path, confidence, match_method, match_reason
"""
import csv, json
from pathlib import Path
from collections import Counter

BASE = Path(__file__).resolve().parent.parent
WORK = BASE / "docs" / "_mapping_work"
YAHOO_CSV = BASE / "docs" / "data.csv"
RAKUTEN_CSV = BASE / "docs" / "ichiba_attribute_list_20260421.csv"
OUT_CSV = BASE / "docs" / "rakuten_yahoo_category_mapping.csv"


def load_yahoo_index():
    idx = {}
    with open(YAHOO_CSV, encoding="cp932", newline="") as f:
        for row in csv.DictReader(f):
            idx[row["id"].strip()] = (row["name"].strip(), row["path_name"].strip())
    return idx


def load_rakuten_all():
    """全楽天ジャンル(順序保持) gid -> (path, domain)"""
    seen = {}
    with open(RAKUTEN_CSV, encoding="cp932", newline="") as f:
        for row in csv.DictReader(f):
            gid = row["ジャンルID"].strip()
            if gid not in seen:
                seen[gid] = (row["パス名"].strip(), row["商品属性定義書"].strip())
    return seen


def main():
    yidx = load_yahoo_index()
    rakuten = load_rakuten_all()

    # gid -> 候補 yahoo_id 集合 (LLM結果の検証用), gid -> path
    needs = json.load(open(WORK / "needs_llm.json", encoding="utf-8"))
    cand_ids = {x["gid"]: {c["yahoo_id"] for c in x["candidates"]} for x in needs}

    result = {}  # gid -> row dict
    stats = Counter()
    warnings = []

    def put(gid, yid, yname, ypath, conf, method, reason):
        rk_path, _ = rakuten.get(gid, ("", ""))
        result[gid] = {
            "rakuten_genre_id": gid,
            "rakuten_path": rk_path,
            "yahoo_category_id": yid or "",
            "yahoo_category_name": yname or "",
            "yahoo_path": ypath or "",
            "confidence": conf,
            "match_method": method,
            "match_reason": reason or "",
        }

    # 1) 自動採用(高/中)
    for fname, method_default in [("auto_high.json", "deterministic-exact-unique"),
                                  ("auto_mid.json", "deterministic-strong")]:
        for a in json.load(open(WORK / fname, encoding="utf-8")):
            put(a["gid"], a["yahoo_id"], a["yahoo_name"], a["yahoo_path"],
                a["confidence"], a.get("method", method_default), a.get("reason", ""))
            stats[f"auto_{a['confidence']}"] += 1

    # 2) LLM 結果
    rdir = WORK / "results"
    missing_batches = []
    for bf in sorted((WORK / "batches").glob("batch_*.json")):
        rf = rdir / bf.name
        if not rf.exists():
            missing_batches.append(bf.name)
            continue
        try:
            rows = json.loads(rf.read_text(encoding="utf-8"))
        except Exception as e:
            warnings.append(f"PARSE FAIL {rf.name}: {e}")
            missing_batches.append(bf.name)
            continue
        for r in rows:
            gid = str(r.get("gid", "")).strip()
            if not gid or gid not in rakuten:
                warnings.append(f"unknown gid in {rf.name}: {gid}")
                continue
            yid = r.get("yahoo_id")
            conf = r.get("confidence", "低")
            reason = r.get("reason", "")
            if yid in (None, "", "null"):
                put(gid, "", "", "", "なし", "llm", reason)
                stats["llm_none"] += 1
                continue
            yid = str(yid).strip()
            # 検証: 候補内 & Yahoo マスタに存在
            if gid in cand_ids and yid not in cand_ids[gid]:
                warnings.append(f"{rf.name} gid={gid}: yahoo_id {yid} not in candidates")
            if yid not in yidx:
                warnings.append(f"{rf.name} gid={gid}: yahoo_id {yid} not in master -> none")
                put(gid, "", "", "", "なし", "llm-invalid", reason)
                stats["llm_invalid"] += 1
                continue
            yname, ypath = yidx[yid]
            put(gid, yid, yname, ypath, conf, "llm", reason)
            stats[f"llm_{conf}"] += 1

    # 3) 候補なし
    for nc in json.load(open(WORK / "no_candidate.json", encoding="utf-8")):
        gid = nc["gid"]
        if gid not in result:
            put(gid, "", "", "", "なし", "no-candidate", "候補なし")
            stats["no_candidate"] += 1

    # 4) 取りこぼし(どのソースにも無い gid)を補完
    for gid in rakuten:
        if gid not in result:
            put(gid, "", "", "", "なし", "uncovered", "未処理")
            stats["uncovered"] += 1

    # 出力 (楽天パス順)
    fieldnames = ["rakuten_genre_id", "rakuten_path", "yahoo_category_id",
                  "yahoo_category_name", "yahoo_path", "confidence",
                  "match_method", "match_reason"]
    rows_out = sorted(result.values(), key=lambda r: (r["rakuten_path"], r["rakuten_genre_id"]))
    with open(OUT_CSV, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows_out)

    # サマリ
    lines = [f"出力: {OUT_CSV}", f"総行数: {len(rows_out)} / 楽天ジャンル {len(rakuten)}", ""]
    lines.append("=== 内訳 ===")
    for k in sorted(stats):
        lines.append(f"  {k}: {stats[k]}")
    matched = sum(1 for r in rows_out if r["yahoo_category_id"])
    lines.append("")
    lines.append(f"マッチ成立(yahoo_id あり): {matched}")
    lines.append(f"未マッチ(なし): {len(rows_out) - matched}")
    if missing_batches:
        lines.append("")
        lines.append(f"!! 欠落バッチ {len(missing_batches)} 件: " + ", ".join(missing_batches[:30]))
    if warnings:
        lines.append("")
        lines.append(f"!! 警告 {len(warnings)} 件(先頭30):")
        lines.extend("  " + w for w in warnings[:30])
    (WORK / "merge_stats.txt").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines[:12]))
    print(f"...(詳細は {WORK / 'merge_stats.txt'})")


if __name__ == "__main__":
    main()
