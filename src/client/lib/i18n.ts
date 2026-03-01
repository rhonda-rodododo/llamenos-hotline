import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { LANGUAGE_CODES, DEFAULT_LANGUAGE } from '@shared/languages'
import { en, es, zh, tl, vi, ar, fr, ht, ko, ru, hi, pt, de } from '@llamenos/i18n'

const resources: Record<string, { translation: Record<string, unknown> }> = {
  en: { translation: en },
  es: { translation: es },
  zh: { translation: zh },
  tl: { translation: tl },
  vi: { translation: vi },
  ar: { translation: ar },
  fr: { translation: fr },
  ht: { translation: ht },
  ko: { translation: ko },
  ru: { translation: ru },
  hi: { translation: hi },
  pt: { translation: pt },
  de: { translation: de },
}

const savedLang = typeof window !== 'undefined'
  ? localStorage.getItem('llamenos-lang') || navigator.language.split('-')[0]
  : DEFAULT_LANGUAGE

i18n.use(initReactI18next).init({
  resources,
  lng: LANGUAGE_CODES.includes(savedLang) ? savedLang : DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false },
})

const RTL_LANGUAGES = ['ar']

function syncDocumentLang(lang: string) {
  document.documentElement.lang = lang
  document.documentElement.dir = RTL_LANGUAGES.includes(lang) ? 'rtl' : 'ltr'
}

// Sync on init
if (typeof window !== 'undefined') {
  syncDocumentLang(i18n.language)
}

export function setLanguage(lang: string) {
  i18n.changeLanguage(lang)
  localStorage.setItem('llamenos-lang', lang)
  syncDocumentLang(lang)
}

export default i18n
