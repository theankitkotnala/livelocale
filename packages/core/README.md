# @livelocale/core

Framework-agnostic runtime for LiveLocale. Exposes the translation-provider and cache interfaces, `LocaleRuntime`, a bounded memory cache, placeholder protection, and native `Intl` formatting helpers.

See the [root README](../../README.md) for setup and usage. `t()` is a pure synchronous lookup; call `runtime.translate()` or `runtime.preload()` to request translation work.

`RuntimeOptions.preLoadLangOptions` can be set to `'all'` or a list of locale tags. Each `preload()` call translates its messages for the requested locale plus the configured locales. `'all'` requires `supportedLocales`; it skips the source locale. This preloads message translations, not separate per-language model files.
