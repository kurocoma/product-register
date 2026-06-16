"""
楽天ジャンル(14,367) → Yahoo カテゴリ(12,919) 全件マッピング — Stage 1 (決定的候補生成)

ハイブリッド方式の前段。各楽天ジャンルに対し Yahoo 候補上位 K 件を
TF-IDF(語句トークン) + 文字バイグラム類似度 + ドメイン辞書で抽出する。
- 完全一致かつ一意かつドメイン整合 → 自動採用(高)。LLM 不要。
- それ以外で候補あり → needs_llm.json へ(後段で LLM が候補から最適を選ぶ)。
- 候補なし → no_candidate.json。

出力(docs/_mapping_work/):
  auto_accepted.json / needs_llm.json / no_candidate.json / stage1_stats.txt
"""
import csv, json, math, re, unicodedata
from pathlib import Path
from collections import defaultdict, Counter

BASE = Path(__file__).resolve().parent.parent
YAHOO_CSV = BASE / "docs" / "data.csv"
RAKUTEN_CSV = BASE / "docs" / "ichiba_attribute_list_20260421.csv"
WORK = BASE / "docs" / "_mapping_work"
WORK.mkdir(parents=True, exist_ok=True)

TOPK = 12            # LLM へ渡す候補数
RETRIEVE = 60        # 詳細スコアリング対象の粗候補数
SKIP_DF = 3000       # これより高頻度のトークン/バイグラムは検索から除外(汎用語)
T_MID = 78           # 自動採用(中)の最低スコア
GAP_MID = 18         # 自動採用(中)の最低 top1-top2 差

GENERIC_LEAVES = {
    "その他", "セット", "詰め合わせ", "セット・詰め合わせ", "本体", "パーツ",
    "用品", "アクセサリー", "周辺機器", "関連商品", "未分類", "その他特典",
}

# 楽天 商品属性定義書(56) → Yahoo トップレベル(優先順)
DOMAIN_MAP = {
    "車・バイク": ["車、バイク、自転車"],
    "車用品・バイク用品": ["車、バイク、自転車"],
    "自転車・自転車用品": ["車、バイク、自転車"],
    "食品": ["食品"],
    "スイーツ・お菓子": ["食品"],
    "水・ソフトドリンク": ["食品"],
    "酒類": ["食品"],
    "医薬品・コンタクト・介護": ["ダイエット、健康"],
    "ダイエット・健康": ["ダイエット、健康"],
    "DIY": ["DIY、工具"],
    "本・雑誌・コミック": ["本、雑誌、コミック"],
    "スポーツ用品": ["スポーツ", "アウトドア、釣り、旅行用品"],
    "スポーツウェア": ["スポーツ", "ファッション"],
    "アウトドア用品": ["アウトドア、釣り、旅行用品", "スポーツ"],
    "CD・DVD": ["CD、音楽ソフト、チケット", "DVD、映像ソフト"],
    "日用品雑貨": ["キッチン、日用品、文具"],
    "文房具": ["キッチン、日用品、文具"],
    "キッチン用品・食器・調理器具": ["キッチン、日用品、文具"],
    "家電": ["家電"],
    "ペットグッズ": ["ペット用品、生き物"],
    "ペット用食品": ["ペット用品、生き物"],
    "ペット医療品": ["ペット用品、生き物"],
    "ペット本体": ["ペット用品、生き物"],
    "楽器・音響機器": ["楽器、手芸、コレクション", "テレビ、オーディオ、カメラ"],
    "ホビー": ["楽器、手芸、コレクション", "ゲーム、おもちゃ"],
    "手芸": ["楽器、手芸、コレクション"],
    "パソコン・周辺機器": ["スマホ、タブレット、パソコン"],
    "スマートフォン・タブレット": ["スマホ、タブレット、パソコン"],
    "キッズ・ベビー・マタニティ ファッション": ["ベビー、キッズ、マタニティ", "ファッション"],
    "キッズ・ベビー用品": ["ベビー、キッズ、マタニティ"],
    "キッズ・ベビー衛生・医療品": ["ベビー、キッズ、マタニティ"],
    "美容・コスメ・香水": ["コスメ、美容、ヘアケア"],
    "TV・オーディオ・カメラ": ["テレビ、オーディオ、カメラ"],
    "おもちゃ": ["ゲーム、おもちゃ"],
    "テレビゲーム": ["ゲーム、おもちゃ"],
    "バッグ・小物・ブランド雑貨": ["ファッション"],
    "ジュエリー・アクセサリー": ["ファッション"],
    "インナー・下着・ナイトウェア": ["ファッション"],
    "レディースファッション": ["ファッション"],
    "メンズファッション": ["ファッション"],
    "靴": ["ファッション"],
    "腕時計": ["ファッション"],
    "作業着": ["ファッション", "DIY、工具"],
    "花": ["花、ガーデニング"],
    "ガーデン": ["花、ガーデニング", "DIY、工具"],
    "サービス・リフォーム": ["レンタル、各種サービス"],
    "住宅・不動産": ["レンタル、各種サービス"],
    "カタログギフト・チケット": ["CD、音楽ソフト、チケット", "レンタル、各種サービス"],
    "小物・ファブリック": ["家具、インテリア"],
    "家具": ["家具、インテリア"],
    "寝具": ["家具、インテリア"],
    "収納": ["家具、インテリア"],
    "カーテン・壁紙": ["家具、インテリア"],
    "カーペット・畳": ["家具、インテリア"],
    "ライト・照明器具": ["家具、インテリア", "家電"],
    "光回線・モバイル通信": ["通信、SIM"],
}

