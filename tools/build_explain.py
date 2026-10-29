"""Merges per-question explanations into web/data/explain/.

    python3 tools/build_explain.py SRC_DIR

SRC_DIR holds one <question id>.json per question (translation, glossary,
solution, per-option analysis, memory hook — see web/js/explain.js for the
shape). Every entry is checked against the bank: the question must exist, its
option letters must match and its stated answer must equal the official key.
Anything that fails is reported and skipped.

The merge is additive: entries already in web/data/explain/ stay unless SRC_DIR
has a newer version of the same question. The bank itself (web/data/*.json) is never touched,
so saved progress is unaffected.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / 'web' / 'data'
OUT = DATA / 'explain'
KEYS = {'answer', 'question', 'options', 'terms', 'solution', 'why', 'memo'}


def load_bank():
    index = json.loads((DATA / 'index.json').read_text())
    bank = {}
    for meta in index['exams']:
        exam = json.loads((DATA / f"{meta['examId']}.json").read_text())
        for q in exam['questions']:
            bank[q['id']] = (exam['examId'], q)
    return bank


def text_ok(value):
    return (isinstance(value, str) and value.strip()
            and not re.search(r'<[a-zA-Z/][^>]*>', value)
            and value.count('**') % 2 == 0)


def problems(entry, q):
    out = []
    if not isinstance(entry, dict):
        return ['not an object']
    missing = KEYS - set(entry)
    if missing:
        out.append(f'missing {sorted(missing)}')
    if entry.get('answer') != q['answer']:
        out.append(f"answer {entry.get('answer')!r} != key {q['answer']!r}")
    for field in ('question', 'solution'):
        if not text_ok(entry.get(field)):
            out.append(f'bad {field}')
    for field in ('options', 'why'):
        value = entry.get(field)
        if not isinstance(value, dict) or sorted(value) != sorted(q['options']) \
                or not all(text_ok(v) for v in value.values()):
            out.append(f'bad {field}')
    # Versions of a repeated question shuffle their options, so the analysis
    # must call exactly the keyed option correct, not a letter from another year.
    why = entry.get('why') if isinstance(entry.get('why'), dict) else {}
    marked = [k for k, v in why.items() if isinstance(v, str) and v.lstrip().startswith('**Верно')]
    if marked != [q['answer']]:
        out.append(f"why marks {marked} as correct, key is {q['answer']!r}")
    if not isinstance(entry.get('terms'), list):
        out.append('bad terms')
    if entry.get('memo') is not None and not text_ok(entry['memo']):
        out.append('bad memo')
    return out


def load_explained():
    by_exam = {}
    for path in sorted(OUT.glob('*.json')):
        if path.name != 'index.json':
            by_exam[path.stem] = json.loads(path.read_text())
    return by_exam


def write(by_exam, bank):
    index = {'exams': {}}
    for exam_id in sorted(by_exam):
        entries = dict(sorted(by_exam[exam_id].items(), key=lambda kv: bank[kv[0]][1]['no']))
        (OUT / f'{exam_id}.json').write_text(
            json.dumps(entries, ensure_ascii=False, indent=1) + '\n')
        index['exams'][exam_id] = list(entries)
    (OUT / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=1) + '\n')
    return sum(len(v) for v in index['exams'].values()), len(index['exams'])


def main():
    args = sys.argv[1:]
    if len(args) != 1:
        sys.exit(__doc__)
    src = pathlib.Path(args[0])
    bank = load_bank()
    OUT.mkdir(exist_ok=True)
    by_exam = load_explained()

    added = skipped = 0
    for path in sorted(src.glob('*.json')):
        qid = path.stem
        if qid not in bank:
            print(f'skip {qid}: not in the bank')
            skipped += 1
            continue
        exam_id, q = bank[qid]
        try:
            entry = json.loads(path.read_text())
        except ValueError as err:
            print(f'skip {qid}: invalid JSON ({err})')
            skipped += 1
            continue
        issues = problems(entry, q)
        if issues:
            print(f"skip {qid}: {'; '.join(issues)}")
            skipped += 1
            continue
        keep = {k: entry[k] for k in ('answer', 'question', 'options', 'terms',
                                      'solution', 'why', 'memo', 'note') if k in entry}
        by_exam.setdefault(exam_id, {})[qid] = keep
        added += 1

    total, exams = write(by_exam, bank)
    print(f'merged {added}, skipped {skipped}; {total} questions explained '
          f'across {exams} exams')


if __name__ == '__main__':
    main()
