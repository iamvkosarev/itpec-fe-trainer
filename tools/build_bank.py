#!/usr/bin/env python3
"""Turns the downloaded ITPEC PDFs into the JSON + image bank the web app reads.

Every question is rendered as a cropped grayscale WebP straight from the PDF.
That is deliberate: a large share of FE questions carry tables, state-transition
diagrams and fraction-typeset answer options that no text extractor reproduces
faithfully. The extracted text is kept alongside for search, categorisation and
the "look it up" button, but the image is what the user actually reads.
"""
import io
import json
import os
import re
import sys

import fitz
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from categories import classify

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
RAW_DIR = os.path.join(ROOT, "raw")
DATA_DIR = os.path.join(ROOT, "web", "data")
IMG_DIR = os.path.join(DATA_DIR, "img")

ZOOM = 2.0
PAD = 8.0
X_MIN, X_MAX = 46.0, 566.0

# The trailing period is optional: at least one paper ships a "Q46 Which..."
# heading with the period missing.
Q_START = re.compile(r"^Q\s?(\d{1,2})\s*\.?(?=\s|$)")
FOOTER = re.compile(r"^(?:[–\-—]\s*\d+\s*[–\-—]|\d+\s*/\s*\d+|-\s*\d+\s*-)$")
OPTION = re.compile(r"^([a-k])\s*\)")
ANSWER_ROW = re.compile(r"(\d{1,2})\s+([a-k])(?![a-z])")


def session_label(code):
    """`2025A` -> ('2025', 'October'); `2025S` -> ('2025', 'April')."""
    year, half = code[:4], code[4:5]
    return year, ("October" if half == "A" else "April")


def find_pdfs(exam_dir):
    """Returns {'A': (questions, answers), 'B': (...)} for one exam folder."""
    found = {}
    for dirpath, _dirs, files in os.walk(exam_dir):
        for name in files:
            if not name.lower().endswith(".pdf"):
                continue
            path = os.path.join(dirpath, name)
            upper = name.upper()
            # Old papers are _AM_/_PM_, papers from April 2024 on are -A_/-B_.
            if "_AM" in upper or "-A_" in upper:
                part = "A"
            elif "_PM" in upper or "-B_" in upper:
                part = "B"
            else:
                continue
            kind = "answers" if "ANSWER" in upper else "questions"
            found.setdefault(part, {})[kind] = path
    return found


def page_items(page):
    """All text lines plus drawing/image boxes on a page, for bbox maths."""
    lines = []
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block["lines"]:
            text = "".join(s["text"] for s in line["spans"]).strip()
            if text:
                lines.append({"bbox": tuple(line["bbox"]), "text": text})
    boxes = [tuple(d["rect"]) for d in page.get_drawings()]
    for info in page.get_images(full=True):
        try:
            boxes.extend(tuple(r) for r in page.get_image_rects(info[0]))
        except Exception:
            pass
    return lines, boxes


def footer_top(lines, page_height):
    """Y of the page-number footer, so crops stop above it."""
    cands = [l["bbox"][1] for l in lines
             if FOOTER.match(l["text"]) and l["bbox"][1] > page_height * 0.85]
    return min(cands) if cands else page_height - 40.0


def collect_pages(doc):
    return [page_items(doc[i]) for i in range(doc.page_count)]


def question_starts(pages):
    """Locates every `Qn.` heading, in document order."""
    starts = []
    for pno, (lines, _boxes) in enumerate(pages):
        for line in lines:
            m = Q_START.match(line["text"])
            # The heading always sits at the far left of the text column.
            # The margin varies between papers (65pt to 93pt), so the cut-off
            # is loose; the ascending-run filter below removes false hits.
            if m and line["bbox"][0] < 100.0:
                starts.append({"no": int(m.group(1)), "page": pno, "y": line["bbox"][1]})
    # Keep only the strictly ascending run starting at Q1 (drops sample
    # questions in the front matter and stray repeats).
    clean, expected = [], 1
    for s in starts:
        if s["no"] == expected:
            clean.append(s)
            expected += 1
    return clean


