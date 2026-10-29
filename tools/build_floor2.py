"""Собирает src/data/floor2.json и src/data/stairs.json.
Аудитории: OCR (data/ocr-floor2.json) + ручные поправки для искажённых и повёрнутых подписей.
Координаты — пиксели public/plans/floor2.jpg. Запуск: python3 -I tools/build_floor2.py"""
import json, re

ocr = json.load(open("data/ocr-floor2.json", encoding="utf8"))

raw = []
for it in ocr:
    nums = re.findall(r"\b\d{4}\b", it["text"])
    if not nums or re.search(r"[A-Za-zА-Яа-я]", it["text"]) or "-" in it["text"]:
        continue
    for i, n in enumerate(nums):
        raw.append((n, round(it["x"] + it["w"] * (i + 0.5) / len(nums)), round(it["y"] + it["h"] / 2)))

# OCR исказил или не прочитал: координаты сняты с сетки плана вручную
manual = [("2223", 882, 955), ("2217", 237, 1154), ("2216", 239, 1237), ("2220", 500, 1237),
          ("2221", 629, 1237), ("2222", 918, 1237), ("2107", 835, 1638)]
for n, x in zip(["2106", "2105", "2104", "2103", "2102", "2101"], [808, 852, 897, 941, 987, 1032]):
    manual.append((n, x, 1495))
for n, x in zip(["2134", "2135", "2136", "2137", "2138", "2139"], [1706, 1749, 1795, 1845, 1889, 1935]):
    manual.append((n, x, 1495))
raw = [r for r in raw if r[0] not in {m[0] for m in manual if m[0] in ("2103", "2137")}] + manual

dups = {}
for n, x, y in raw:
    dups.setdefault(n, []).append((x, y))

anchors = []
for n, pts in sorted(dups.items()):
    pts.sort(key=lambda p: p[0])
    for k, (x, y) in enumerate(pts):
        a = {"id": n if k == 0 else f"{n}-{k+1}", "floor": 2, "x": x, "y": y, "kind": "room", "number": n}
        if len(pts) > 1:
            a["duplicate"] = True
            a["where"] = "слева на плане" if k == 0 else "справа на плане"
        anchors.append(a)

for a in anchors:
    if a["number"] in ("2230", "2231"): a["name"] = "Офис программ бакалавриата"
    if a["number"] == "2232": a["name"] = "Центр карьер"
    if a["id"] == "2218": a["name"] = "Международный отдел"
    if a["number"] in [f"21{n:02d}" for n in (1, 2, 3, 4, 5, 6, 34, 35, 36, 37, 38, 39)]:
        a["via"] = "mc2"      # повёрнутые подписи под 2203/2249: дверь неочевидна
        a["approx"] = True

anchors.append({"id": "dean", "floor": 2, "x": 2160, "y": 1200, "kind": "poi", "via": "mc2",
                "name": "Деканат (Офис программ бакалавриата)"})
stairs = [("1", 290, 1322), ("2", 1015, 1322), ("3", 1723, 1322), ("4", 2465, 1322),
          ("5", 925, 2578), ("6", 1815, 2578)]
for sid, x, y in stairs:
    anchors.append({"id": f"s2-{sid}", "floor": 2, "x": x, "y": y, "kind": "stair", "name": "Лестница"})

corridors = [
    ("mc2",  [[190, 1322], [2555, 1322]]),            # главный коридор
    ("ln2",  [[1108, 790], [1108, 1597]]),            # западная полоса
    ("cn2",  [[1371, 790], [1371, 1322]]),            # центральный проход
    ("rn2",  [[1636, 790], [1636, 1597]]),            # восточная полоса
    ("ub2",  [[790, 1040], [1950, 1040]]),            # северная часть холла
    ("wt2",  [[928, 1597], [1108, 1597]]),            # верх западного крыла
    ("ww2",  [[928, 1597], [928, 2578]]),
    ("wb2",  [[800, 2578], [1270, 2578]]),
    ("et2",  [[1636, 1597], [1815, 1597]]),           # верх восточного крыла
    ("ew2",  [[1815, 1597], [1815, 2578]]),
    ("eb2",  [[1475, 2578], [1950, 2578]]),
]
json.dump({"corridors": [{"id": i, "floor": 2, "points": p} for i, p in corridors], "anchors": anchors},
          open("src/data/floor2.json", "w", encoding="utf8"), ensure_ascii=False, indent=1)
json.dump([{"id": f"stair-{sid}", "anchors": [f"s1-{sid}", f"s2-{sid}"], "cost": 200} for sid, _, _ in stairs],
          open("src/data/stairs.json", "w", encoding="utf8"), ensure_ascii=False, indent=1)
rooms = sorted(a["id"] for a in anchors if a["kind"] == "room")
print(len(rooms), "rooms")
print(rooms)
