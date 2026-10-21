# @livelocale/core

Framework-agnostic runtime primitives for translating application messages at runtime. Use this package directly in any JavaScript or TypeScript application, or as the foundation for the LiveLocale browser and React packages.

- [Repository and full guide](https://github.com/theankitkotnala/livelocale#readme)
- [Changelog and issues](https://github.com/theankitkotnala/livelocale/issues)

## Install

```sh
npm install @livelocale/core
```

Requires a modern JavaScript runtime with `Intl` support. The package has no framework dependency.

## Quick start

A translation provider supplies the actual translation operation. This example uses a small illustrative provider; applications can use `@livelocale/browser`, `@livelocale/transformers-provider`, or their own implementation.

```ts
import { createLocaleRuntime } from '@livelocale/core';

const provider = {
  id: 'example-dictionary-v1',
  async supports(sourceLocale, targetLocale) {
    return sourceLocale === 'en' && targetLocale === 'fr';
  },
  async translate({ text }) {
    return text.replace('Welcome', 'Bienvenue');
  },
};

const runtime = createLocaleRuntime({
  sourceLocale: 'en',
  locale: 'fr',
  supportedLocales: ['en', 'fr'],
  provider,
});

// Synchronous and side-effect free: shows source text until available.
console.log(runtime.t('Welcome, {name}', { name: 'Ada' }));

// Explicitly request translation, then look it up synchronously.
await runtime.translate('Welcome, {name}');
console.log(runtime.t('Welcome, {name}', { name: 'Ada' }));
// => "Bienvenue, Ada"

await runtime.dispose();
```

The source message is displayed immediately. If no provider is configured, the active locale is the source locale, or a translation fails, the source text remains a safe fallback.

## Runtime API

### `createLocaleRuntime(options)`

Creates a `LocaleRuntime`. `sourceLocale` is required; `locale` defaults to it. Locale tags are canonicalized with `Intl.getCanonicalLocales`. If `supportedLocales` is supplied, it validates the initial locale, later calls to `setLocale`, and requested translation locales. The source locale is always included.

```ts
const runtime = createLocaleRuntime({
  sourceLocale: 'en',
  locale: 'de',
  supportedLocales: ['en', 'de', 'fr'],
  provider,
  onError(error, request) {
    console.error(`Translation failed: ${request.sourceLocale} → ${request.targetLocale}`, error);
  },
  glossaryVersion: '2026-01',
  maxMemoryEntries: 1000,
});
```

Options:

- `sourceLocale`: locale of the messages passed to the runtime.
- `locale`: initial target locale; defaults to `sourceLocale`.
- `supportedLocales`: optional allowlist of locale tags.
- `provider`: an object implementing `TranslationProvider`.
- `cache`: an object implementing `TranslationCache`; defaults to `MemoryTranslationCache`.
- `onError`: callback for provider and cache errors. A throwing callback is ignored so it cannot interrupt rendering.
- `glossaryVersion`: changes translation cache identity when glossary or terminology behavior changes.
- `maxMemoryEntries`: bound for runtime memory views and translations; defaults to `1000`.
- `preLoadLangOptions`: extra target locales included by every `preload()` call. Use an array of locales or `'all'` (which requires `supportedLocales`). The requested locale is always included, and the source locale is skipped.

### Synchronous lookup and asynchronous translation

- `runtime.t(message, values?, context?)` returns a cached translation if available, otherwise interpolates and returns the source message. It never starts translation work.
- `runtime.getTranslationView(message, values?, context?, targetLocale?)` returns `{ text, status, locale, error? }` without requesting translation.
- `runtime.translate(message, { context?, locale? })` explicitly requests a translation and resolves to a `TranslationView`. Failures are returned as an `error` view and reported to `onError`; they do not reject for provider failures.
- `runtime.preload(locale, messages)` translates an array of `{ text, context? }` messages sequentially. With `preLoadLangOptions`, it also processes the configured locales sequentially to limit model memory pressure.
- `runtime.setLocale(locale)` changes the target locale and notifies subscribers.
- `runtime.subscribe(listener)` subscribes to runtime changes and returns an unsubscribe function. `runtime.getSnapshot()` is suitable for external-store integrations.
- `runtime.clearCache()` clears runtime memory and the configured translation cache.
- `runtime.dispose()` releases provider resources and makes the runtime unusable for further translations.

Translation statuses are `source`, `loading`, `translated`, and `error`. `{name}` style placeholders are protected during translation and restored afterward; a provider result that removes or duplicates a placeholder is treated as an error. Pass `values` to `t()` or `getTranslationView()` for interpolation; `null` and missing values leave the placeholder unchanged.

## Providers and caches

Implement `TranslationProvider` with a stable `id`, `supports(sourceLocale, targetLocale)`, and `translate(request)`. A request contains `text`, `sourceLocale`, `targetLocale`, and optional `context` and `signal`. Optional `initialize()` and `dispose()` methods can manage provider resources.

`FallbackTranslationProvider` tries providers in order, moving to the next provider when a pair is unsupported or translation fails. It propagates abort errors. Its `dispose()` disposes every child provider.

Implement `TranslationCache` with async `get(key)`, `set(record)`, and `clear()` methods. `MemoryTranslationCache` is included and defaults to `2000` entries:

```ts
import { MemoryTranslationCache } from '@livelocale/core';

const cache = new MemoryTranslationCache(500);
```

Cache keys include source and target locales, original message, context, glossary version, provider identity, and schema version. Keep a provider's `id` stable for identical behavior and change it when behavior changes so stale translations are not reused.

## Locale-aware formatting

`formatForLocale(locale)` returns helpers backed by the platform's `Intl` APIs:

```ts
import { formatForLocale } from '@livelocale/core';

const format = formatForLocale('de-DE');
format.number(1234.5);                              // "1.234,5"
format.currency(1234.5, { currency: 'EUR' });      // locale-formatted euro amount
format.date(new Date(), { dateStyle: 'medium' });
format.plural(3);                                   // locale plural category
format.list(['Äpfel', 'Birnen']);
```

## License

MIT. See [LICENSE](./LICENSE).
