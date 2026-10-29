// Топ цветов плана (с квантованием): swift tools/palette.swift public/plans/floor1.jpg
import AppKit
let img = NSImage(contentsOfFile: CommandLine.arguments[1])!
let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil)!
let w = cg.width, h = cg.height
var buf = [UInt8](repeating: 0, count: w * h * 4)
let ctx = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
var counts: [UInt32: Int] = [:]
var i = 0
while i < buf.count {
  let key = (UInt32(buf[i] >> 2) << 16) | (UInt32(buf[i+1] >> 2) << 8) | UInt32(buf[i+2] >> 2)
  counts[key, default: 0] += 1
  i += 4
}
for (k, v) in counts.sorted(by: { $0.value > $1.value }).prefix(22) {
  let r = Int((k >> 16) & 255) << 2, g = Int((k >> 8) & 255) << 2, b = Int(k & 255) << 2
  print(String(format: "#%02X%02X%02X", r, g, b), v)
}
