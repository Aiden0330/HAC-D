import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { strings } from './strings.js';
import { stringsV4 } from './strings_v4.js';

type Tree = { [k: string]: unknown };
/** v4 strings override the v3 ones key by key */
function merge(a: Tree, b: Tree): Tree {
  const out: Tree = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k] as Tree, v as Tree) : v;
  return out;
}

const saved = (() => {
  try {
    return localStorage.getItem('hacd-lang');
  } catch {
    return null;
  }
})();

void i18next.use(initReactI18next).init({
  resources: { en: { translation: merge(strings.en as Tree, stringsV4.en as Tree) }, zh: { translation: merge(strings.zh as Tree, stringsV4.zh as Tree) } },
  lng: saved === 'en' || saved === 'zh' ? saved : navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnObjects: true,
});

export function setLanguage(lang: 'zh' | 'en'): void {
  void i18next.changeLanguage(lang);
  try {
    localStorage.setItem('hacd-lang', lang);
  } catch {
    /* ignore */
  }
  document.documentElement.setAttribute('lang', lang === 'zh' ? 'zh-Hans' : 'en');
}

export default i18next;
