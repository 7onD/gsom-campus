// Векторизация плана этажа: помещения, контур здания и привязка номеров.
// Запуск: swift tools/vectorize.swift public/plans/floor1.jpg src/data/floor1.json out.json
// Вход: растровый план (плоские цвета) и разметка якорей (аудитории с координатами).
// Выход: JSON с контуром здания и областями (помещения по цветам) в координатах исходного изображения.
import AppKit
import Foundation

let args = CommandLine.arguments
guard args.count >= 4 else { print("usage: vectorize in.jpg anchors.json out.json"); exit(1) }
guard let nsimg = NSImage(contentsOfFile: args[1]),
      let cg = nsimg.cgImage(forProposedRect: nil, context: nil, hints: nil) else { print("cannot load"); exit(1) }
let W = cg.width, H = cg.height
var rgba = [UInt8](repeating: 0, count: W * H * 4)
do {
  let ctx = CGContext(data: &rgba, width: W, height: H, bitsPerComponent: 8, bytesPerRow: W * 4,
                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.draw(cg, in: CGRect(x: 0, y: 0, width: W, height: H))
}

// ---- классы пикселей
enum K: UInt8 { case bg = 0, corridor, room, blue, green, orange, red, teal, other = 255 }
let refs: [(K, Int, Int, Int)] = [(.blue, 45, 73, 160), (.green, 38, 98, 48), (.orange, 229, 133, 33), (.red, 189, 29, 45), (.teal, 9, 135, 153)]
func classify(_ r: Int, _ g: Int, _ b: Int) -> K {
  if r > 238 && g > 238 && b > 238 { return .bg }
  if abs(r - g) < 9 && abs(g - b) < 9 {
    let v = (r + g + b) / 3
    if v >= 194 && v <= 214 { return .corridor }
    if v >= 221 && v <= 238 { return .room }
    return .other
  }
  for (k, rr, gg, bb) in refs {
    let d = (r - rr) * (r - rr) + (g - gg) * (g - gg) + (b - bb) * (b - bb)
    if d < 45 * 45 { return k }
  }
  return .other
}
var cls = [UInt8](repeating: 255, count: W * H)
for i in 0..<(W * H) { cls[i] = classify(Int(rgba[i * 4]), Int(rgba[i * 4 + 1]), Int(rgba[i * 4 + 2])).rawValue }

// ---- компоненты связности
struct Comp { var id: Int; var k: UInt8; var area: Int; var x0: Int; var y0: Int; var x1: Int; var y1: Int }
func components(mask: (Int) -> Bool, eight: Bool, label: inout [Int32]) -> [Comp] {
  var comps: [Comp] = []
  var stack: [Int] = []
  stack.reserveCapacity(4096)
  for start in 0..<(W * H) where label[start] == 0 && mask(start) {
    let id = Int32(comps.count + 1)
    var c = Comp(id: Int(id), k: cls[start], area: 0, x0: W, y0: H, x1: 0, y1: 0)
    label[start] = id; stack.append(start)
    while let p = stack.popLast() {
      let x = p % W, y = p / W
      c.area += 1
      if x < c.x0 { c.x0 = x }; if x > c.x1 { c.x1 = x }; if y < c.y0 { c.y0 = y }; if y > c.y1 { c.y1 = y }
      for dy in -1...1 { for dx in -1...1 {
        if dx == 0 && dy == 0 { continue }
        if !eight && dx != 0 && dy != 0 { continue }
        let nx = x + dx, ny = y + dy
        if nx < 0 || ny < 0 || nx >= W || ny >= H { continue }
        let q = ny * W + nx
        if label[q] == 0 && mask(q) { label[q] = id; stack.append(q) }
      } }
    }
    comps.append(c)
  }
  return comps
}

// ---- контуры маски (границы пиксельной сетки), упрощение Дугласа-Пекера
struct Loop { var pts: [(Int, Int)]; var area: Double }
func traceLoops(inBox x0: Int, _ y0: Int, _ x1: Int, _ y1: Int, inside: (Int, Int) -> Bool) -> [Loop] {
  struct E { var sx: Int; var sy: Int; var ex: Int; var ey: Int; var dir: Int }
  var edges: [E] = []
  var out: [Int: [Int]] = [:]
  func key(_ x: Int, _ y: Int) -> Int { y * (W + 2) + x }
  func add(_ sx: Int, _ sy: Int, _ ex: Int, _ ey: Int, _ d: Int) {
    out[key(sx, sy), default: []].append(edges.count)
    edges.append(E(sx: sx, sy: sy, ex: ex, ey: ey, dir: d))
  }
  for y in y0...y1 { for x in x0...x1 where inside(x, y) {
    if !inside(x, y - 1) { add(x, y, x + 1, y, 0) }          // верх: на восток
    if !inside(x + 1, y) { add(x + 1, y, x + 1, y + 1, 1) }  // право: на юг
    if !inside(x, y + 1) { add(x + 1, y + 1, x, y + 1, 2) }  // низ: на запад
    if !inside(x - 1, y) { add(x, y + 1, x, y, 3) }          // лево: на север
  } }
  var used = [Bool](repeating: false, count: edges.count)
  var loops: [Loop] = []
  for s in 0..<edges.count where !used[s] {
    var cur = s
    var pts: [(Int, Int)] = []
    var prevDir = -1
    while !used[cur] {
      used[cur] = true
      let e = edges[cur]
      if e.dir != prevDir { pts.append((e.sx, e.sy)) }
      prevDir = e.dir
      let cands = (out[key(e.ex, e.ey)] ?? []).filter { !used[$0] }
      if cands.isEmpty { break }
      if cands.count == 1 { cur = cands[0] } else {
        // на развилке — правый поворот (интерьер справа): (dir+1)%4, затем прямо, затем левый
        let pref = [(e.dir + 1) % 4, e.dir, (e.dir + 3) % 4]
        cur = cands.min { a, b in (pref.firstIndex(of: edges[a].dir) ?? 9) < (pref.firstIndex(of: edges[b].dir) ?? 9) }!
      }
    }
    if pts.count >= 3 {
      var a = 0.0
      for i in 0..<pts.count { let p = pts[i], q = pts[(i + 1) % pts.count]; a += Double(p.0 * q.1 - q.0 * p.1) }
      loops.append(Loop(pts: pts, area: a / 2))
    }
  }
  return loops
}
func dp(_ p: [(Int, Int)], _ eps: Double) -> [(Int, Int)] {
  if p.count < 4 { return p }
  func seg(_ a: Int, _ b: Int, _ keep: inout [Bool]) {
    if b <= a + 1 { return }
    let (ax, ay) = p[a], (bx, by) = p[b]
    let dx = Double(bx - ax), dy = Double(by - ay)
    let len = max((dx * dx + dy * dy).squareRoot(), 1e-9)
    var best = 0.0, bi = -1
    for i in (a + 1)..<b {
      let d = abs(dy * Double(p[i].0 - ax) - dx * Double(p[i].1 - ay)) / len
      if d > best { best = d; bi = i }
    }
    if bi >= 0 && best > eps { keep[bi] = true; seg(a, bi, &keep); seg(bi, b, &keep) }
  }
  // замкнутый контур: делим по самой далёкой от первой точки
  var far = 1, fd = -1
  for i in 1..<p.count { let d = (p[i].0 - p[0].0) * (p[i].0 - p[0].0) + (p[i].1 - p[0].1) * (p[i].1 - p[0].1); if d > fd { fd = d; far = i } }
  var keep = [Bool](repeating: false, count: p.count)
  keep[0] = true; keep[far] = true
  let first = Array(p[0...far]), second = Array(p[far...]) + [p[0]]
  func sub(_ q: [(Int, Int)]) -> [(Int, Int)] {
    var k = [Bool](repeating: false, count: q.count); k[0] = true; k[q.count - 1] = true
    func s(_ a: Int, _ b: Int) {
      if b <= a + 1 { return }
      let (ax, ay) = q[a], (bx, by) = q[b]
      let dx = Double(bx - ax), dy = Double(by - ay)
      let len = max((dx * dx + dy * dy).squareRoot(), 1e-9)
      var best = 0.0, bi = -1
      for i in (a + 1)..<b {
        let d = abs(dy * Double(q[i].0 - ax) - dx * Double(q[i].1 - ay)) / len
        if d > best { best = d; bi = i }
      }
      if bi >= 0 && best > eps { k[bi] = true; s(a, bi); s(bi, b) }
    }
    s(0, q.count - 1)
    return q.enumerated().filter { k[$0.offset] }.map { $0.element }
  }
  let a = sub(first), b = sub(second)
  return Array(a.dropLast()) + Array(b.dropLast())
}
func pathString(_ loops: [Loop]) -> String {
  var s = ""
  for l in loops {
    let q = dp(l.pts, 1.1)
    if q.count < 3 { continue }
    s += "M\(q[0].0) \(q[0].1)"
    for i in 1..<q.count { s += "L\(q[i].0) \(q[i].1)" }
    s += "Z"
  }
  return s
}

// ---- контур здания: всё, что не фон, со «закрытием» тонких белых линий и текста
var nonbg = [Bool](repeating: false, count: W * H)
for i in 0..<(W * H) { nonbg[i] = cls[i] != K.bg.rawValue }
// расширение маски на r пикселей (квадратное окно) через префиксные суммы; erode(M) = !dilate(!M)
func dilate(_ src: [Bool], r: Int) -> [Bool] {
  var tmp = [Bool](repeating: false, count: W * H)
  var pref = [Int32](repeating: 0, count: max(W, H) + 1)
  for y in 0..<H {
    for x in 0..<W { pref[x + 1] = pref[x] + (src[y * W + x] ? 1 : 0) }
    for x in 0..<W { tmp[y * W + x] = pref[min(W, x + r + 1)] - pref[max(0, x - r)] > 0 }
  }
  var dst = [Bool](repeating: false, count: W * H)
  for x in 0..<W {
    for y in 0..<H { pref[y + 1] = pref[y] + (tmp[y * W + x] ? 1 : 0) }
    for y in 0..<H { dst[y * W + x] = pref[min(H, y + r + 1)] - pref[max(0, y - r)] > 0 }
  }
  return dst
}
// закрытие: расширить, затем сжать (заполняет тонкие белые линии и текст)
let dil = dilate(nonbg, r: 4)
let closed = dilate(dil.map { !$0 }, r: 4).map { !$0 }

// «открытие» серого цвета помещений: убираем линии тоньше ~4 px (размытые белые обводки ячеек крыльев)
do {
  let roomMask = cls.map { $0 == K.room.rawValue }
  let eroded = dilate(roomMask.map { !$0 }, r: 2).map { !$0 }
  let opened = dilate(eroded, r: 2)
  for i in 0..<(W * H) where roomMask[i] && !opened[i] { cls[i] = K.other.rawValue }
}

var footLabel = [Int32](repeating: 0, count: W * H)
let footComps = components(mask: { closed[$0] }, eight: true, label: &footLabel).filter { $0.area > 30000 }
var footLoops: [Loop] = []
for c in footComps {
  let loops = traceLoops(inBox: c.x0, c.y0, c.x1, c.y1) { x, y in
    x >= 0 && y >= 0 && x < W && y < H && footLabel[y * W + x] == Int32(c.id)
  }
  for l in loops {
    if l.area > 0 { footLoops.append(l) }                       // внешний контур
    else {                                                       // дыра: оставляем настоящие пустоты
      var minx = W, maxx = 0, miny = H, maxy = 0
      for p in l.pts { minx = min(minx, p.0); maxx = max(maxx, p.0); miny = min(miny, p.1); maxy = max(maxy, p.1) }
      let bw = maxx - minx, bh = maxy - miny
      if min(bw, bh) >= 20 && abs(l.area) / Double(max(bw * bh, 1)) > 0.4 { footLoops.append(l) }
    }
  }
}

// ---- области помещений по цветам
// цветные области сжимаем на 1 px: тонкие белые обводки ячеек крыльев иногда «рвутся» из-за JPEG
var regMask = cls.map { $0 != K.bg.rawValue && $0 != K.other.rawValue && $0 != K.corridor.rawValue }
let shrunk = dilate(regMask.map { !$0 }, r: 1).map { !$0 }
for i in 0..<(W * H) where regMask[i] && cls[i] != K.room.rawValue && !shrunk[i] { regMask[i] = false }
var regLabel = [Int32](repeating: 0, count: W * H)
let regComps = components(mask: { regMask[$0] }, eight: false, label: &regLabel)
    .filter { $0.area >= 900 && min($0.x1 - $0.x0, $0.y1 - $0.y0) >= 14 }

// якоря
struct Anchor: Decodable { let id: String; let x: Double; let y: Double; let kind: String }
struct AnchorFile: Decodable { let anchors: [Anchor] }
let anchors = try! JSONDecoder().decode(AnchorFile.self, from: Data(contentsOf: URL(fileURLWithPath: args[2]))).anchors
let validComp = Set(regComps.map { Int32($0.id) })
func compAt(_ x: Int, _ y: Int) -> Int {
  // якорь стоит на тексте: ищем ближайший пиксель области по расширяющимся кольцам
  for r in 0...48 {
    var best: (Int, Int32)? = nil   // (квадрат расстояния, метка)
    for dy in -r...r { for dx in -r...r {
      if max(abs(dx), abs(dy)) != r { continue }
      let nx = x + dx, ny = y + dy
      if nx < 0 || ny < 0 || nx >= W || ny >= H { continue }
      let l = regLabel[ny * W + nx]
      if l > 0 && validComp.contains(l) { let d = dx * dx + dy * dy; if best == nil || d < best!.0 { best = (d, l) } }
    } }
    if let b = best { return Int(b.1) }
  }
  return 0
}
var idsByComp: [Int: [String]] = [:]
for a in anchors where a.kind == "room" {
  let c = compAt(Int(a.x), Int(a.y))
  if c > 0 { idsByComp[c, default: []].append(a.id) }
}
let names: [UInt8: String] = [K.room.rawValue: "room", K.blue.rawValue: "wing-b", K.green.rawValue: "wing-g", K.orange.rawValue: "office", K.red.rawValue: "ring", K.teal.rawValue: "wc"]

var regionsJSON: [[String: Any]] = []
for c in regComps {
  let loops = traceLoops(inBox: c.x0, c.y0, c.x1, c.y1) { x, y in
    x >= 0 && y >= 0 && x < W && y < H && regLabel[y * W + x] == Int32(c.id)
  }
  let keepHoles = c.k == K.red.rawValue
  let use = loops.filter { $0.area > 0 || (keepHoles && abs($0.area) > 2500) }
  let d = pathString(use)
  if d.isEmpty { continue }
  var r: [String: Any] = ["k": names[c.k] ?? "other", "d": d, "x": c.x0, "y": c.y0, "w": c.x1 - c.x0 + 1, "h": c.y1 - c.y0 + 1, "a": c.area]
  if let ids = idsByComp[c.id] { r["ids"] = ids }
  regionsJSON.append(r)
}
let result: [String: Any] = ["w": W, "h": H, "footprint": pathString(footLoops), "regions": regionsJSON]
let data = try! JSONSerialization.data(withJSONObject: result, options: [])
try! data.write(to: URL(fileURLWithPath: args[3]))
print("регионов:", regionsJSON.count, "контуров здания:", footLoops.count, "размер:", data.count / 1024, "КБ")
