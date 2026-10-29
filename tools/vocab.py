"""The dictionary of words picked out of question texts (the «Слова» screen).

The app writes vocab/words.json through start.sh: every word or phrase once,
with the sentences and question IDs it was picked from. Translations live
apart in vocab/translations.json, so translating never races with the app
adding new words:

    { "<word key>": { "ru": "критический путь",
                      "alts": ["три", "неверных", "варианта"],
                      "note": "необязательное пояснение",
                      "en_alts": ["three", "English", "look-alikes"],
                      "cloze": [{"ru": "Задержка на **критическом пути** сдвигает проект.",
                                 "en": "A delay on the **critical path** delays the project.",
                                 "accept": ["critical path"]}, ...] } }

`alts` are wrong Russian options (English → Russian choice), `en_alts` wrong
English ones (Russian → English choice), `cloze` 2–3 example sentences for
typing the word: the Russian one with the word in **…**, its English version
with the English word in **…**, and the English forms that count as right.
An entry with only `cloze` / `en_alts` adds them to a word already translated.

    python3 tools/vocab.py pending          # words without a translation, with context
    python3 tools/vocab.py pending --all    # every word
    python3 tools/vocab.py pending --cloze  # translated words still without sentences
    python3 tools/vocab.py apply file.json  # check and merge translations
    python3 tools/vocab.py stats

`pending` prints, for each word, the sentences it came from, the question's
category and — where the question has a Russian explanation — its translated
stem and the glossary entries that mention the word: everything needed to
translate it the way it is meant in the exam.
"""

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# ITPEC_VOCAB_DIR points a test server's separate word list here instead.
VOCAB = Path(os.environ.get("ITPEC_VOCAB_DIR") or ROOT / "vocab")
WORDS = VOCAB / "words.json"
TRANSLATIONS = VOCAB / "translations.json"
DATA = ROOT / "web" / "data"


def read(path, fallback):
    try:
        return json.loads(path.read_text("utf-8"))
    except FileNotFoundError:
        return fallback


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True) + "\n", "utf-8")
    os.replace(tmp, path)


def exam_of(qid):
    """"2025A-A-41" -> "2025A-A"."""
    return qid.rsplit("-", 1)[0]


class Lookup:
    """Questions and their Russian explanations, loaded per exam on demand."""

    def __init__(self):
        self.banks = {}
        self.explains = {}

    def question(self, qid):
        exam = exam_of(qid)
        if exam not in self.banks:
            data = read(DATA / f"{exam}.json", {"questions": []})
            self.banks[exam] = {q["id"]: q for q in data["questions"]}
        return self.banks[exam].get(qid)

    def explain(self, qid):
        exam = exam_of(qid)
        if exam not in self.explains:
            self.explains[exam] = read(DATA / "explain" / f"{exam}.json", {})
        return self.explains[exam].get(qid)


def pending_cloze():
    """Translated words still missing example sentences or English decoys."""
    words = read(WORDS, {"words": []})["words"]
    done = read(TRANSLATIONS, {})
    todo = [w for w in words if w["key"] in done
            and not (done[w["key"]].get("cloze") and done[w["key"]].get("en_alts"))]
    for word in todo:
        t = done[word["key"]]
        ctx = word["contexts"][0] if word["contexts"] else {"qid": "", "text": ""}
        print(f"## {word['key']}  [{word['phrase']}] — {t['ru']}")
        print(f"- {ctx['qid']}: {ctx['text'][:200]}")
    print(f"Всего без предложений: {len(todo)}")


def pending(show_all):
    words = read(WORDS, {"words": []})["words"]
    done = read(TRANSLATIONS, {})
    todo = [w for w in words if show_all or w["key"] not in done]
    if not todo:
        print("Нет слов без перевода." if words else "Словарь пуст.")
        return
    look = Lookup()
    for word in todo:
        print(f"## {word['key']}" + (f"   [есть: {done[word['key']]['ru']}]" if word["key"] in done else ""))
        for ctx in word["contexts"]:
            # Picked outside a question: the id is the screen, "@docs/cheatsheet".
            if ctx["qid"].startswith("@"):
                print(f"- {ctx['qid']} (не из вопроса): {ctx['text']}")
                continue
            q = look.question(ctx["qid"]) or {}
            print(f"- {ctx['qid']} · {q.get('category', '?')}: {ctx['text']}")
            entry = look.explain(ctx["qid"])
            if not entry:
                continue
            print(f"  RU: {' '.join(entry.get('question', '').split())[:260]}")
            for term in entry.get("terms", []):
                name = f"{term.get('term', '')} {term.get('full', '')}".lower()
                if word["key"] in name or term.get("term", "").lower() in word["key"]:
                    print(f"  термин: {term.get('term')} — {term.get('ru')}")
        print()
    print(f"Всего: {len(todo)}")


