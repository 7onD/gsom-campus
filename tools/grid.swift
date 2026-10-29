// Вырезка плана с координатной сеткой для ручной разметки.
// Запуск: swift tools/grid.swift in.jpg out.png x y w h step [overlay.json]
// overlay.json (необязательно): {"lines":[[x1,y1,x2,y2],...],"points":[[x,y,"label"],...]}
import Foundation
import AppKit

let a = CommandLine.arguments
let img = NSImage(contentsOfFile: a[1])!
let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil)!
let x0 = Double(a[3])!, y0 = Double(a[4])!, w = Double(a[5])!, h = Double(a[6])!, step = Double(a[7])!
let S = 1.0
let ctx = CGContext(data: nil, width: Int(w * S), height: Int(h * S), bitsPerComponent: 8, bytesPerRow: 0,
                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
// CG: origin bottom-left
ctx.draw(cg, in: CGRect(x: -x0 * S, y: -(Double(cg.height) - y0 - h) * S, width: Double(cg.width) * S, height: Double(cg.height) * S))
func Y(_ y: Double) -> Double { (h - (y - y0)) * S }
func X(_ x: Double) -> Double { (x - x0) * S }
let font = NSFont.systemFont(ofSize: 15, weight: .bold)
func label(_ s: String, _ x: Double, _ y: Double, _ color: NSColor) {
  let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .backgroundColor: NSColor.white.withAlphaComponent(0.8)]
  let gc = NSGraphicsContext(cgContext: ctx, flipped: false)
  NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = gc
  (s as NSString).draw(at: NSPoint(x: x, y: y), withAttributes: attrs)
  NSGraphicsContext.restoreGraphicsState()
}
ctx.setLineWidth(1)
var gx = (x0 / step).rounded(.up) * step
while gx <= x0 + w {
  ctx.setStrokeColor(NSColor(calibratedRed: 0, green: 0.4, blue: 1, alpha: gx.truncatingRemainder(dividingBy: step * 5) == 0 ? 0.7 : 0.35).cgColor)
  ctx.move(to: CGPoint(x: X(gx), y: 0)); ctx.addLine(to: CGPoint(x: X(gx), y: h * S)); ctx.strokePath()
  label(String(Int(gx)), X(gx) + 2, h * S - 18, .blue); gx += step
}
var gy = (y0 / step).rounded(.up) * step
while gy <= y0 + h {
  ctx.setStrokeColor(NSColor(calibratedRed: 0, green: 0.4, blue: 1, alpha: gy.truncatingRemainder(dividingBy: step * 5) == 0 ? 0.7 : 0.35).cgColor)
  ctx.move(to: CGPoint(x: 0, y: Y(gy))); ctx.addLine(to: CGPoint(x: w * S, y: Y(gy))); ctx.strokePath()
  label(String(Int(gy)), 2, Y(gy) + 2, .blue); gy += step
}
if a.count > 8, let data = FileManager.default.contents(atPath: a[8]),
   let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
  ctx.setStrokeColor(NSColor.red.cgColor); ctx.setLineWidth(3)
  for l in (o["lines"] as? [[Double]]) ?? [] {
    ctx.move(to: CGPoint(x: X(l[0]), y: Y(l[1]))); ctx.addLine(to: CGPoint(x: X(l[2]), y: Y(l[3]))); ctx.strokePath()
  }
  for p in (o["points"] as? [[Any]]) ?? [] {
    let px = (p[0] as! NSNumber).doubleValue, py = (p[1] as! NSNumber).doubleValue
    ctx.setFillColor(NSColor.magenta.cgColor); ctx.fillEllipse(in: CGRect(x: X(px) - 5, y: Y(py) - 5, width: 10, height: 10))
    if p.count > 2 { label(p[2] as! String, X(px) + 6, Y(py) + 4, .magenta) }
  }
}
let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: a[2]))