SPLIT_RE = re.compile(r"[>＞、,，・/／\s&＆\|｜\(\)（）\[\]「」【】『』:：;；～~\-－+＋]+")


def norm(t: str) -> str:
    t = unicodedata.normalize("NFKC", t or "")
    t = t.replace("　", " ").strip().lower()
    return t


def tokens(t: str) -> list[str]:
    return [x for x in SPLIT_RE.split(norm(t)) if len(x) >= 1]


def bigrams(t: str) -> set[str]:
    s = norm(t).replace(" ", "")
    return {s[i:i+2] for i in range(len(s) - 1)} if len(s) >= 2 else ({s} if s else set())


def load_yahoo() -> list[dict]:
    out = []
    with open(YAHOO_CSV, encoding="cp932", newline="") as f:
        for row in csv.DictReader(f):
            name = (row["name"] or "").strip()
            path = (row["path_name"] or "").strip()
            parts = [p.strip() for p in path.split(">")]
            name_n = norm(name)
            phrase = set(tokens(name)) | set(tokens(path))
            # 末端(name)とパス全体のバイグラム
            bg = bigrams(name)
            for p in parts:
                bg |= bigrams(p)
            out.append({
                "id": row["id"].strip(), "name": name, "path": path,
                "top": parts[0] if parts else "", "name_n": name_n,
                "path_n": norm(path), "phrase": phrase, "bg": bg,
                "bg_name": bigrams(name),
            })
    return out


def load_rakuten() -> list[dict]:
    seen = {}
    with open(RAKUTEN_CSV, encoding="cp932", newline="") as f:
        for row in csv.DictReader(f):
            gid = row["ジャンルID"].strip()
            if gid in seen:
                continue
            path = (row["パス名"] or "").strip()
            seen[gid] = {
                "gid": gid, "path": path,
                "domain": (row["商品属性定義書"] or "").strip(),
                "parts": [p.strip() for p in path.split(">>")],
            }
    return list(seen.values())


def build_index(yahoo: list[dict]):
    tok_idx = defaultdict(list)   # phrase token -> [yahoo_idx]
    bg_idx = defaultdict(list)    # bigram -> [yahoo_idx]
    for i, y in enumerate(yahoo):
        for t in y["phrase"]:
            tok_idx[t].append(i)
        for b in y["bg"]:
            bg_idx[b].append(i)
    N = len(yahoo)
    tok_idf = {t: math.log(N / len(v)) for t, v in tok_idx.items()}
    bg_idf = {b: math.log(N / len(v)) for b, v in bg_idx.items()}
    return tok_idx, bg_idx, tok_idf, bg_idf


def seg_weight(parts: list[str]) -> list[tuple[str, float]]:
    """各セグメントに深さ重みを付ける(leaf 最重視→ 親・祖父も substantial)。"""
    n = len(parts)
    w = []
    for i, p in enumerate(parts):
        depth_from_leaf = n - 1 - i  # leaf=0
        weight = {0: 1.0, 1: 0.7, 2: 0.45}.get(depth_from_leaf, 0.3)
        w.append((p, weight))
    return w


