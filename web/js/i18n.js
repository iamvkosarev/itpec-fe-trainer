// Language of the cheat sheet: Russian (the default) or English in the
// wording of the exam. docs.js sets it before the sheet and its widgets are
// built; widgets pick their strings with tr() as they draw, so switching
// rebuilds the sheet rather than patching text in place.

let current = 'ru';

export function setLang(lang) {
  current = lang === 'en' ? 'en' : 'ru';
}

export function lang() {
  return current;
}

/** tr('Шаг', 'Step') — the string for the current language. */
export function tr(ru, en) {
  return current === 'en' ? en : ru;
}
