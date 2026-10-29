# ITPEC FE Trainer

[Русская версия](README.ru.md)

A local web app for preparing for the **ITPEC Fundamental IT Engineer (FE)**
examination. It holds **1,840 past exam questions** with their official answer
keys: 1,740 for Subject A (April 2015 – April 2026) and 100 for Subject B
(April 2024 – April 2026).

Every question is shown as a picture cut straight from the official PDF, so
diagrams, tables, logic circuits and fraction-set options look exactly as they
do on the exam.

The interface is in **Russian**. The questions are in English, as on the exam.
1,120 questions come with a Russian translation and a worked explanation, and
the cheat sheet is in both Russian and English.

> Unofficial project, not affiliated with ITPEC. The questions belong to ITPEC
> and are used for study under its terms. See [Data and attribution](#data-and-attribution).

## Quick start

You need Python 3. No other dependencies, no build step.

```bash
./start.sh
```

This opens <http://localhost:8765/>. Pick another port with `./start.sh 9000`.

The app must be served over HTTP: it loads the question bank with `fetch()`,
which browsers block for `file://` pages. The internet is only used for web
fonts and the "look it up" button.

Progress is kept in the browser's `localStorage` and is tied to the exact
address: `localhost:8765` and `localhost:8766`, or `localhost` and
`127.0.0.1`, are separate stores. Always open the app at the same address.

## Features

- **Timed exam.** A whole past paper or a random mix in the current format:
  Subject A is 60 questions in 90 minutes, Subject B is 20 tasks in 100
  minutes, and the pass mark is 60% for each. There is an answer sheet,
  flags, pause and early finish. The results show the score, time per
  question, and a breakdown by area and category. You can export them as CSV
  or as a PDF with bookmarks, built in the browser.
- **Practice.** Random questions one after another, with the answer shown
  right away. Filters: part, category, questions repeated between years, and
  any / not seen yet / answered wrong. The filters are kept in the URL.
- **Repeats between exams.** ITPEC reuses questions, usually reworded or with
  shuffled options. Pairs are matched by their wording, their set of options
  and the meaning of the correct option, so a repeat is found even when the
  answer letter changed. Of the 1,740 Subject A questions, 1,298 are unique.
  Practice shows each repeated question once, in its newest wording. The (i)
  button lists every appearance with its answer letter.
- **Translations and explanations** (Russian) for 1,120 questions: the
  translation, how to solve it, why each wrong option is wrong, a memory hook
  where a real one exists, and a glossary. They are hidden during a timed exam.
- **Cheat sheet** in Russian and English. It has 60 topic blocks: CPU and
  memory, OS scheduling, notations and traversals, network, security and
  strategy. It includes a self-test mode, a grade for each topic based on your
  answers, and a test built from the bank questions of the topics you tick.
- **Words and abbreviations.** Select English text in any question to save it
  to your own dictionary or hear it pronounced. The words are stored by
  `start.sh` in `vocab/words.json`, and each user builds their own. There is
  also a drill on 307 abbreviations found in the questions.
- **History.** Every attempt and every answered question, kept separately for
  Subject A and Subject B, with per-item deletion.
- **Countdown** to the next ITPEC sitting. The FE exam is held twice a year, in
  April and October. You can also set your own date.

## Data and attribution

The questions, answer keys and question images come from the official past
exam archives at <https://itpec.org/pastexamqa/fe.html>. ITPEC allows using
them for educational purposes without permission or fees, provided that:

- copyright is not waived: it stays with ITPEC;
- the source is shown as *year and season, exam category, subject, question
  number*. The app shows this for every question, for example
  "October 2025 · Subject A · Q9";
- any modification is stated clearly. In this project the Russian
  translations, the explanations and the short retellings in the cheat sheet
  are modified versions of the questions, and they are labelled as such.

The categories are assigned automatically from keywords in the question text,
because the official PDFs have no syllabus markup. A few questions may land in
a neighbouring category.

The translations and explanations are unofficial and may contain mistakes. The
official answer key always wins: `tools/build_explain.py` rejects any
explanation whose answer differs from the key.

## Rebuilding the bank

```bash
python3 tools/fetch_exams.py    # download the archives from itpec.org into raw/
python3 tools/build_bank.py     # PDF -> web/data/*.json + web/data/img/
python3 tools/find_repeats.py   # mark repeats and variations between exams
```

This needs `pymupdf`, `Pillow`, `numpy` and `scipy`. The scripts are
idempotent, and rebuilding never changes question IDs, so saved progress
survives. `raw/` is not part of the repository: the archives are always
downloaded from itpec.org.

Other tools:

- `tools/build_explain.py DIR` adds explanations (one `<question id>.json` per
  question; the format is described in `tools/explain_spec.md`) after checking
  each one against the bank and the official key.
- `tools/topics.py` links the cheat sheet blocks to bank questions.
- `tools/sheet_lang.py check` keeps the English cheat sheet in step with the
  Russian one.
- `tools/vocab.py` lists the dictionary words that still need a translation
  and merges translations.

## Project structure

```
start.sh        local server; also serves /api/vocab for the dictionary
tools/          Python scripts that build the bank and its annotations
web/            the app: static files, ES modules, no build step
  data/         index.json, <exam>.json, img/<exam>/qNN.webp,
                explain/ (translations and explanations),
                topics.json (cheat sheet blocks -> questions),
                abbr.json (abbreviation drill)
  docs/         cheat sheet, cheatsheet.html (RU) and cheatsheet.en.html (EN)
  js/           bank, store, exam, practice, history, explain, docs,
                topics, vocab, words, abbr, report (CSV/PDF), app
  css/app.css   design system
  vendor/       pdfmake and symbol fonts, with their licenses
```

## License

- Code: [MIT](LICENSE).
- The project's own texts (translations, explanations, the cheat sheet, the
  abbreviation notes): [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
- ITPEC questions, answer keys and images: © ITPEC, not covered by either
  license. They are used under ITPEC's terms above.

The details are in [NOTICE.md](NOTICE.md).
