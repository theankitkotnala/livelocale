import React from 'react';
import { createRoot } from 'react-dom/client';
import { LocaleProvider, useLocale, useTranslation, useTranslations } from '@livelocale/react';
import { createBrowserDefaults } from '@livelocale/browser';
import { FallbackTranslationProvider } from '@livelocale/core';
import { TransformersTranslationProvider } from '@livelocale/transformers-provider';
import './style.css';

const browserDefaults = createBrowserDefaults();
const localModelProvider = new TransformersTranslationProvider();
const translationProvider = new FallbackTranslationProvider([browserDefaults.provider, localModelProvider]);
const SUPPORTED_LOCALES = ['en', 'fr', 'de', 'es', 'hi', 'ja', 'it', 'pt', 'zh'] as const;

function getInitialLocale(): string {
  if (typeof window === 'undefined') return 'en';

  try {
    const saved = window.localStorage.getItem('livelocale:locale');
    if (saved && SUPPORTED_LOCALES.includes(saved as typeof SUPPORTED_LOCALES[number])) return saved;

    const preferences = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const preference of preferences) {
      const canonical = Intl.getCanonicalLocales(preference)[0];
      if (!canonical) continue;
      const exact = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === canonical.toLowerCase());
      if (exact) return exact;
      const base = canonical.split('-')[0].toLowerCase();
      const languageMatch = SUPPORTED_LOCALES.find((locale) => locale === base);
      if (languageMatch) return languageMatch;
    }
  } catch {
    // Storage or locale APIs may be restricted; fall back to the source locale.
  }

  return 'en';
}

const initialLocale = getInitialLocale();

const DEMO_MESSAGES = [
  'Your interface, in every language.',
  'Translate UI text at runtime, cache it locally, and keep formatting correct without a translation backend.',
  'Choose a language',
  'Monthly revenue',
  'Formatted using native Intl',
  'Last updated',
  'Date formatting is deterministic and local',
  'What this prototype demonstrates',
  'No manually maintained translation catalog',
  'Source text remains visible while translation is unavailable',
  'Locale-aware number, currency, and date formatting',
  'Browser-only translation with no translation API calls',
  'Translations are generated only when a supported provider is available.',
] as const;

function Demo() {
  const { locale, setLocale, format } = useLocale();
  const { t } = useTranslations(DEMO_MESSAGES);
  const translationProbe = useTranslation(DEMO_MESSAGES[0]);
  const apiAvailable = typeof window !== 'undefined' && 'Translator' in window;
  const translationState = translationProbe.status === 'translated'
    ? 'Local translation ready.'
    : translationProbe.status === 'loading'
      ? 'Loading the local translation model or translating…'
      : translationProbe.status === 'error'
        ? `Local translation failed: ${translationProbe.error instanceof Error ? translationProbe.error.message : 'See the browser console for details.'}`
        : locale === 'en'
          ? 'Choose a language to start a translation.'
          : 'Preparing local translation…';

  return (
    <main className="shell">
      <div className="eyebrow">BROWSER-NATIVE INTERNATIONALISATION</div>
      <h1>{t('Your interface, in every language.')}</h1>
      <p className="lede">{t('Translate UI text at runtime, cache it locally, and keep formatting correct without a translation backend.')}</p>

      <section className="panel">
        <label htmlFor="locale">{t('Choose a language')}</label>
        <select id="locale" value={locale} onChange={(event) => {
          const nextLocale = event.target.value;
          setLocale(nextLocale);
          try { window.localStorage.setItem('livelocale:locale', nextLocale); } catch { /* Preference persistence is optional. */ }
        }}>
          <option value="en">English</option>
          <option value="fr">Français</option>
          <option value="de">Deutsch</option>
          <option value="es">Español</option>
          <option value="hi">हिन्दी</option>
          <option value="ja">日本語</option>
          <option value="it">Italiano</option>
          <option value="pt">Português</option>
          <option value="zh">中文</option>
        </select>
        <div className="status"><span className={apiAvailable ? 'dot good' : 'dot warn'} />
          {apiAvailable ? 'Built-in browser Translator API is available.' : 'Built-in Translator API is unavailable; LiveLocale will try its local model.'}
        </div>
        {!apiAvailable && <p className="note">This browser does not provide the built-in Translator API. The local model may need a large first-time download and can take a while to initialize.</p>}
        <div className="status"><span className={`dot ${translationProbe.status === 'translated' ? 'good' : translationProbe.status === 'error' ? 'bad' : 'warn'}`} />{translationState}</div>
      </section>

      <section className="cards">
        <article className="card"><div className="label">{t('Monthly revenue')}</div><div className="metric">{format.currency(1299.5, { currency: locale === 'ja' ? 'JPY' : locale === 'de' || locale === 'fr' || locale === 'es' ? 'EUR' : 'USD', maximumFractionDigits: 2 })}</div><p>{t('Formatted using native Intl')}</p></article>
        <article className="card"><div className="label">{t('Last updated')}</div><div className="metric">{format.date(new Date(), { dateStyle: 'medium' })}</div><p>{t('Date formatting is deterministic and local')}</p></article>
      </section>

      <section className="panel">
        <h2>{t('What this prototype demonstrates')}</h2>
        <ul>
          <li>{t('No manually maintained translation catalog')}</li>
          <li>{t('Source text remains visible while translation is unavailable')}</li>
          <li>{t('Locale-aware number, currency, and date formatting')}</li>
          <li>{t('Browser-only translation with no translation API calls')}</li>
        </ul>
      </section>
      <footer>LiveLocale · Prototype · {t('Translations are generated only when a supported provider is available.')}</footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LocaleProvider config={{
      sourceLocale: 'en',
      locale: initialLocale,
      supportedLocales: [...SUPPORTED_LOCALES],
      provider: translationProvider,
      cache: browserDefaults.cache,
      onError: (error) => console.warn('[LiveLocale]', error),
    }}>
      <Demo />
    </LocaleProvider>
  </React.StrictMode>,
);
