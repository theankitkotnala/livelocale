# @livelocale/browser

Browser-local provider integrations for LiveLocale: the native browser Translator API and an IndexedDB-backed bounded translation cache.

`createBrowserDefaults()` does not include a model-based fallback. The native Translator API is unavailable in Safari and other browsers without that browser feature. To translate in those browsers, install `@livelocale/transformers-provider` and compose `browser.provider` with `TransformersTranslationProvider` using `FallbackTranslationProvider` from `@livelocale/core`. The local model may require a large first-time download and suitable device memory.

See the [root README](../../README.md) for setup, privacy notes, and usage. Native Translator API support varies by browser and language pair.
