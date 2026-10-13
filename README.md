# LiveLocale

**Browser-first runtime translation for React + TypeScript.** Developers choose a locale; LiveLocale resolves the available provider, translates messages asynchronously, caches successful results, and keeps the source text as a safe fallback.

> Status: production-oriented foundation, not yet a claim of production certification. Real-browser integration, model quality, package publishing, and compatibility tests are still required before relying on it for critical user-facing flows.

## Principles

- **No per-language model map in application code.** The optional Transformers provider uses a multilingual model and passes source/target language codes at inference time.
- **No translation work during React render.** Use `useTranslation` or `useTranslations` to request translations in effects. `t()` is a pure synchronous lookup and returns source text until a translation is ready.
- **Source-first UX.** Text appears immediately. Unsupported pairs and provider errors leave the source text visible.
- **Browser-local processing.** Application text is sent to the configured local provider; the optional Transformers provider may download model assets on first use. LiveLocale does not require a translation API backend.
- **Persistent, bounded caching.** Memory cache plus IndexedDB are available. Cache failures do not prevent a valid translation from rendering.
- **Locale correctness.** Dates, numbers, currencies, lists, and plural rules use native `Intl` rather than machine-translated formatting.

## Packages

- `@livelocale/core`: runtime, provider interface, cache interface, memory cache, interpolation protection, and `Intl` helpers.
- `@livelocale/react`: `LocaleProvider`, `useLocale`, `useTranslation`, and `useTranslations`.
- `@livelocale/browser`: browser Translator API provider and bounded IndexedDB cache.
- `@livelocale/transformers-provider`: optional Transformers.js local-model provider using a multilingual model by default.

## Install / local development

Requires Node.js 20+ and npm.

```bash
npm install
npm run build
npm test
npm run dev
```

The workspace packages are currently versioned `0.1.0`; review package metadata, licenses, and the release process before publishing.

## React usage

```tsx
import { LocaleProvider, useLocale, useTranslation } from '@livelocale/react';
import { createBrowserDefaults } from '@livelocale/browser';
import { FallbackTranslationProvider } from '@livelocale/core';
import { TransformersTranslationProvider } from '@livelocale/transformers-provider';

const browser = createBrowserDefaults();
const provider = new FallbackTranslationProvider([
  browser.provider,
  new TransformersTranslationProvider(),
]);

export function AppRoot() {
  return (
    <LocaleProvider config={{
      sourceLocale: 'en',
      locale: 'en',
      supportedLocales: ['en', 'fr', 'de', 'ja', 'hi'],
      preLoadLangOptions: ['fr', 'de'], // or 'all' to preload every supported locale
      provider,
      cache: browser.cache,
      onError: (error) => console.warn('LiveLocale translation failed', error),
    }}>
      <App />
    </LocaleProvider>
  );
}

function Greeting() {
  const { locale, setLocale, format } = useLocale();
  const greeting = useTranslation('Welcome, {name}', { values: { name: 'Ada' } });

  return (
    <>
      <p>{greeting.text}</p>
      <small>Translation status: {greeting.status}</small>
      <p>{format.currency(1234.5, { currency: 'EUR' })}</p>
      <button onClick={() => setLocale(locale === 'fr' ? 'en' : 'fr')}>
        Change language
      </button>
    </>
  );
}
```

`useTranslation` returns `{ text, status, locale, error? }`. The status can be `source`, `loading`, `translated`, or `error`. It renders source text immediately and requests translation in an effect. It will re-render when the translation becomes available.

For a screen with multiple messages, use `useTranslations` to request them together:

```tsx
const MESSAGES = ['Save changes', 'Cancel', 'Your profile'];

function ProfileActions() {
  const { t, status } = useTranslations(MESSAGES);
  return <>
    <button>{t('Save changes')}</button>
    <button>{t('Cancel')}</button>
    <p>{status('Your profile')}</p>
  </>;
}
```

The array is a list of source messages to preload, not a translated catalog. Keep it stable at module scope when possible.

### Preloading languages

By default, `useTranslations(messages)` preloads those messages for the active locale. Set `preLoadLangOptions` in the `LocaleProvider` config to also translate them for additional locales:

```tsx
preLoadLangOptions: ['fr', 'de'] // active locale plus French and German
```

Use `preLoadLangOptions: 'all'` to preload the messages for every entry in `supportedLocales` (the source locale is skipped). The `'all'` option requires `supportedLocales` to be set. The configured model is shared across languages and downloads once; translations are generated and cached per message and locale. Preloading many locales takes longer and uses more storage, so the runtime processes locales one at a time. Messages in components that have not mounted yet are not known to LiveLocale and are not preloaded until those components mount.

### Synchronous lookup

`useLocale().t(message, values?, context?)` is intentionally synchronous and side-effect free. It returns the cached translation if one is already available; otherwise it returns the source text. Use `useTranslation`, `useTranslations`, or `runtime.preload()` when you want translation work to be requested.

### Runtime configuration

`LocaleProvider` captures its `config` on mount. To replace the runtime/provider configuration, change the provider's React `key`. The `locale` option is the initial locale; use `setLocale()` for subsequent changes.

## Translation providers

### Native browser Translator API

`createBrowserDefaults()` returns a native provider and an IndexedDB cache. Native translation availability depends on the browser, user agent, and language pair. Feature detection is used. The factory does not install a local-model provider automatically; to support browsers without the built-in API, compose it with `TransformersTranslationProvider` as in the setup example. The local model may require a large first-time download and a network connection unless its files are already cached.

### Transformers.js

```tsx
import { TransformersTranslationProvider } from '@livelocale/transformers-provider';

const localProvider = new TransformersTranslationProvider();
```

The default model is `Xenova/m2m100_418M`. Language codes are selected dynamically at inference time, with regional BCP-47 tags reduced to their base language where appropriate. The model has finite language coverage; unsupported pairs are rejected rather than silently pretending to translate. Model files may be downloaded on first use, so plan for download size, loading latency, device memory, CSP, and offline behavior. Verify model licensing and output quality for your application before deployment.

You can provide `modelForPair` only for advanced cases where a specialized model is required. Most applications should not need a per-language mapping.

## Caching and privacy

- Cache identity includes source locale, target locale, source message, context, glossary version, provider identity, and schema version.
- Successful translations are cached in memory and in the configured cache implementation.
- Memory and IndexedDB caches are bounded with LRU-style eviction.
- Cache persistence is best-effort: quota restrictions, private browsing, or IndexedDB failures should not prevent a successful translation from being displayed.
- Cached source text and translated text are stored locally in IndexedDB when that cache is enabled. Do not pass secrets or sensitive personal data to translation providers unless your application's privacy policy permits it.
- “Browser-local” means application text is not sent to a translation inference API by these providers; model files may still be downloaded from a model host.

## Production checklist

Before shipping to production, validate at least:

- Native Translator support in each target browser and language pair.
- Transformers.js model availability, language coverage, licenses, bundle/model download size, memory use, and output quality.
- React StrictMode, unmounts, rapid locale switching, duplicate requests, cache failures, quota exhaustion, and offline startup.
- Browser tests for IndexedDB persistence across reloads and cache reuse without another inference call.
- Accessibility and layout changes caused by translated text, including right-to-left languages if supported.
- Your own privacy, consent, and content-security requirements.

## License

See [LICENSE](./LICENSE). Third-party model and runtime licenses are separate and must be reviewed independently.
