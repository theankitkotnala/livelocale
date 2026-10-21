# @livelocale/browser

Browser integrations for LiveLocale: a provider for the native browser Translator API and a bounded IndexedDB translation cache. This package does not include a translation model or a server translation API.

- [Repository and full guide](https://github.com/theankitkotnala/livelocale#readme)
- [Changelog and issues](https://github.com/theankitkotnala/livelocale/issues)

## Install

```sh
npm install @livelocale/browser @livelocale/core
```

`@livelocale/core` is installed as a dependency. Browser APIs are accessed when the provider or cache is used, so applications that also render on a server should create/use these integrations in browser-capable code.

## Quick start

```ts
import { createLocaleRuntime, FallbackTranslationProvider } from '@livelocale/core';
import { createBrowserDefaults } from '@livelocale/browser';

const browser = createBrowserDefaults();
const runtime = createLocaleRuntime({
  sourceLocale: 'en',
  locale: 'fr',
  supportedLocales: ['en', 'fr', 'de'],
  provider: new FallbackTranslationProvider([browser.provider]),
  cache: browser.cache,
  onError: (error) => console.warn('LiveLocale:', error),
});

const view = await runtime.translate('Good morning, {name}');
console.log(view.text, view.status);
// Translation is available only when the browser API supports this language pair.

await runtime.dispose(); // disposes the provider
```

The native browser Translator API is not available in every browser, user agent, or language pair. `NativeBrowserTranslator.supports()` checks for the feature and asks it about the requested pair. If unavailable, the runtime keeps source text visible. `createBrowserDefaults()` does not automatically install a model-based fallback.

## Add a local-model fallback

For browsers without the native API, compose the native provider with the optional Transformers.js provider:

```sh
npm install @livelocale/transformers-provider
```

```ts
import { FallbackTranslationProvider } from '@livelocale/core';
import { createBrowserDefaults } from '@livelocale/browser';
import { TransformersTranslationProvider } from '@livelocale/transformers-provider';

const browser = createBrowserDefaults();
const provider = new FallbackTranslationProvider([
  browser.provider,                         // try the browser's native API first
  new TransformersTranslationProvider(),    // then local model inference
]);
```

The model may be large and downloaded on first use. See the [Transformers provider README](../transformers-provider/README.md) for model, language coverage, and deployment considerations.

## Exports

### `createBrowserDefaults()`

Returns `{ provider, cache }`, where `provider` is a `NativeBrowserTranslator` and `cache` is an `IndexedDbTranslationCache`. To customize persistent storage, instantiate the cache directly:

```ts
import { IndexedDbTranslationCache, NativeBrowserTranslator } from '@livelocale/browser';

const browser = {
  provider: new NativeBrowserTranslator(),
  cache: new IndexedDbTranslationCache('my-app-translations', 'translations', 3000),
};
```

### `NativeBrowserTranslator`

Implements the core `TranslationProvider` interface using `window.Translator`. It reuses translator instances for language pairs and releases them when `dispose()` is called. It returns unsupported during server-side execution or when the browser feature is missing.

### `IndexedDbTranslationCache`

Implements the core `TranslationCache` interface. Constructor parameters are `dbName` (default `livelocale-cache-v1`), `storeName` (default `translations`), and `maxEntries` (default `5000`). Reads update use time and writes evict least-recently-used records over the bound. `clear()` removes all records in the configured store.

LiveLocale treats cache storage as best-effort: an IndexedDB error is reported through `onError`, but does not discard a successful translation. If IndexedDB is unavailable (including some private browsing contexts), use the default in-memory cache from core or provide a cache suitable for your environment.

## Privacy and storage

When enabled, IndexedDB stores the source-message key and translated text in the user's browser profile. The browser provider sends the text to the browser's built-in Translator implementation; behavior and model availability are controlled by the browser. Review your app's privacy requirements before translating sensitive content. Clear persisted translations with `await browser.cache.clear()`.

## License

MIT. See [LICENSE](./LICENSE).
