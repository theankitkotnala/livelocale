# @livelocale/transformers-provider

Optional browser-local translation provider for LiveLocale, powered by [Transformers.js](https://huggingface.co/docs/transformers.js). It runs a multilingual model in the browser; application message text is passed to local inference rather than to a LiveLocale translation API.

- [Repository and full guide](https://github.com/theankitkotnala/livelocale#readme)
- [Changelog and issues](https://github.com/theankitkotnala/livelocale/issues)

## Install

```sh
npm install @livelocale/transformers-provider @livelocale/core
```

`@livelocale/core` is installed as a dependency. This provider requires a browser environment for translation. It is not a Node.js or server-side translation provider.

## Quick start

```ts
import { createLocaleRuntime, FallbackTranslationProvider } from '@livelocale/core';
import { createBrowserDefaults } from '@livelocale/browser';
import { TransformersTranslationProvider } from '@livelocale/transformers-provider';

const browser = createBrowserDefaults();
const provider = new FallbackTranslationProvider([
  browser.provider, // use the native browser API when available
  new TransformersTranslationProvider(),
]);

const runtime = createLocaleRuntime({
  sourceLocale: 'en',
  locale: 'fr',
  supportedLocales: ['en', 'fr', 'de', 'hi'],
  provider,
  cache: browser.cache,
  onError: (error, request) => console.error('Translation failed', request, error),
});

const result = await runtime.translate('Hello, {name}');
console.log(result.text, result.status);
await runtime.dispose();
```

The default model is `Xenova/m2m100_418M`. It is multilingual: source and target language codes are selected for each inference request, so most applications do not need to configure a separate model per language pair. Locale tags such as `fr-CA` are reduced to their base language (`fr`) for this model.

## Model downloads and browser requirements

Transformers.js loads model assets when a supported pair is first translated. The browser may download a large model before the first result is available; subsequent calls reuse a loaded pipeline and LiveLocale can reuse completed translations from its cache. Plan for first-use latency, bandwidth, storage, memory, and offline behavior. The provider serializes inference requests and limits retained pipelines to reduce memory pressure.

Model support is limited to the model's language list. `supports()` returns `false` outside a browser or when either language is unsupported. Verify quality for your content and language pairs; machine translation may be inaccurate and should not replace human review for high-impact content.

Model files may be fetched from a model host. “Local inference” describes where message translation runs; it does not mean model downloads happen offline or that the app makes no network requests. Configure your CSP, asset hosting, and consent flow accordingly. Review the model and runtime licenses and terms for your distribution.

## Configuration

```ts
import { TransformersTranslationProvider } from '@livelocale/transformers-provider';

const provider = new TransformersTranslationProvider({
  model: 'Xenova/m2m100_418M', // this is already the default
  cacheVersion: '1',           // change when model behavior changes
  maxLoadedModels: 2,
  pipelineOptions: {
    // For example, opt into an execution device only after validating browser support.
    // device: 'webgpu',
  },
});
```

Options:

- `model`: Transformers.js model identifier; defaults to `Xenova/m2m100_418M`.
- `cacheVersion`: included in the provider identity. Bump it when model or inference behavior changes so previous translations are not reused.
- `maxLoadedModels`: maximum number of pipelines retained; defaults to `2` (minimum `1`). The default multilingual model shares one pipeline across pairs.
- `pipelineOptions`: options passed to Transformers.js `pipeline()`, such as a device setting supported by your target browsers.
- `modelForPair(sourceLocale, targetLocale)`: advanced callback returning a model identifier for a language pair, or `undefined` when unsupported. Use only when pair-specific models are intentional and validated. The default multilingual model is recommended for most applications.

Call `await provider.dispose()` (or dispose the runtime that owns it) when the application no longer needs the model pipelines.

## License

MIT. See [LICENSE](./LICENSE). The model and Transformers.js have separate licenses and usage terms; review them before distribution.
