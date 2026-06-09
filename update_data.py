#!/usr/bin/env python3
"""
宇都宮熊 データ更新スクリプト
--------------------------------
下野新聞「とちぎのクマ目撃情報2026」Google マイマップ(KML) を取得し、
"市街地に逃げ込んだ今回のクマ" の範囲（中心部 bbox × 6月の期間）だけを抽出して
data/sightings.json にマージする。

- 既存の手入力キャプション（場所名・時刻・detail）は保持する。
- 新しい座標（既存からおおよそ40m以上離れた点）だけを追記する。
- 追記された点の場所名は「（自動取得・要確認）」となる。
  → スケジュール実行の Claude ルーティンが、出典記事を読んで正式な地名・時刻に整える想定。
- "latest"（最新地点）は日付が最も新しい点に付け替える。

使い方:  python3 update_data.py
"""
import json, os, sys, urllib.request, datetime
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data", "sightings.json")
MID = "1FiDKp98cxzU1GQu04o5rnmbtT1mgmZs"
KML_URL = f"https://www.google.com/maps/d/kml?mid={MID}&forcekml=1"

# 「今回の市街地のクマ」の抽出条件
BBOX = (36.50, 36.62, 139.82, 139.95)      # lat_min, lat_max, lng_min, lng_max（宇都宮中心部）
DATE_FROM = "2026-06-01"                     # この出没事案の期間
DATE_TO = "2026-06-30"
MERGE_DIST_M = 40                            # これ以内の既存点は「同じ地点」とみなす
KNS = "{http://www.opengis.net/kml/2.2}"


def haversine(la1, lo1, la2, lo2):
    import math
    R = 6371000.0
    dla = math.radians(la2 - la1); dlo = math.radians(lo2 - lo1)
    a = math.sin(dla/2)**2 + math.cos(math.radians(la1))*math.cos(math.radians(la2))*math.sin(dlo/2)**2
    return 2*R*math.asin(math.sqrt(a))


def norm_date(name):
    """KMLの name(例 2026/06/07, 2026/4/10, 2020/06/07[誤記]) を YYYY-MM-DD に。"""
    s = (name or "").strip().replace(".", "/").replace("-", "/")
    parts = s.split("/")
    if len(parts) < 3 or not parts[0].isdigit():
        return None
    y, m, d = parts[0], parts[1], parts[2][:2]
    if not (m.isdigit() and d.isdigit()):
        return None
    if y == "2020":          # データ内に紛れている明らかな誤記を補正
        y = "2026"
    try:
        return datetime.date(int(y), int(m), int(d)).isoformat()
    except ValueError:
        return None


def fetch_kml():
    req = urllib.request.Request(KML_URL, headers={"User-Agent": "utsunomiya-kuma/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def parse_incident(kml_bytes):
    root = ET.fromstring(kml_bytes)
    out = []
    for pm in root.iter(f"{KNS}Placemark"):
        name = pm.findtext(f"{KNS}name", default="")
        desc = pm.findtext(f"{KNS}description", default="")
        c = pm.find(f".//{KNS}coordinates")
        if c is None or not c.text:
            continue
        lng, lat, *_ = [float(x) for x in c.text.strip().split(",")]
        date = norm_date(name)
        if not date:
            continue
        if not (BBOX[0] <= lat <= BBOX[1] and BBOX[2] <= lng <= BBOX[3]):
            continue
        if not (DATE_FROM <= date <= DATE_TO):
            continue
        out.append({"date": date, "lat": lat, "lng": lng, "source": (desc or "").strip()})
    out.sort(key=lambda p: (p["date"], p["lat"]))
    return out


def main():
    with open(DATA, encoding="utf-8") as f:
        data = json.load(f)
    existing = data["sightings"]

    try:
        incident = parse_incident(fetch_kml())
    except Exception as e:
        print(f"[error] KML取得/解析に失敗: {e}", file=sys.stderr)
        return 1
    print(f"[info] マイマップ抽出: {len(incident)}件（中心部×6月）")

    added = 0
    next_id = max((s["id"] for s in existing), default=0) + 1
    for p in incident:
        dup = any(haversine(p["lat"], p["lng"], s["lat"], s["lng"]) <= MERGE_DIST_M for s in existing)
        if dup:
            continue
        existing.append({
            "id": next_id, "date": p["date"], "time": "",
            "area": "（自動取得・要確認）宇都宮市街地", "detail": "マイマップから自動追加",
            "lat": round(p["lat"], 5), "lng": round(p["lng"], 5), "source": p["source"],
        })
        next_id += 1; added += 1

    # latest を最新日付の点へ付け替え
    existing.sort(key=lambda s: (s["date"], s["id"]))
    for s in existing:
        s.pop("latest", None)
    if existing:
        existing[-1]["latest"] = True

    data["sightings"] = existing
    data["updatedAt"] = datetime.datetime.now().astimezone().replace(microsecond=0).isoformat()

    with open(DATA, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"[ok] 追加 {added}件 / 合計 {len(existing)}件 を data/sightings.json に書き込み（updatedAt={data['updatedAt']}）")
    if added:
        print("[next] 追加点の場所名は『（自動取得・要確認）』です。出典記事を読んで正式名に整えてください。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
