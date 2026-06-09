#!/usr/bin/env python3
"""
宇都宮熊 データ更新スクリプト（公式ページ版）
---------------------------------------------
宇都宮市公式「クマの出没にご注意ください」ページから、時刻つきの目撃情報を取得して
data/sightings.json を作り直す。各目撃は「<町名>地内　<ランドマーク>から<方角><距離>m付近」
の形なので、ランドマーク座標表 + 方角/距離オフセットで座標化する。

- 公式の確かな情報のみ（status=official）。投稿（ユーザー報告）は別系統(Firestore)で扱う。
- 目撃時刻(time)を必ず保持する。
- 内容に変化が無ければ書き込まない（無駄なcommitを防ぐ）。
- 未知のランドマークが出たら status=official_locating として町名近辺に置き、警告を出す。

使い方:  python3 update_data.py
"""
import json, os, sys, re, math, urllib.request, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data", "sightings.json")
OFFICIAL_URL = "https://www.city.utsunomiya.lg.jp/kurashi/oshiraselist/1034544/1025612.html"
YEAR = 2026
BBOX = (36.45, 36.66, 139.78, 139.98)  # 妥当性チェック用（宇都宮市域）

# ランドマーク座標（GSI/OSM/下野新聞マイマップから確定済み）
LANDMARKS = {
    "栃木県立図書館": (36.5657, 139.8843),
    "図書館": (36.5657, 139.8843),
    "明保野公園": (36.5476, 139.8676),
    "宇都宮高等学校": (36.539781, 139.862824),
    "姿川中学校": (36.53598, 139.85634),
    "姿川地区市民センター": (36.52955, 139.849098),
    "中央卸売市場": (36.546299, 139.892565),
    "陽南中学校": (36.54704, 139.88862),
    "城東小学校": (36.550158, 139.903336),
    "横川東小学校": (36.532953, 139.90677),
    "宇都宮大学峰キャンパス": (36.548755, 139.913087),
    "長岡公園": (36.588501, 139.879821),
    "消防局中央消防署": (36.576483, 139.890648),  # 上大曽町近辺（中央消防署の精密座標は未取得）
}
# 町名フォールバック（ランドマーク不明時）
TOWN_FALLBACK = {
    "上大曽町": (36.576483, 139.890648),
    "東簗瀬1丁目": (36.541566, 139.900346),
}
BEARING = {"北": 0, "北東": 45, "東": 90, "南東": 135, "南": 180, "南西": 225, "西": 270, "北西": 315}


def dest(lat, lng, bearing_deg, dist_m):
    R = 6371000.0
    br = math.radians(bearing_deg); d = dist_m / R
    la1 = math.radians(lat); lo1 = math.radians(lng)
    la2 = math.asin(math.sin(la1) * math.cos(d) + math.cos(la1) * math.sin(d) * math.cos(br))
    lo2 = lo1 + math.atan2(math.sin(br) * math.sin(d) * math.cos(la1),
                           math.cos(d) - math.sin(la1) * math.sin(la2))
    return round(math.degrees(la2), 6), round(math.degrees(lo2), 6)


def norm_landmark(name):
    name = name.strip("　 ")
    for pre in ("栃木県立", "宇都宮市立", "宇都宮市"):
        if name.startswith(pre):
            name = name[len(pre):]
    return name


def geocode(town, phrase):
    """ phrase 例: '宇都宮大学峰キャンパスから南西700m付近' / '明保野公園内' / '陽南中学校の東側' """
    base, bearing, dist = phrase, None, 0
    m = re.search(r"(.+?)から(北東|南東|南西|北西|東|西|南|北)側?\s*(\d+)\s*m", phrase)
    if m:
        base, bearing, dist = m.group(1), m.group(2), int(m.group(3))
    else:
        m = re.search(r"(.+?)の(北東|南東|南西|北西|東|西|南|北)側", phrase)
        if m:
            base, bearing, dist = m.group(1), m.group(2), 150
        else:
            base = re.sub(r"(付近|内|校庭).*$", "", phrase)
    key = norm_landmark(base)
    coord, status = None, "official"
    if len(key) >= 2:  # 空/短すぎる base が先頭ランドマークに誤マッチするのを防ぐ
        for k, v in LANDMARKS.items():
            if k in key or key in k:
                coord = v; break
    if coord is None and town in TOWN_FALLBACK:
        coord = TOWN_FALLBACK[town]; status = "official_locating"
    if coord is None:
        return None, "official_locating"
    if bearing and dist:
        lat, lng = dest(coord[0], coord[1], BEARING[bearing], dist)
    else:
        lat, lng = coord
    return (lat, lng), status


