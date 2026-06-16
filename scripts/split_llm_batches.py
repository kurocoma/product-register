"""needs_llm.json をドメイン順に並べて LLM 用バッチファイルへ分割する。"""
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
WORK = BASE / "docs" / "_mapping_work"
BATCH_DIR = WORK / "batches"
RESULT_DIR = WORK / "results"
BATCH_DIR.mkdir(parents=True, exist_ok=True)
RESULT_DIR.mkdir(parents=True, exist_ok=True)

BATCH_SIZE = 50

def main():
    items = json.load(open(WORK / "needs_llm.json", encoding="utf-8"))
    # ドメイン→パスでソート(同種を同バッチに固める=LLMの文脈が一貫)
    items.sort(key=lambda x: (x["domain"], x["rakuten_path"]))
    # 各アイテムは候補を yahoo_id/yahoo_path/domain_ok のみに絞る
    slim = []
    for x in items:
        slim.append({
            "gid": x["gid"],
            "rakuten_path": x["rakuten_path"],
            "domain": x["domain"],
            "allowed_yahoo_top": x.get("allowed_yahoo_top", []),
            "candidates": [
                {"yahoo_id": c["yahoo_id"], "yahoo_path": c["yahoo_path"],
                 "domain_ok": c["domain_ok"]}
                for c in x["candidates"]
            ],
        })
    n = 0
    for i in range(0, len(slim), BATCH_SIZE):
        batch = slim[i:i + BATCH_SIZE]
        idx = i // BATCH_SIZE
        (BATCH_DIR / f"batch_{idx:03d}.json").write_text(
            json.dumps({"batch": idx, "items": batch}, ensure_ascii=False),
            encoding="utf-8")
        n += 1
    manifest = {"num_batches": n, "batch_size": BATCH_SIZE, "total_items": len(slim)}
    (WORK / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"batches={n} total_items={len(slim)}")

if __name__ == "__main__":
    main()
