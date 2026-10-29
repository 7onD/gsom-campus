"""Оверлей для проверки разметки: коридоры + связи якорей с ближайшим коридором.
python3 -I tools/overlay.py src/data/floor1.json out.json"""
import json, sys, math
d = json.load(open(sys.argv[1], encoding="utf8"))
segs = []
for c in d["corridors"]:
    p = c["points"]
    for a, b in zip(p, p[1:]): segs.append((c["id"], a, b))
def proj(pt, a, b):
    ax, ay = a; bx, by = b; dx, dy = bx-ax, by-ay
    t = max(0, min(1, ((pt[0]-ax)*dx + (pt[1]-ay)*dy) / (dx*dx+dy*dy)))
    return (ax+t*dx, ay+t*dy)
lines = [[a[0], a[1], b[0], b[1]] for _, a, b in segs]
pts = []
for a in d["anchors"]:
    best = None
    for cid, s, e in segs:
        if a.get("via") and a["via"] != cid: continue
        q = proj((a["x"], a["y"]), s, e); dist = math.hypot(q[0]-a["x"], q[1]-a["y"])
        if not best or dist < best[0]: best = (dist, q, cid)
    lines.append([a["x"], a["y"], best[1][0], best[1][1]])
    pts.append([a["x"], a["y"], a["id"]])
json.dump({"lines": lines, "points": pts}, open(sys.argv[2], "w"))