def to_24h(ampm, hour, minute):
    h = hour % 12
    if ampm == "午後":
        h += 12
    return f"{h:02d}:{minute:02d}"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "utsunomiya-kuma-map/1.0 (pasotaro@pasotaro.com)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def parse_official(html):
    out = []
    for t in re.findall(r"・\s*([^<]+?)\s*</p>", html):
        m = re.match(r"(\d+)月(\d+)日（[^）]*）\s*(午前|午後)\s*(\d+)時(?:\s*(\d+)\s*分)?", t)
        if not m:
            continue
        mo, da, ampm, hh, mm = int(m.group(1)), int(m.group(2)), m.group(3), int(m.group(4)), int(m.group(5) or 0)
        rest = re.sub(r"^頃?[\s　、,]*", "", t[m.end():])  # 先頭の「頃」と全角スペースを除去
        sp = re.split(r"地内", rest, maxsplit=1)
        if len(sp) < 2:
            continue
        town = sp[0].strip("　 、,")
        phrase = sp[1].strip("　 、,")
        date = f"{YEAR}-{mo:02d}-{da:02d}"
        time_s = to_24h(ampm, hh, mm)
        coord, status = geocode(town, phrase)
        if coord is None:
            print(f"[warn] 座標不明: {town} / {phrase}", file=sys.stderr)
            continue
        lat, lng = coord
        if not (BBOX[0] <= lat <= BBOX[1] and BBOX[2] <= lng <= BBOX[3]):
            print(f"[warn] 範囲外スキップ: {town} {phrase} -> {lat},{lng}", file=sys.stderr)
            continue
        out.append({
            "date": date, "time": time_s, "datetime": f"{date}T{time_s}:00+09:00",
            "area": (f"{town}（{phrase}）" if phrase else town), "town": town, "detail": "",
            "lat": lat, "lng": lng, "status": status,
            "source": OFFICIAL_URL, "sourceName": "宇都宮市公式",
        })
    # 古い順
    out.sort(key=lambda s: s["datetime"])
    for i, s in enumerate(out, 1):
        s["id"] = i
    if out:
        out[-1]["latest"] = True
    return out


def main():
    with open(DATA, encoding="utf-8") as f:
        data = json.load(f)
    before = json.dumps(data.get("sightings", []), ensure_ascii=False, sort_keys=True)

    try:
        sightings = parse_official(fetch(OFFICIAL_URL))
    except Exception as e:
        print(f"[error] 公式ページ取得/解析に失敗: {e}", file=sys.stderr)
        return 1
    if not sightings:
        print("[error] 目撃情報を1件も抽出できませんでした（ページ構造変化の可能性）", file=sys.stderr)
        return 1
    print(f"[info] 公式から {len(sightings)}件 抽出（最新 {sightings[-1]['date']} {sightings[-1]['time']} {sightings[-1]['town']}）")

    after = json.dumps(sightings, ensure_ascii=False, sort_keys=True)
    if after == before:
        print(f"[ok] 変更なし（{len(sightings)}件）。書き込みスキップ。")
        return 0

    data["sightings"] = sightings
    data["updatedAt"] = datetime.datetime.now().astimezone().replace(microsecond=0).isoformat()
    with open(DATA, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"[ok] {len(sightings)}件を data/sightings.json に書き込み（updatedAt={data['updatedAt']}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
