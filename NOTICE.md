# Notice

This repository mixes material under three different terms.

## 1. ITPEC exam material: © ITPEC

The past exam questions, their options, the official answer keys and the
question images (`web/data/20*.json`, `web/data/img/`) come from the
Information Technology Professionals Examination Council (ITPEC):
<https://itpec.org/pastexamqa/fe.html>.

ITPEC's terms for past exam questions, summarized:

- no permission or fees are needed to use them for educational purposes, such
  as exercise books or textbooks, unless that goes against the purpose of the
  examination;
- copyrights are not waived;
- the source must be shown as (year and season, exam category, subject,
  question number);
- when any part of a question is modified, this must be stated clearly.

How this project follows them:

- the questions are used for exam preparation only, free of charge;
- every question carries its source, for example "October 2025 · Subject A ·
  Q9" for FE, October 2025, Subject A, question 9. The cheat sheet cites
  questions as `2025A·Q9` (2025, October = A, April = S);
- the question images are unmodified crops of the official PDFs;
- the Russian translations (`web/data/explain/`) and the short retellings of
  questions in the cheat sheet (`web/docs/`) are **modified versions** of
  ITPEC questions, and they are labelled as translations and retellings.

This material is not covered by the licenses below. Check ITPEC's current terms
before reusing it.

## 2. The project's own texts: CC BY-NC-SA 4.0

© 2026 Kosarev Vsevolod.

The explanations, the solution walk-throughs, the memory hooks and glossaries
in `web/data/explain/`, the cheat sheet (`web/docs/cheatsheet.html`,
`web/docs/cheatsheet.en.html`) and the abbreviation notes
(`web/data/abbr.json`) are licensed under
[Creative Commons Attribution-NonCommercial-ShareAlike 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
Where these texts contain ITPEC questions in translation or retelling, the
license covers only the project's own contribution. The questions themselves
remain ITPEC's (section 1).

The translations and explanations are unofficial and may contain mistakes. The
official ITPEC answer key is authoritative.

## 3. Code: MIT

The source code is under the [MIT License](LICENSE).

## Third-party components

- [pdfmake](https://github.com/bpampuch/pdfmake) 0.3.11, MIT, with the Roboto
  fonts it bundles: `web/vendor/pdfmake/` (license included).
- DejaVu Sans 2.35, subset to symbol glyphs: `web/vendor/fonts/` (license
  included).
- Space Grotesk and IBM Plex Mono, loaded from Google Fonts (SIL Open Font
  License).

## Not affiliated

This is an independent study project. It is not affiliated with, endorsed by
or connected to ITPEC, IPA (Information-technology Promotion Agency, Japan) or
any national exam body. "ITPEC" is used only to name the examination the
project helps prepare for.
