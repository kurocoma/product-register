import json
from pathlib import Path

def generate_report(result: dict, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

def print_summary(result: dict) -> str:
    s = result["summary"]
    lines = [
        f"[{result['mall']}] 検証結果:",
        f"  全行数: {s['total_rows']}",
        f"  一致: {s['matched_rows']}",
        f"  不一致: {s['mismatched_rows']}",
        f"  不足行: {s['missing_rows']}",
        f"  余剰行: {s['extra_rows']}",
    ]
    if result["mismatches"]:
        lines.append("  --- 差分詳細 (先頭5件) ---")
        for m in result["mismatches"][:5]:
            lines.append(f"  [{m['product_code']}]")
            for d in m["diffs"][:3]:
                lines.append(f"    {d['column']}: '{d['actual']}' → 期待値 '{d['expected']}'")
                if "hint" in d:
                    lines.append(f"    hint: {d['hint']}")
    return "\n".join(lines)
