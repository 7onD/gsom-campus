// Склейка трёх экранов в одну панораму: swift tools/montage.swift out.png in1.png in2.png in3.png
import AppKit
let a = CommandLine.arguments
let imgs = a[2...].compactMap { NSImage(contentsOfFile: $0) }
let h = 1400.0, gap = 40.0
let widths = imgs.map { $0.size.width * h / $0.size.height }
let total = widths.reduce(0, +) + gap * Double(imgs.count + 1)
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(total), pixelsHigh: Int(h + gap * 2), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSColor(calibratedWhite: 0.5, alpha: 1).setFill(); NSRect(x: 0, y: 0, width: total, height: h + gap * 2).fill()
var x = gap
for (i, img) in imgs.enumerated() {
  img.draw(in: NSRect(x: x, y: gap, width: widths[i], height: h), from: .zero, operation: .sourceOver, fraction: 1)
  x += widths[i] + gap
}
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: a[1]))