def retrieve(rk: dict, yahoo, tok_idx, bg_idx, tok_idf, bg_idf) -> list[int]:
    """IDF 加重で粗候補を集める。親セグメントも重み付けして再現率を上げる。"""
    score = defaultdict(float)
    seg_w = seg_weight(rk["parts"])
    # 語句トークン(セグメント深さ重み)
    tok_w: dict[str, float] = {}
    for seg, w in seg_w:
        for t in tokens(seg):
            tok_w[t] = max(tok_w.get(t, 0.0), w)
    for t, w in tok_w.items():
        post = tok_idx.get(t)
        if not post or len(post) > SKIP_DF:
            continue
        ww = 3.0 * tok_idf[t] * (0.5 + w)
        for yi in post:
            score[yi] += ww
    # バイグラム: leaf+親+祖父
    bg_w: dict[str, float] = {}
    for seg, w in seg_w[-3:]:
        for b in bigrams(seg):
            bg_w[b] = max(bg_w.get(b, 0.0), w)
    for b, w in bg_w.items():
        post = bg_idx.get(b)
        if not post or len(post) > SKIP_DF:
            continue
        ww = 1.0 * bg_idf[b] * (0.5 + w)
        for yi in post:
            score[yi] += ww
    return [i for i, _ in sorted(score.items(), key=lambda x: -x[1])[:RETRIEVE]]


def detail_score(rk: dict, y: dict, allowed: list[str]) -> tuple[float, bool, bool, str]:
    """best-segment 方式: Yahoo名が楽天のどのセグメントに最もよく一致するかで採点。"""
    parts = rk["parts"]
    leaf = norm(parts[-1]) if parts else ""
    yname = y["name_n"]
    ypath = y["path_n"]
    reasons = []
    s = 0.0

    # Yahoo名 vs 各楽天セグメント(深さ重み付き)の最良一致
    best_seg_score = 0.0
    best_seg = ""
    leaf_exact = False
    for seg, w in seg_weight(parts):
        sn = norm(seg)
        if not sn:
            continue
        contrib = 0.0
        if sn == yname:
            contrib = 100.0
            if w == 1.0:
                leaf_exact = True
        elif sn in yname and len(sn) / max(len(yname), 1) >= 0.4:
            contrib = 62.0 * (len(sn) / len(yname))
        elif yname in sn and len(yname) / max(len(sn), 1) >= 0.4:
            contrib = 52.0 * (len(yname) / len(sn))
        else:
            sbg, ybg = bigrams(seg), y["bg_name"]
            if sbg and ybg:
                j = len(sbg & ybg) / len(sbg | ybg)
                if j >= 0.34:
                    contrib = 46.0 * j
        contrib *= (0.55 + 0.45 * w)  # 深さ重みで減衰(leaf=1.0)
        if contrib > best_seg_score:
            best_seg_score, best_seg = contrib, seg
    s += best_seg_score
    if best_seg_score >= 40:
        reasons.append(f"'{best_seg}'~Yahoo名'{y['name']}'")

    # パス側トークン重なり(文脈)
    rk_tok = set()
    for seg, _ in seg_weight(parts):
        rk_tok |= set(tokens(seg))
    y_tok = y["phrase"]
    if rk_tok and y_tok:
        inter = rk_tok & y_tok
        if inter:
            ov = len(inter) / len(rk_tok)
            s += 22 * ov
            if ov >= 0.4:
                reasons.append(f"文脈一致{ov:.0%}")

    # ドメイン
    dom_ok = False
    if allowed:
        if y["top"] in allowed:
            dom_ok = True
            s += 26 * (1.0 if y["top"] == allowed[0] else 0.7)
            reasons.append(f"ドメイン一致'{y['top']}'")
        else:
            s -= 32; reasons.append(f"ドメイン不一致'{y['top']}'(-32)")

    # 汎用ペナルティ / 深さ近似
    if leaf in {norm(g) for g in GENERIC_LEAVES} or "その他" in yname:
        s -= 4
    if abs(len(parts) - len(y["path"].split(">"))) <= 1:
        s += 4
    return s, leaf_exact, dom_ok, "; ".join(reasons)


