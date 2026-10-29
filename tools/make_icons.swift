// Иконки приложения: swift tools/make_icons.swift (пишет в public/)
import AppKit

func render(_ size: Int, rounded: Bool, to path: String) {
  let s = CGFloat(size)
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4,
                             hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let rect = NSRect(x: 0, y: 0, width: s, height: s)
  let brand = NSColor(calibratedRed: 0x8c / 255, green: 0x1c / 255, blue: 0x3c / 255, alpha: 1)
  brand.setFill()
  if rounded { NSBezierPath(roundedRect: rect, xRadius: s * 0.22, yRadius: s * 0.22).fill() } else { rect.fill() }
  // метка 64×64 из favicon.svg, y вниз -> переворачиваем
  func P(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: x / 64 * s, y: (64 - y) / 64 * s) }
  let pin = NSBezierPath()
  pin.move(to: P(32, 11))
  pin.curve(to: P(15.5, 26.8), controlPoint1: P(23, 11), controlPoint2: P(15.5, 18))
  pin.curve(to: P(32, 54), controlPoint1: P(15.5, 38.8), controlPoint2: P(32, 54))
  pin.curve(to: P(48.5, 26.8), controlPoint1: P(32, 54), controlPoint2: P(48.5, 38.8))
  pin.curve(to: P(32, 11), controlPoint1: P(48.5, 18), controlPoint2: P(41, 11))
  pin.close()
  NSColor.white.setFill(); pin.fill()
  brand.setFill()
  let r = 6.5 / 64 * s
  NSBezierPath(ovalIn: NSRect(x: P(32, 27).x - r, y: P(32, 27).y - r, width: 2 * r, height: 2 * r)).fill()
  NSGraphicsContext.restoreGraphicsState()
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
}
render(512, rounded: false, to: "public/icon-512.png")
render(192, rounded: false, to: "public/icon-192.png")
render(180, rounded: false, to: "public/apple-touch-icon.png")
