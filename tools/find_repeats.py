#!/usr/bin/env python3
"""Finds questions that recur across exam sessions, and tells duplicates apart
from mere variations on a theme.

ITPEC re-uses questions constantly, but rarely verbatim: between sessions a
question is re-translated ("resistant to dirt" -> "stain-resistant"), its options
are shuffled, or its distractors are swapped out. Comparing whole texts misses
the first two and wrongly merges cases where the options are identical but the
question asks something different ("growth stage" vs "introduction stage").

So each question is split into its stem and its options, and a pair is judged on
three separate signals:

  stem    how alike the questions read (TF-IDF cosine, crude stemming)
  opt     how alike the two option sets are, after optimally pairing them up
  ans     how alike the two *correct* options are

A pair is a duplicate ("same") when the stems agree and the optimal option
pairing maps one correct answer onto the other — that survives rewording and
shuffling. It is a "variant" when the question is recognisably the same topic
but the right answer differs. Everything is compared exhaustively (~1.7M pairs);
the bank is small enough that no approximate candidate search is needed.

The output is purely additive — the question files keep every question and every
ID, because saved attempts and statistics reference questions by ID.
"""
import collections
import glob
import json
import math
import os
import re

import numpy as np
from scipy import sparse
from scipy.optimize import linear_sum_assignment

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "data")

# A pair is only examined further if the stems or whole texts are this close.
CANDIDATE = 0.45

TRANS = str.maketrans({
    "’": "'", "‘": "'", "“": '"', "”": '"', "–": "-", "—": "-", "‐": "-", "−": "-",
    "×": "*", "÷": "/",
})
# Operators carry the meaning of many options ("8x + 6y ≥ 60" vs "8x + 6y ≤ 60"),
# so they become words instead of being stripped with the rest of the punctuation.
OPERATORS = [("≥", " op_ge "), ("≤", " op_le "), ("≠", " op_ne "), (">=", " op_ge "),
             ("<=", " op_le "), (">", " op_gt "), ("<", " op_lt "), ("=", " op_eq "),
             ("+", " op_plus "), ("*", " op_mul "), ("/", " op_div "), ("^", " op_pow ")]
OPTION_MARK = re.compile(r"(?:(?<=\n)|(?<=\s{3})|^)\s*([a-k])\s*\)\s*")
QNO = re.compile(r"^Q\s?\d{1,2}\s*\.?")
STOP = set("""a an the of to in on for and or is are be by as at it its this that with
from which following what when where who how can may will than then there these those
such into appropriate most description explanation describe describes concerning""".split())
SUFFIXES = ("ships", "ship", "ations", "ation", "ings", "ing", "ies", "es", "ed", "ly", "s")


def stem(word):
    """Just enough stemming to equate relation/relationship, class/classes."""
    if len(word) <= 4 or word.isdigit():
        return word
    for suffix in SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) >= 4:
            word = word[: -len(suffix)] + ("y" if suffix == "ies" else "")
            break
    return word[:-1] if word.endswith("e") and len(word) > 4 else word


def tokens(text, bigrams=True):
    for sym, word in OPERATORS:
        text = text.replace(sym, word)
    words = [stem(w) for w in re.sub(r"[^a-z0-9_]+", " ", text.lower()).split() if w not in STOP]
    if bigrams:
        words += [words[i] + "_" + words[i + 1] for i in range(len(words) - 1)]
    return words


def compact(text):
    """Spacing-insensitive form: 'Balanced score card' == 'Balanced scorecard'."""
    return re.sub(r"[^a-z0-9≥≤≠<>=+*/^-]+", "", text.lower())


def char_similarity(a, b):
    ga = {a[i:i + 3] for i in range(max(1, len(a) - 2))}
    gb = {b[i:i + 3] for i in range(max(1, len(b) - 2))}
    return len(ga & gb) / float(len(ga | gb)) if ga and gb else 0.0