def check_extras(entry, ru=None, phrase=None):
    """Optional en_alts and cloze; None when fine."""
    if "en_alts" in entry:
        alts = entry["en_alts"]
        if not isinstance(alts, list) or len(alts) != 3 or not all(isinstance(a, str) and a.strip() for a in alts):
            return "en_alts must be three non-empty strings"
        lowered = [a.strip().lower() for a in alts]
        if len(set(lowered)) != 3 or (phrase and phrase.strip().lower() in lowered):
            return "en_alts must differ from the word and from each other"
    if "cloze" in entry:
        items = entry["cloze"]
        if not isinstance(items, list) or not items:
            return "cloze must be a non-empty list"
        for item in items:
            if not isinstance(item, dict):
                return "cloze items must be objects"
            for side in ("ru", "en"):
                text = item.get(side)
                if not isinstance(text, str) or text.count("**") != 2 or "****" in text:
                    return f"cloze {side} must mark exactly one part with **…**"
            accept = item.get("accept")
            if not isinstance(accept, list) or not accept or not all(isinstance(a, str) and a.strip() for a in accept):
                return "cloze accept must be a non-empty list of strings"
    return None


def check(key, entry, existing=None, phrase=None):
    if not isinstance(entry, dict):
        return "not an object"
    if "ru" not in entry:
        # Sentences or decoys for a word that already has its translation.
        if not existing:
            return "no ru and the word has no translation yet"
        if not ("cloze" in entry or "en_alts" in entry):
            return "nothing to add"
        return check_extras(entry, existing.get("ru"), phrase)
    ru = entry.get("ru")
    if not isinstance(ru, str) or not ru.strip():
        return "ru is empty"
    alts = entry.get("alts")
    if not isinstance(alts, list) or len(alts) != 3 or not all(isinstance(a, str) and a.strip() for a in alts):
        return "alts must be three non-empty strings"
    lowered = [a.strip().lower() for a in alts]
    if ru.strip().lower() in lowered or len(set(lowered)) != 3:
        return "alts must differ from ru and from each other"
    if "note" in entry and not isinstance(entry["note"], str):
        return "note must be a string"
    return check_extras(entry, ru, phrase)


def apply(path):
    incoming = json.loads(Path(path).read_text("utf-8"))
    phrases = {w["key"]: w["phrase"] for w in read(WORDS, {"words": []})["words"]}
    known = set(phrases)
    done = read(TRANSLATIONS, {})
    errors = 0
    added = 0
    for key, entry in incoming.items():
        problem = check(key, entry, done.get(key), phrases.get(key))
        if problem:
            print(f"ERROR {key!r}: {problem}", file=sys.stderr)
            errors += 1
            continue
        if key not in known:
            print(f"warning {key!r}: no such word in words.json (kept anyway)", file=sys.stderr)
        # A new translation keeps sentences and decoys written earlier.
        clean = dict(done.get(key, {}))
        if "ru" in entry:
            clean["ru"] = entry["ru"].strip()
            clean["alts"] = [a.strip() for a in entry["alts"]]
            clean.pop("note", None)
            if entry.get("note", "").strip():
                clean["note"] = entry["note"].strip()
        if "en_alts" in entry:
            clean["en_alts"] = [a.strip() for a in entry["en_alts"]]
        if "cloze" in entry:
            clean["cloze"] = [{"ru": c["ru"].strip(), "en": c["en"].strip(),
                               "accept": [a.strip() for a in c["accept"]]} for c in entry["cloze"]]
        done[key] = clean
        added += 1
    if errors:
        print(f"{errors} entries rejected; nothing written.", file=sys.stderr)
        sys.exit(1)
    write(TRANSLATIONS, done)
    left = len(known - set(done))
    print(f"Merged {added}; {len(done)} translations in total, {left} words still without one.")


def stats():
    words = read(WORDS, {"words": []})["words"]
    done = read(TRANSLATIONS, {})
    translated = sum(1 for w in words if w["key"] in done)
    print(f"Слов: {len(words)}, с переводом: {translated}, ждут: {len(words) - translated}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("pending", help="words without a translation, with context")
    p.add_argument("--all", action="store_true", help="include translated words")
    p.add_argument("--cloze", action="store_true", help="translated words still without sentences")
    a = sub.add_parser("apply", help="check and merge translations from a JSON file")
    a.add_argument("file")
    sub.add_parser("stats", help="counts")
    args = parser.parse_args()
    if args.cmd == "pending" and args.cloze:
        pending_cloze()
    elif args.cmd == "pending":
        pending(args.all)
    elif args.cmd == "apply":
        apply(args.file)
    else:
        stats()


if __name__ == "__main__":
    main()
