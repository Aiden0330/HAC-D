import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { strings } from './strings.js';

const saved = (() => {
  try {
    return localStorage.getItem('hacd-lang');
  } catch {
    return null;
  }
})();

void i18next.use(initReactI18next).init({
  resources: { en: { translation: strings.en }, zh: { translation: strings.zh } },
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