def span_segments(start, nxt, pages, page_height):
    """Per-page (page_no, y_top, y_bottom) rectangles covering one question."""
    last_page = nxt["page"] if nxt else len(pages) - 1
    # No single question runs past a handful of pages; anything longer means
    # a heading was missed and the span would swallow the rest of the paper.
    last_page = min(last_page, start["page"] + 3)
    segments = []
    for pno in range(start["page"], last_page + 1):
        lines, _boxes = pages[pno]
        foot = footer_top(lines, page_height)
        top = start["y"] - PAD if pno == start["page"] else 55.0
        if nxt and pno == nxt["page"]:
            bottom = nxt["y"] - PAD
        else:
            bottom = foot - 4.0
        if bottom - top > 12.0:
            segments.append((pno, top, bottom))
    return segments


def tighten(segment, pages, page_height):
    """Shrinks a segment to the ink actually inside it."""
    pno, top, bottom = segment
    lines, boxes = pages[pno]
    tops, bottoms, lefts, rights = [], [], [], []
    for item in [l["bbox"] for l in lines] + boxes:
        x0, y0, x1, y1 = item
        if y1 < top or y0 > bottom:
            continue
        if y1 - y0 > page_height * 0.9:  # page-wide background rectangle
            continue
        tops.append(max(y0, top))
        bottoms.append(min(y1, bottom))
        lefts.append(x0)
        rights.append(x1)
    if not tops:
        return None
    return (
        pno,
        max(top, min(tops) - PAD),
        min(bottom, max(bottoms) + PAD),
        max(X_MIN, min(min(lefts) - PAD, X_MIN + 20.0)),
        min(X_MAX, max(max(rights) + PAD, X_MAX - 20.0)),
    )


def render(doc, segments, out_path):
    """Renders segments as one stacked grayscale WebP."""
    tiles = []
    for pno, top, bottom, left, right in segments:
        pm = doc[pno].get_pixmap(
            matrix=fitz.Matrix(ZOOM, ZOOM),
            clip=fitz.Rect(left, top, right, bottom),
            colorspace=fitz.csGRAY,
        )
        tiles.append(Image.frombytes("L", (pm.width, pm.height), pm.samples))
    if not tiles:
        return None
    if len(tiles) == 1:
        canvas = tiles[0]
    else:
        width = max(t.width for t in tiles)
        gap = 14
        canvas = Image.new("L", (width, sum(t.height for t in tiles) + gap * (len(tiles) - 1)), 255)
        y = 0
        for t in tiles:
            canvas.paste(t, (0, y))
            y += t.height + gap
    if canvas.height > 16000:
        canvas = canvas.crop((0, 0, canvas.width, 16000))
    buf = io.BytesIO()
    canvas.save(buf, "WEBP", lossless=True, method=6)
    with open(out_path, "wb") as fh:
        fh.write(buf.getvalue())
    return canvas.width, canvas.height


def span_text(segments, pages):
    out = []
    for pno, top, bottom, _l, _r in segments:
        lines, _boxes = pages[pno]
        rows = [l for l in lines
                if l["bbox"][3] >= top and l["bbox"][1] <= bottom and not FOOTER.match(l["text"])]
        rows.sort(key=lambda l: (round(l["bbox"][1] / 4.0), l["bbox"][0]))
        merged, prev_y = [], None
        for l in rows:
            y = round(l["bbox"][1] / 4.0)
            if prev_y is not None and y == prev_y:
                merged[-1] += "   " + l["text"]
            else:
                merged.append(l["text"])
            prev_y = y
        out.extend(merged)
    return "\n".join(out).strip()


def option_letters(text, answer):
    """Highest option letter offered, from the `a)`..`k)` markers present."""
    seen = set()
    for line in text.split("\n"):
        for chunk in re.split(r"\s{2,}", line):
            m = OPTION.match(chunk.strip())
            if m:
                seen.add(m.group(1))
    top = "d"
    for letter in "abcdefghijk":
        if letter in seen:
            top = letter
    if answer and answer > top:
        top = answer
    if top < "d":
        top = "d"
    return [c for c in "abcdefghijk" if c <= top]


