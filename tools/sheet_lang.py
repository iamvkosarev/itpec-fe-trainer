#!/usr/bin/env python3
"""Keeps the English cheat sheet in step with the Russian one.

web/docs/cheatsheet.html is the Russian original; web/docs/cheatsheet.en.html
is the same sheet in the wording of the exam, loaded by the RU/EN switch
(js/docs.js). Both must carry the same blocks under the same
ids — topics.json, the «изучено» marks and the side menu are keyed by them —
the same widgets and the same question marks.

    python3 tools/sheet_lang.py check
        compare the two files; exit 1 and list every difference
    python3 tools/sheet_lang.py build HEADER.html SECTION.html…
        write cheatsheet.en.html from a translated header (comment, intro,
        toolbar) and the translated <section>s, in order, then check it
"""
import re
import sys
from collections import Counter
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "web" / "docs"
RU = DOCS / "cheatsheet.html"
EN = DOCS / "cheatsheet.en.html"


def skeleton(text):
    """What must match between the languages (comments aside)."""
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    return {
        "ids": Counter(re.findall(r'\sid="([^"]+)"', text)),
        "widgets": re.findall(r'data-widget="([^"]+)"', text),
        "marks": re.findall(r'<span class="src[^"]*">([^<]*)</span>', text),
        "ans": len(re.findall(r'class="[^"]*\bans\b[^"]*"', text)),
        "tags": Counter(re.findall(r"<(article|section|table|tr|li|svg|div class=\"g\")\b", text)),
    }


def check():
    ru, en = RU.read_text("utf-8"), EN.read_text("utf-8")
    a, b = skeleton(ru), skeleton(en)
    problems = [f"{key}: ru {a[key]!r} ≠ en {b[key]!r}"[:400] for key in a if a[key] != b[key]]
    for i, line in enumerate(en.splitlines(), 1):
        # The toolbar stays in the app's language; everything else is English.
        if re.search("[А-Яа-яЁё]", line) and "cs-toc" not in line and "data-" not in line:
            problems.append(f"cyrillic on line {i}: {line.strip()[:120]}")
    for p in problems:
        print(p)
    print("ok" if not problems else f"{len(problems)} problem(s)")
    return not problems


def build(header, sections):
    parts = [Path(header).read_text("utf-8").rstrip() + "\n"]
    parts += [Path(s).read_text("utf-8").strip() + "\n" for s in sections]
    EN.write_text("\n\n".join(parts), "utf-8")
    print(f"wrote {EN.relative_to(DOCS.parent.parent)}")
    return check()


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "check":
        sys.exit(0 if check() else 1)
    if len(sys.argv) >= 4 and sys.argv[1] == "build":
        sys.exit(0 if build(sys.argv[2], sys.argv[3:]) else 1)
    print(__doc__)
    sys.exit(2)
