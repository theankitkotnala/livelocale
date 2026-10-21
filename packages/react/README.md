# @livelocale/react

React hooks and context for LiveLocale. Source text renders immediately, while translation requests run in effects after render. This keeps model or provider work out of React rendering and provides a source-text fallback while translation is pending or unavailable.

- [Repository and full guide](https://github.com/theankitkotnala/livelocale#readme)
- [Changelog and issues](https://github.com/theankitkotnala/livelocale/issues)

## Install

```sh
npm install @livelocale/react @livelocale/core @livelocale/browser
```

React `>=18.2.0` is a peer dependency. For local-model fallback, also install `@livelocale/transformers-provider`.

## Configure the provider

Create browser integrations and the translation provider once, then pass runtime options to `LocaleProvider`:

```tsx
import { LocaleProvider } from '@livelocale/react';
import { createBrowserDefaults } from '@livelocale/browser';
import { FallbackTranslationProvider } from '@livelocale/core';
import { TransformersTranslationProvider } from '@livelocale/transformers-provider';

const browser = createBrowserDefaults();
const translationProvider = new FallbackTranslationProvider([
  browser.provider,
  new TransformersTranslationProvider(),
]);

export function AppRoot() {
  return (
    <LocaleProvider config={{
      sourceLocale: 'en',
      locale: 'fr',
      supportedLocales: ['en', 'fr', 'de'],
      provider: translationProvider,
      cache: browser.cache,
      onError: (error, request) => console.warn('Translation failed', request, error),
    }}>
      <App />
    </LocaleProvider>
  );
}
```

The native browser API is attempted first. Transformers.js is used if the native provider does not support the pair or its translation fails. If no provider succeeds, source text remains visible. For browser-native-only use, omit `TransformersTranslationProvider` and its package.

`LocaleProvider` captures `config` on mount. To replace the runtime configuration (for example, to swap providers), change the React `key` on `LocaleProvider` so React creates a fresh runtime.

## Translate a message

```tsx
import { useTranslation } from '@livelocale/react';

function Greeting({ name }: { name: string }) {
  const greeting = useTranslation('Welcome, {name}', {
    values: { name },
    context: 'A friendly greeting shown on the home screen',
  });

  return (
    <p aria-live="polite">
      {greeting.text}
      {greeting.status === 'loading' && <small> Translating…</small>}
    </p>
  );
}
```

`useTranslation()` returns `{ text, status, locale, error? }`. Status is `source`, `loading`, `translated`, or `error`. It shows interpolated source text immediately and requests translation from an effect. The runtime reports provider errors to `onError`; render the source text on errors and avoid exposing internal error details to end users.

`values` are interpolated after translation. Placeholders such as `{name}` are protected while the message is translated. Keep placeholders in the source message exactly where their values belong semantically.

## Translate a set of messages

For a screen with several messages, use a stable list of source messages:

```tsx
import { useTranslations } from '@livelocale/react';

const PROFILE_MESSAGES = ['Save changes', 'Cancel', 'Your profile'];

function ProfileActions() {
  const { t, status } = useTranslations(PROFILE_MESSAGES);

  return (
    <>
      <button>{t('Save changes')}</button>
      <button>{t('Cancel')}</button>
      <p>{t('Your profile')}</p>
      <small>{status('Save changes')}</small>
    </>
  );
}
```

The array is a list of original messages that should be preloaded, not a translated catalog. Keep it stable (for example, at module scope) to avoid unnecessary preload work. Messages are requested after the component mounts.

## Change locale and format values

```tsx
import { useLocale } from '@livelocale/react';

function LanguageMenu() {
  const { locale, sourceLocale, setLocale, format } = useLocale();

  return (
    <>
      <label>
        Language
        <select value={locale} onChange={(event) => setLocale(event.target.value)}>
          <option value={sourceLocale}>English</option>
          <option value="fr">Français</option>
          <option value="de">Deutsch</option>
        </select>
      </label>
      <p>{format.currency(1299.5, { currency: 'EUR' })}</p>
      <p>{format.date(new Date(), { dateStyle: 'medium' })}</p>
    </>
  );
}
```

`setLocale()` updates the runtime and subscribed components. Pass only configured locales when `supportedLocales` is set. `format` uses native `Intl` formatting for the current locale.

`useLocale().t(message, values?, context?)` is a pure synchronous lookup. It returns a cached translation when available or source text otherwise; it does not start translation work. Use `useTranslation`, `useTranslations`, or `useLocale().preload(locale, messages)` to request translations.

## Preload additional locales

By default, `useTranslations()` preloads its messages for the active locale. Configure extra locales in the provider if the same screen should prepare more than one locale:

```tsx
<LocaleProvider config={{
  sourceLocale: 'en',
  locale: 'fr',
  supportedLocales: ['en', 'fr', 'de'],
  preLoadLangOptions: ['fr', 'de'],
  provider: translationProvider,
  cache: browser.cache,
}}>
  <App />
</LocaleProvider>
```

Use `preLoadLangOptions: 'all'` to prepare every locale in `supportedLocales`. This requires `supportedLocales`. Work is sequential and can take time, particularly with local models. Components that have not mounted have not supplied their messages yet, so their messages are not preloaded.

## Exports

- `LocaleProvider`: creates a runtime and makes it available to descendant hooks.
- `useLocale()`: current and source locale, `setLocale`, synchronous `t`, formatting helpers, `preload`, `clearCache`, and the runtime instance.
- `useTranslation(message, options?)`: one message with status and optional `values`, `context`, or explicit `locale`.
- `useTranslations(messages)`: preload a list of messages and return `t` and `status` lookups.

All hooks must be called below a `LocaleProvider`.

## License

MIT. See [LICENSE](./LICENSE).