def parse_answers(path, expected):
    """Reads the answer-key PDF into {question_no: letter}."""
    doc = fitz.open(path)
    text = "\n".join(doc[i].get_text() for i in range(doc.page_count))
    doc.close()
    keys = {}
    # The key is a 2- or 4-column "No / Correct Answer" table; flattening it and
    # scanning for "<number> <letter>" pairs handles every layout used so far.
    flat = re.sub(r"[ \t]+", " ", text)
    for m in ANSWER_ROW.finditer(flat):
        no, letter = int(m.group(1)), m.group(2)
        if 1 <= no <= expected and no not in keys:
            keys[no] = letter
    return keys


def build_part(exam_code, part, paths, manifest):
    q_path, a_path = paths.get("questions"), paths.get("answers")
    if not q_path or not a_path:
        print("    %s: missing PDF, skipped" % part)
        return
    doc = fitz.open(q_path)
    page_height = doc[0].rect.height
    pages = collect_pages(doc)
    starts = question_starts(pages)
    if not starts:
        print("    %s: no questions found, skipped" % part)
        doc.close()
        return

    keys = parse_answers(a_path, len(starts))
    year, session = session_label(exam_code)
    exam_id = "%s-%s" % (exam_code, part)
    img_dir = os.path.join(IMG_DIR, exam_id)
    os.makedirs(img_dir, exist_ok=True)

    questions, missing = [], 0
    for idx, start in enumerate(starts):
        nxt = starts[idx + 1] if idx + 1 < len(starts) else None
        segments = span_segments(start, nxt, pages, page_height)
        segments = [s for s in (tighten(s, pages, page_height) for s in segments) if s]
        if not segments:
            missing += 1
            continue
        answer = keys.get(start["no"])
        if not answer:
            missing += 1
            continue
        rel_img = "img/%s/q%02d.webp" % (exam_id, start["no"])
        size = render(doc, segments, os.path.join(DATA_DIR, rel_img))
        text = span_text(segments, pages)
        field, category = classify(text, start["no"], len(starts), part)
        questions.append({
            "id": "%s-%02d" % (exam_id, start["no"]),
            "no": start["no"],
            "img": rel_img,
            "w": size[0] if size else 0,
            "h": size[1] if size else 0,
            "answer": answer,
            "options": option_letters(text, answer),
            "field": field,
            "category": category,
            "text": text,
        })
    doc.close()

    with open(os.path.join(DATA_DIR, "%s.json" % exam_id), "w") as fh:
        json.dump({
            "examId": exam_id, "code": exam_code, "part": part,
            "year": year, "session": session, "questions": questions,
        }, fh, ensure_ascii=False, separators=(",", ":"))

    expected = {"A": 60 if int(exam_code[:4]) >= 2024 else 80, "B": 20}[part]
    if len(questions) != expected:
        print("    !! %s: expected %d questions, got %d"
              % (exam_id, expected, len(questions)))

    manifest.append({
        "examId": exam_id, "code": exam_code, "part": part,
        "year": year, "session": session, "count": len(questions),
    })
    print("    %s: %d questions%s" % (part, len(questions),
                                      " (%d skipped)" % missing if missing else ""))


def main():
    os.makedirs(IMG_DIR, exist_ok=True)
    manifest = []
    exam_dirs = sorted(d for d in os.listdir(RAW_DIR)
                       if os.path.isdir(os.path.join(RAW_DIR, d)))
    for name in exam_dirs:
        code = name.replace("_FE", "")
        if not re.match(r"^20\d\d[SA]$", code):
            continue
        print("  %s" % code)
        found = find_pdfs(os.path.join(RAW_DIR, name))
        for part in ("A", "B"):
            if part not in found:
                continue
            # The pre-2024 afternoon paper (PM) uses a retired long-form format
            # that no longer matches Subject B, so it is not part of the bank.
            if part == "B" and int(code[:4]) < 2024:
                continue
            build_part(code, part, found[part], manifest)

    manifest.sort(key=lambda e: (e["code"], e["part"]))
    with open(os.path.join(DATA_DIR, "index.json"), "w") as fh:
        json.dump({"exams": manifest}, fh, ensure_ascii=False, indent=1)
    total = sum(e["count"] for e in manifest)
    print("\n%d exams, %d questions -> %s" % (len(manifest), total, DATA_DIR))


if __name__ == "__main__":
    main()