def split_question(text):
    """Returns (stem, {letter: option text}) or (text, None) if options are drawings."""
    text = QNO.sub(" ", text.translate(TRANS))
    hits = [(m.start(), m.end(), m.group(1)) for m in OPTION_MARK.finditer(text)]
    best = None
    # The answer options are the last a), b), c), d)... run in the text; an
    # earlier "a)" can belong to a sub-list inside the question itself.
    for i, hit in enumerate(hits):
        if hit[2] != "a":
            continue
        run = [hit]
        for later in hits[i + 1:]:
            if ord(later[2]) == ord(run[-1][2]) + 1:
                run.append(later)
        if len(run) >= 4:
            best = run
    if not best:
        return text, None
    options = {}
    for k, (_start, end, letter) in enumerate(best):
        stop = best[k + 1][0] if k + 1 < len(best) else len(text)
        options[letter] = " ".join(text[end:stop].split())
    if not all(options.values()):
        return text[:best[0][0]], None
    return text[:best[0][0]], options


def tfidf(docs):
    vocab, rows, cols, vals = {}, [], [], []
    df = collections.Counter()
    for doc in docs:
        df.update(set(doc))
    n = len(docs)
    for i, doc in enumerate(docs):
        for term, count in collections.Counter(doc).items():
            rows.append(i)
            cols.append(vocab.setdefault(term, len(vocab)))
            vals.append((1 + math.log(count)) * (math.log((n + 1) / (df[term] + 1)) + 1))
    matrix = sparse.csr_matrix((vals, (rows, cols)), shape=(n, max(1, len(vocab))))
    norms = np.sqrt(np.asarray(matrix.multiply(matrix).sum(1)).ravel())
    norms[norms == 0] = 1
    return sparse.diags(1 / norms) @ matrix


def exam_order(qid):
    """Chronological sort key: April (S) comes before October (A)."""
    code = qid.split("-")[0]
    return (int(code[:4]), 0 if code[4] == "S" else 1)


class Bank:
    def __init__(self, questions):
        self.q = questions
        self.parsed = [split_question(q["text"]) for q in questions]
        stems = tfidf([tokens(s, bigrams=False) for s, _o in self.parsed])
        whole = tfidf([tokens(q["text"].translate(TRANS)) for q in questions])
        self.stem_cos = (stems @ stems.T).toarray()
        self.full_cos = (whole @ whole.T).toarray()

        docs, self.opt_row = [], {}
        for i, (_s, options) in enumerate(self.parsed):
            for letter, text in (options or {}).items():
                self.opt_row[(i, letter)] = len(docs)
                docs.append(tokens(text))
        self.opt_vec = tfidf(docs) if docs else None

    def short_options(self, i):
        """Numeric or one-word options coincide by chance too easily to trust."""
        options = self.parsed[i][1]
        return options is not None and \
            sum(len(v.split()) for v in options.values()) / float(len(options)) <= 3

    def content_words(self, i):
        return len(tokens(self.q[i]["text"], bigrams=False))

    def option_matrix(self, i, j):
        oi, oj = self.parsed[i][1], self.parsed[j][1]
        li, lj = sorted(oi), sorted(oj)
        a = self.opt_vec[[self.opt_row[(i, l)] for l in li]]
        b = self.opt_vec[[self.opt_row[(j, l)] for l in lj]]
        m = (a @ b.T).toarray()
        for x, la in enumerate(li):
            for y, lb in enumerate(lj):
                m[x, y] = max(m[x, y], char_similarity(compact(oi[la]), compact(oj[lb])))
        return li, lj, m

    def compare(self, i, j):
        stem_sim = float(self.stem_cos[i, j])
        full_sim = float(self.full_cos[i, j])
        if stem_sim < CANDIDATE and full_sim < CANDIDATE:
            return None
        qi, qj = self.q[i], self.q[j]

        if self.parsed[i][1] and self.parsed[j][1]:
            li, lj, m = self.option_matrix(i, j)
            rows, cols = linear_sum_assignment(-m)
            pairing = {li[r]: lj[c] for r, c in zip(rows, cols)}
            opt_sim = float(m[rows, cols].mean())
            maps = pairing.get(qi["answer"]) == qj["answer"]
            ans_sim = float(m[li.index(qi["answer"]), lj.index(qj["answer"])]) \
                if qi["answer"] in li and qj["answer"] in lj else 0.0

            short = self.short_options(i) or self.short_options(j)
            need_stem = 0.75 if short else 0.3
            same = maps and stem_sim >= need_stem and \
                (ans_sim >= 0.5 or (ans_sim >= 0.3 and opt_sim >= 0.45))
            # Identical option sets and answers under a rephrased stem
            # ("merit of using SaaS" / "security management when SaaS is used").
            same = same or (maps and not short and ans_sim >= 0.8 and opt_sim >= 0.7)
            score = min(1.0, 0.5 * ans_sim + 0.3 * opt_sim + 0.2 * stem_sim) if same else \
                max(stem_sim, opt_sim)
            if same:
                return "same", score
            if stem_sim >= 0.7 or opt_sim >= 0.6:
                return "variant", score
            return None

        # Options are drawings (circuits, trees, charts): the text cannot show
        # which figure is which. Only near-verbatim questions with enough prose
        # to be distinctive, and the same answer letter, count as duplicates.
        if full_sim >= 0.9 and qi["answer"] == qj["answer"] and \
                min(self.content_words(i), self.content_words(j)) >= 25:
            return "same", full_sim
        if stem_sim >= 0.8:
            return "variant", stem_sim
        return None


