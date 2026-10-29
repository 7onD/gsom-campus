// Распознавание подписей на плане через macOS Vision.
// Запуск: swift tools/ocr.swift public/plans/floor1.jpg > data/ocr-floor1.json
import Foundation
import Vision
import AppKit

let path = CommandLine.arguments[1]
guard let image = NSImage(contentsOfFile: path),
      let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  FileHandle.standardError.write("cannot load image\n".data(using: .utf8)!); exit(1)
}
let W = Double(cg.width), H = Double(cg.height)
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["ru-RU", "en-US"]
request.minimumTextHeight = 0.004
try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])

var out: [[String: Any]] = []
for obs in request.results ?? [] {
  guard let cand = obs.topCandidates(1).first else { continue }
  let b = obs.boundingBox
  out.append(["text": cand.string, "conf": cand.confidence,
              "x": b.minX * W, "y": (1 - b.maxY) * H, "w": b.width * W, "h": b.height * H])
}
let data = try JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted])
print(String(data: data, encoding: .utf8)!)
