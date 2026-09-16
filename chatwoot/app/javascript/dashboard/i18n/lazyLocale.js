// Keep in sync with the locale keys exported by `./index.js`.
// Only these locales are wired into the language switcher / OAuth signup flow.
export const SUPPORTED_LOCALES = [
  'ar',
  'bg',
  'ca',
  'cs',
  'da',
  'de',
  'el',
  'en',
  'es',
  'et',
  'fa',
  'fi',
  'fr',
  'he',
  'hi',
  'hu',
  'id',
  'it',
  'ja',
  'ko',
  'lv',
  'ml',
  'nl',
  'no',
  'pl',
  'pt',
  'pt_BR',
  'ro',
  'ru',
  'sk',
  'sl',
  'sr',
  'sv',
  'ta',
  'th',
  'tr',
  'uk',
  'uz',
  'vi',
  'zh_CN',
  'zh_TW',
  'is',
  'lt',
];

// Vite keeps these as dynamic imports (one HTTP request per locale, only on demand)
// instead of bundling every language into the initial page load.
const localeLoaders = import.meta.glob('./locale/*/index.js');

export async function loadLocaleMessages(locale) {
  const loader = localeLoaders[`./locale/${locale}/index.js`];
  if (!loader || !SUPPORTED_LOCALES.includes(locale)) return null;
  const mod = await loader();
  return mod.default || mod;
}

// Registers a locale's messages on the given i18n instance (composer or `$i18n`)
// only if they aren't already loaded, then leaves setting `.locale` to the caller.
export async function ensureLocaleMessages(i18n, locale) {
  if (!locale || i18n.availableLocales.includes(locale)) return;
  const messages = await loadLocaleMessages(locale);
  if (messages) {
    i18n.setLocaleMessage(locale, messages);
  }
}