def clusters(ids, same_edges):
    parent = {i: i for i in ids}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in same_edges:
        parent[find(a)] = find(b)
    groups = collections.defaultdict(list)
    for i in ids:
        groups[find(i)].append(i)
    return [sorted(g, key=exam_order) for g in groups.values() if len(g) > 1]


def main():
    files = sorted(glob.glob(os.path.join(DATA_DIR, "*-*.json")))
    exams = [json.load(open(path)) for path in files]
    questions = [q for exam in exams for q in exam["questions"]]
    ids = [q["id"] for q in questions]
    print("%d questions" % len(questions))

    links = collections.defaultdict(lambda: {"same": [], "variant": []})
    same_edges = []
    for part in ("A", "B"):
        idx = [k for k, qid in enumerate(ids) if qid.split("-")[1] == part]
        bank = Bank([questions[k] for k in idx])
        for x in range(len(idx)):
            for y in range(x + 1, len(idx)):
                a, b = ids[idx[x]], ids[idx[y]]
                if a.rsplit("-", 1)[0] == b.rsplit("-", 1)[0]:
                    continue  # two questions of one paper are never repeats
                verdict = bank.compare(x, y)
                if not verdict:
                    continue
                kind, score = verdict
                links[a][kind].append((b, round(score, 3)))
                links[b][kind].append((a, round(score, 3)))
                if kind == "same":
                    same_edges.append((a, b))

    groups = clusters(ids, same_edges)
    # The newest version of a question represents its cluster: its wording and
    # translation are the closest to what the next paper will print.
    rep = {qid: group[-1] for group in groups for qid in group}

    for exam, path in zip(exams, files):
        for q in exam["questions"]:
            # Rewritten from scratch every run so stale annotations never linger.
            for key in ("repeats", "variants", "cluster"):
                q.pop(key, None)
            found = links.get(q["id"])
            if found and found["same"]:
                q["repeats"] = [{"id": i, "sim": s}
                                for i, s in sorted(found["same"], key=lambda t: (-t[1], t[0]))]
            if found and found["variant"]:
                q["variants"] = [{"id": i, "sim": s}
                                 for i, s in sorted(found["variant"], key=lambda t: (-t[1], t[0]))[:8]]
            if q["id"] in rep:
                q["cluster"] = rep[q["id"]]
        with open(path, "w") as fh:
            json.dump(exam, fh, ensure_ascii=False, separators=(",", ":"))

    members = sum(len(g) for g in groups)
    print("%d duplicate pairs -> %d clusters covering %d questions"
          % (len(same_edges), len(groups), members))
    print("%d unique questions (clusters count once)" % (len(ids) - members + len(groups)))
    print("%d variant pairs" % (sum(len(v["variant"]) for v in links.values()) // 2))
    sizes = collections.Counter(len(g) for g in groups)
    print("cluster sizes:", dict(sorted(sizes.items())))


if __name__ == "__main__":
    main()
