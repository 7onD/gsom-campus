"""Собирает src/data/map1.json и map2.json для векторной карты.
Вход: data/vec-floorN.json (tools/vectorize.swift: контур здания и помещения), src/data/floorN.json (якоря), подписи и иконки ниже.
Все координаты — пиксели исходных планов (assets/plans/floorN.jpg), поэтому раскладка совпадает с оригиналом.
Запуск: python3 -I tools/build_map.py"""
import json, re

STAIRS = [(290, 1322), (1015, 1322), (1723, 1322), (2465, 1322), (925, 2578), (1815, 2578)]

# Подписи: t — текст, x/y — центр (a="start"/"end" — привязка), s — размер в пикселях плана, k — тип (poi, wing-b, wing-g, office, note)
LABELS = {
    1: [
        {"t": "Библиотека", "x": 2085, "y": 368, "k": "poi"},
        {"t": "Служба по работе", "x": 880, "y": 697, "k": "office"},
        {"t": "с молодёжью.", "x": 880, "y": 726, "k": "office"},
        {"t": "Студсовет", "x": 882, "y": 755, "k": "office"},
        {"t": "IT-служба", "x": 1818, "y": 753, "k": "office"},
        {"t": "Кафе", "x": 930, "y": 1212, "k": "office"},
        {"t": "Холодильник", "x": 1816, "y": 1195, "k": "office"},
        {"t": "и микроволновка", "x": 1816, "y": 1224, "k": "office"},
        {"t": "Центральный холл", "x": 1376, "y": 1326, "k": "note"},
        {"t": "Банкомат", "x": 934, "y": 1590, "k": "office"},
        {"t": "Комендант", "x": 776, "y": 1649, "k": "office", "a": "end"},
        {"t": "Охрана", "x": 776, "y": 1706, "k": "office", "a": "end"},
        {"t": "Завхоз", "x": 1978, "y": 1653, "k": "office", "a": "start"},
        {"t": "Книжный магазин", "x": 1978, "y": 1711, "k": "office", "a": "start"},
        {"t": "Гардероб", "x": 1240, "y": 1668, "k": "office"},
        {"t": "Гардероб", "x": 1504, "y": 1655, "k": "office"},
        {"t": "(самообсл.)", "x": 1504, "y": 1682, "k": "office"},
        {"t": "Главный вход", "x": 1093, "y": 1835, "k": "note"},
        {"t": "Конференц-зал", "x": 1372, "y": 398, "k": "poi"},
        {"t": "Офис директора", "x": 1173, "y": 2664, "k": "wing-b"},
        {"t": "1106 – 1123", "x": 310, "y": 2221, "k": "wing-b", "a": "start", "s": 36, "b": 1},
        {"t": "Преподавательские.", "x": 310, "y": 2266, "k": "wing-b", "a": "start", "s": 36, "b": 1},
        {"t": "Восточное крыло", "x": 310, "y": 2312, "k": "wing-b", "a": "start", "s": 36, "b": 1},
        {"t": "1132 – 1152", "x": 2000, "y": 2204, "k": "wing-g", "a": "start", "s": 36, "b": 1},
        {"t": "Преподавательские.", "x": 2000, "y": 2250, "k": "wing-g", "a": "start", "s": 36, "b": 1},
        {"t": "Западное крыло", "x": 2000, "y": 2295, "k": "wing-g", "a": "start", "s": 36, "b": 1},
    ],
    2: [
        {"t": "Международный", "x": 401, "y": 1044, "k": "office"},
        {"t": "отдел", "x": 401, "y": 1073, "k": "office"},
        {"t": "Офис программ", "x": 2180, "y": 1038, "k": "office"},
        {"t": "бакалавриата", "x": 2180, "y": 1066, "k": "office"},
        {"t": "Центр карьер", "x": 2415, "y": 1063, "k": "office"},
        {"t": "2107 – 2133", "x": 312, "y": 2221, "k": "wing-b", "a": "start", "s": 36, "b": 1},
        {"t": "Преподавательские.", "x": 312, "y": 2266, "k": "wing-b", "a": "start", "s": 36, "b": 1},
        {"t": "Восточное крыло", "x": 312, "y": 2306, "k": "wing-b", "a": "start", "s": 36, "b": 1},
        {"t": "2140 – 2168", "x": 2000, "y": 2204, "k": "wing-g", "a": "start", "s": 36, "b": 1},
        {"t": "Преподавательские.", "x": 2000, "y": 2250, "k": "wing-g", "a": "start", "s": 36, "b": 1},
        {"t": "Западное крыло", "x": 2000, "y": 2295, "k": "wing-g", "a": "start", "s": 36, "b": 1},
    ],
}
ICONS = {
    1: [("cafe", 930, 1162), ("hanger", 1240, 1636), ("hanger", 1504, 1626), ("atm", 1027, 1640), ("entrance", 1093, 1800)],
    2: [],
}
# Номер на карте ставим в центр прямоугольной ячейки; для сложных форм — в исходную позицию подписи
LABEL_OVERRIDE = {"1301": (1372, 352)}

def bbox_of(path):
    nums = [int(n) for n in re.findall(r"-?\d+", path)]
    xs, ys = nums[0::2], nums[1::2]
    return min(xs), min(ys), max(xs), max(ys)

for f in (1, 2):
    vec = json.load(open(f"data/vec-floor{f}.json", encoding="utf8"))
    anchors = {a["id"]: a for a in json.load(open(f"src/data/floor{f}.json", encoding="utf8"))["anchors"]}
    rooms, areas, icons = [], [], []
    for r in vec["regions"]:
        base = {"k": r["k"], "d": r["d"], "x": r["x"], "y": r["y"], "w": r["w"], "h": r["h"]}
        ids = r.get("ids") or []
        if ids:
            a = anchors[ids[0]]
            rect = r["a"] / (r["w"] * r["h"]) > 0.95
            lx, ly = (r["x"] + r["w"] / 2, r["y"] + r["h"] / 2) if rect else (a["x"], a["y"])
            if ids[0] in LABEL_OVERRIDE: lx, ly = LABEL_OVERRIDE[ids[0]]
            rooms.append({**base, "id": ids[0], "n": a.get("number", ids[0]), "lx": round(lx), "ly": round(ly)})
        else:
            k = r["k"]
            if k in ("wing-b", "wing-g") and r["a"] > 20000: k += "-corr"   # коридор крыла
            areas.append({**base, "k": k})
            if r["k"] == "wc":
                icons.append({"t": "wc", "x": round(r["x"] + r["w"] / 2), "y": round(r["y"] + r["h"] / 2), "s": min(r["w"], r["h"])})
    for sx, sy in STAIRS: icons.append({"t": "stairs", "x": sx, "y": sy})
    for t, x, y in ICONS[f]: icons.append({"t": t, "x": x, "y": y})
    x0, y0, x1, y1 = bbox_of(vec["footprint"])
    out = {
        "w": vec["w"], "h": vec["h"],
        "focus": {"x": x0 - 60, "y": y0 - 60, "w": x1 - x0 + 120, "h": y1 - y0 + 120},
        "footprint": vec["footprint"], "rooms": rooms, "areas": areas, "labels": LABELS[f], "icons": icons,
        "compass": {"x": 1373, "y": 2160},
    }
    json.dump(out, open(f"src/data/map{f}.json", "w", encoding="utf8"), ensure_ascii=False, separators=(",", ":"))
    print(f"этаж {f}: помещений {len(rooms)}, прочих областей {len(areas)}, подписей {len(out['labels'])}, иконок {len(icons)}, фокус {out['focus']}")
