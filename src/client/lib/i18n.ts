import { DEFAULT_LANGUAGE, LANGUAGE_CODES } from '@shared/languages'
import i18n from 'i18next'
import HttpBackend from 'i18next-http-backend'
import { initReactI18next } from 'react-i18next'

const RTL_LANGUAGES = ['ar', 'fa']

const savedLang =
  typeof window !== 'undefined'
    ? localStorage.getItem('llamenos-lang') || navigator.language.split('-')[0]
    : DEFAULT_LANGUAGE

i18n
  .use(HttpBackend)
  .use(initReactI18next)
  .init({
    lng: LANGUAGE_CODES.includes(savedLang) ? savedLang : DEFAULT_LANGUAGE,
    fallbackLng: DEFAULT_LANGUAGE,
    interpolation: { escapeValue: false },
    backend: {
      loadPath: '/locales/{{lng}}.json',
    },
    // Only load the selected language, not all languages
    load: 'currentOnly',
    // Show fallback content while loading (avoid blank screen)
    react: {
      useSuspense: false,
    },
  })

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