def main():
    yahoo = load_yahoo()
    rakuten = load_rakuten()
    tok_idx, bg_idx, tok_idf, bg_idf = build_index(yahoo)

    # Yahoo 名のグローバル出現回数(完全一致の一意性判定用)
    name_count = Counter(y["name_n"] for y in yahoo)
    generic_n = {norm(g) for g in GENERIC_LEAVES}

    auto_hi, auto_mid, needs_llm, no_cand = [], [], [], []
    stats = Counter()
    hist = Counter()  # 自動採用に至らなかった top1 スコア帯

    for rk in rakuten:
        allowed = DOMAIN_MAP.get(rk["domain"], [])
        cand_idx = retrieve(rk, yahoo, tok_idx, bg_idx, tok_idf, bg_idf)
        scored = []
        for yi in cand_idx:
            sc, exact, dom_ok, why = detail_score(rk, yahoo[yi], allowed)
            scored.append((sc, exact, dom_ok, why, yi))
        scored.sort(key=lambda x: -x[0])
        top = scored[:TOPK]
        if not top or top[0][0] <= 0:
            no_cand.append({"gid": rk["gid"], "path": rk["path"], "domain": rk["domain"]})
            stats["no_candidate"] += 1
            continue

        leaf = norm(rk["parts"][-1]) if rk["parts"] else ""
        is_generic = leaf in generic_n
        gap = top[0][0] - (top[1][0] if len(top) > 1 else 0)
        best = top[0]
        by = yahoo[best[4]]

        def emit(bucket, conf, method):
            bucket.append({
                "gid": rk["gid"], "rakuten_path": rk["path"], "domain": rk["domain"],
                "yahoo_id": by["id"], "yahoo_name": by["name"], "yahoo_path": by["path"],
                "confidence": conf, "method": method,
                "reason": best[3], "score": round(best[0], 1),
            })

        # 高: leaf 完全一致 & Yahoo 名がグローバル一意 & ドメイン整合 & 非汎用
        if (best[1] and not is_generic and (best[2] or not allowed)
                and name_count[by["name_n"]] == 1):
            emit(auto_hi, "高", "deterministic-exact-unique")
            stats["auto_hi"] += 1
            continue
        # 中: 高スコア & 大差 & ドメイン整合 & 非汎用
        if (best[0] >= T_MID and gap >= GAP_MID and best[2]
                and not is_generic):
            emit(auto_mid, "中", "deterministic-strong")
            stats["auto_mid"] += 1
            continue

        # それ以外は LLM へ
        hist[int(best[0] // 10) * 10] += 1
        cands = [{
            "yahoo_id": yahoo[yi]["id"], "yahoo_name": yahoo[yi]["name"],
            "yahoo_path": yahoo[yi]["path"], "score": round(sc, 1),
            "exact": exact, "domain_ok": dom_ok,
        } for sc, exact, dom_ok, why, yi in top]
        needs_llm.append({
            "gid": rk["gid"], "rakuten_path": rk["path"], "domain": rk["domain"],
            "allowed_yahoo_top": allowed, "candidates": cands,
        })
        stats["needs_llm"] += 1

    (WORK / "auto_high.json").write_text(json.dumps(auto_hi, ensure_ascii=False, indent=1), encoding="utf-8")
    (WORK / "auto_mid.json").write_text(json.dumps(auto_mid, ensure_ascii=False, indent=1), encoding="utf-8")
    (WORK / "needs_llm.json").write_text(json.dumps(needs_llm, ensure_ascii=False, indent=1), encoding="utf-8")
    (WORK / "no_candidate.json").write_text(json.dumps(no_cand, ensure_ascii=False, indent=1), encoding="utf-8")

    lines = [
        f"楽天ジャンル総数: {len(rakuten)}",
        f"Yahoo カテゴリ総数: {len(yahoo)}",
        f"自動採用(高/一意完全一致): {stats['auto_hi']}",
        f"自動採用(中/強一致): {stats['auto_mid']}",
        f"LLM 判定必要: {stats['needs_llm']}",
        f"候補なし: {stats['no_candidate']}",
        "",
        "=== LLM 行き top1 スコア帯ヒストグラム ===",
    ]
    for k in sorted(hist):
        lines.append(f"  {k:>4}-{k+9}: {hist[k]}")
    lines.append("")
    lines.append("=== needs_llm のドメイン別件数(上位20) ===")
    for k, v in Counter(x["domain"] for x in needs_llm).most_common(20):
        lines.append(f"  {v:5d}  {k}")
    lines.append("")
    lines.append("=== 自動採用(中)サンプル(先頭20) ===")
    for a in auto_mid[:20]:
        lines.append(f"  [{a['score']}] {a['rakuten_path']}  ->  {a['yahoo_path']}")
    lines.append("")
    lines.append("=== needs_llm サンプル(先頭10、候補上位4) ===")
    for x in needs_llm[:10]:
        lines.append(f"  [{x['domain']}] {x['rakuten_path']}")
        for c in x["candidates"][:4]:
            lines.append(f"      {c['score']:>6} ex={c['exact']} dom={c['domain_ok']}  {c['yahoo_path']}")
    (WORK / "stage1_stats.txt").write_text("\n".join(lines), encoding="utf-8")
    print("done")
    print("\n".join(lines[:6]))


if __name__ == "__main__":
    main()
