"""evaluator が返した JSON を eval-schema.json の固定契約に対して検証する（依存なし自前検証）。

ルール（spec準拠）:
- score / quality.overall は整数 0..100 で一致
- quality.breakdown のキーは criteria.yaml の軸と完全一致（欠落・余剰・改名を拒否）
- evaluator_skill == "eval-loop-evaluator"
- passed は bool、evidence / evaluated_artifacts は非空、feedback は非空文字列
スキーマ違反は呼び出し側（record_eval.py）で score=0 / passed=false に倒す。

CLI:
  python scripts/validate_eval_schema.py <eval.json> [--json]
終了コード: 0=valid, 1=invalid, 2=入力不能
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from _loop_common import LOOP_DIR, load_json, load_yaml

FIXED_AXES = [
    "correctness",
    "regression_safety",
    "test_quality",
    "maintainability",
    "integration_fit",
    "risk_control",
]
TOP_REQUIRED = [
    "score",
    "quality",
    "hard_gate_findings",
    "evidence",
    "feedback",
    "passed",
    "evaluator_skill",
    "evaluated_artifacts",
    "risks",
    "recommended_next_changes",
]


def _criteria_axes() -> list[str]:
    crit_path = LOOP_DIR / "criteria.yaml"
    try:
        crit = load_yaml(crit_path)
        axes = list((crit.get("quality_axes") or {}).keys())
        return axes or FIXED_AXES
    except Exception:
        return FIXED_AXES


def _is_int_0_100(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 100


def validate(obj, axes: list[str] | None = None):
    axes = axes or FIXED_AXES
    errors: list[str] = []

    if not isinstance(obj, dict):
        return False, ["root must be a JSON object"]

    for k in TOP_REQUIRED:
        if k not in obj:
            errors.append(f"missing top-level key: {k}")

    if "score" in obj and not _is_int_0_100(obj["score"]):
        errors.append("score must be integer 0..100")

    quality = obj.get("quality")
    if not isinstance(quality, dict):
        errors.append("quality must be an object")
    else:
        if not _is_int_0_100(quality.get("overall")):
            errors.append("quality.overall must be integer 0..100")
        bd = quality.get("breakdown")
        if not isinstance(bd, dict):
            errors.append("quality.breakdown must be an object")
        else:
            got = set(bd.keys())
            want = set(axes)
            if got != want:
                missing = want - got
                extra = got - want
                if missing:
                    errors.append(f"quality.breakdown missing axes: {sorted(missing)}")
                if extra:
                    errors.append(f"quality.breakdown has unexpected axes: {sorted(extra)}")
            for ax in axes:
                if ax in bd and not _is_int_0_100(bd[ax]):
                    errors.append(f"quality.breakdown.{ax} must be integer 0..100")

    # score と quality.overall の一致
    if _is_int_0_100(obj.get("score")) and isinstance(quality, dict) and _is_int_0_100(quality.get("overall")):
        if obj["score"] != quality["overall"]:
            errors.append("score must equal quality.overall")

    if obj.get("evaluator_skill") != "eval-loop-evaluator":
        errors.append('evaluator_skill must be "eval-loop-evaluator"')

    if not isinstance(obj.get("passed"), bool):
        errors.append("passed must be boolean")

    if not (isinstance(obj.get("evidence"), list) and len(obj["evidence"]) >= 1):
        errors.append("evidence must be a non-empty array")

    if not (isinstance(obj.get("evaluated_artifacts"), list) and len(obj["evaluated_artifacts"]) >= 1):
        errors.append("evaluated_artifacts must be a non-empty array")

    if not (isinstance(obj.get("feedback"), str) and obj["feedback"].strip()):
        errors.append("feedback must be a non-empty string")

    for arr_key in ("hard_gate_findings", "risks", "recommended_next_changes"):
        if arr_key in obj and not isinstance(obj[arr_key], list):
            errors.append(f"{arr_key} must be an array")

    return (len(errors) == 0), errors


def main(argv: list[str]) -> int:
    args = [a for a in argv if not a.startswith("--")]
    as_json = "--json" in argv
    if not args:
        print("usage: validate_eval_schema.py <eval.json> [--json]", file=sys.stderr)
        return 2
    path = Path(args[0])
    if not path.exists():
        print(f"eval json not found: {path}", file=sys.stderr)
        return 2
    try:
        obj = load_json(path)
    except Exception as e:
        if as_json:
            print(json.dumps({"valid": False, "errors": [f"json parse error: {e}"]}, ensure_ascii=False))
        else:
            print(f"INVALID json: {e}")
        return 1
    ok, errors = validate(obj, _criteria_axes())
    if as_json:
        print(json.dumps({"valid": ok, "errors": errors}, ensure_ascii=False, indent=2))
    else:
        print("VALID" if ok else "INVALID")
        for e in errors:
            print(f"  - {e}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
