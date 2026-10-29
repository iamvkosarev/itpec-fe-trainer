// On-device helpers from macOS frameworks for tools/topics.py: text
// recognition on the question images (Vision) and English sentence vectors
// (NaturalLanguage). Nothing leaves the machine and nothing needs installing.
//
//   swiftc -O tools/apple_nlp.swift -o tools/.bin/apple_nlp
//   apple_nlp ocr   <list.json> <out.json>   list: {"id": "path/to/q.webp", …} → {"id": "text", …}
//   apple_nlp embed <texts.json> <out.json>  texts: {"key": "text", …}       → {"key": [Float], …}
//
// OCR is incremental: ids already in <out.json> are kept and skipped, so a
// rebuilt bank only reads the new images.

import AppKit
import Foundation
import NaturalLanguage
import Vision

func readJSON(_ path: String) -> [String: Any] {
    guard let data = FileManager.default.contents(atPath: path),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
    return obj
}

func writeJSON(_ obj: Any, _ path: String) {
    let data = try! JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])
    FileManager.default.createFile(atPath: path, contents: data)
}

func recognize(_ path: String) -> String? {
    guard let image = NSImage(contentsOfFile: path),
          let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    // Exam terms (RAID, CIDR, CPI) are not dictionary words: correction would "fix" them.
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["en-US"]
    try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
    return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

let args = CommandLine.arguments
guard args.count == 4 else {
    FileHandle.standardError.write("usage: apple_nlp ocr|embed <in.json> <out.json>\n".data(using: .utf8)!)
    exit(2)
}

switch args[1] {
case "ocr":
    let list = readJSON(args[2]) as? [String: String] ?? [:]
    var out = readJSON(args[3]) as? [String: String] ?? [:]
    let todo = list.keys.sorted().filter { out[$0] == nil }
    for (i, id) in todo.enumerated() {
        if let text = recognize(list[id]!) { out[id] = text }
        if i % 100 == 99 {
            writeJSON(out, args[3])
            print("ocr \(i + 1)/\(todo.count)")
        }
    }
    writeJSON(out, args[3])
    print("ocr done: \(todo.count) new, \(out.count) total")
case "embed":
    guard let model = NLEmbedding.sentenceEmbedding(for: .english) else {
        FileHandle.standardError.write("no English sentence embedding on this system\n".data(using: .utf8)!)
        exit(1)
    }
    let texts = readJSON(args[2]) as? [String: String] ?? [:]
    var out: [String: [Double]] = [:]
    for (key, text) in texts {
        if let vector = model.vector(for: text) { out[key] = vector }
    }
    writeJSON(out, args[3])
    print("embed: \(out.count) of \(texts.count), \(model.dimension) dims")
default:
    exit(2)
}
