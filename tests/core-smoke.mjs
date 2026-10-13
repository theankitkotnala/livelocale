import assert from 'node:assert/strict';
import {
  createLocaleRuntime,
  formatForLocale,
  MemoryTranslationCache,
} from '../packages/core/dist/index.js';

const runtime = createLocaleRuntime({ sourceLocale: 'en', locale: 'en' });
assert.equal(runtime.t('Hello, {name}', { name: 'Ada' }), 'Hello, Ada');
assert.equal(runtime.getLocale(), 'en');
runtime.setLocale('fr');
assert.equal(runtime.t('Hello, {name}', { name: 'Ada' }), 'Hello, Ada');
assert.equal(formatForLocale('de-DE').number(1234.5), '1.234,5');
assert.throws(() => runtime.setLocale('not_a_locale'), RangeError);

const cache = new MemoryTranslationCache(2);
await cache.set({ key: 'a', value: 'A', createdAt: 1, lastUsedAt: 1, providerId: 'test' });
await cache.set({ key: 'b', value: 'B', createdAt: 1, lastUsedAt: 1, providerId: 'test' });
await cache.set({ key: 'c', value: 'C', createdAt: 1, lastUsedAt: 1, providerId: 'test' });
assert.equal(await cache.get('a'), undefined);
assert.equal((await cache.get('c')).value, 'C');

let inferenceCalls = 0;
const mockProvider = {
  id: 'mock-v1',
  async supports() { return true; },
  async translate({ text }) {
    inferenceCalls++;
    return text.replace('Welcome', 'Bienvenue');
  },
};
const persistentCache = new MemoryTranslationCache();
const translated = createLocaleRuntime({
  sourceLocale: 'en', locale: 'fr', supportedLocales: ['en', 'fr'],
  provider: mockProvider, cache: persistentCache,
});
// t() is intentionally pure: it never starts model inference during React render.
assert.equal(translated.t('Welcome, {name}', { name: 'Ada' }), 'Welcome, Ada');
assert.equal(inferenceCalls, 0);
assert.equal(translated.getTranslationView('Welcome, {name}').status, 'source');
await translated.translate('Welcome, {name}');
assert.equal(inferenceCalls, 1);
assert.equal(translated.t('Welcome, {name}', { name: 'Ada' }), 'Bienvenue, Ada');
assert.equal(translated.getTranslationView('Welcome, {name}').status, 'translated');

// A new runtime can restore the same translation from the persistent cache without inference.
const cachedRuntime = createLocaleRuntime({
  sourceLocale: 'en', locale: 'fr', supportedLocales: ['en', 'fr'],
  provider: mockProvider, cache: persistentCache,
});
await cachedRuntime.translate('Welcome, {name}');
assert.equal(inferenceCalls, 1);
assert.equal(cachedRuntime.t('Welcome, {name}', { name: 'Ada' }), 'Bienvenue, Ada');

const unsupported = createLocaleRuntime({
  sourceLocale: 'en', locale: 'fr', provider: {
    id: 'unsupported',
    async supports() { return false; },
    async translate() { throw new Error('must not be called'); },
  },
});
await unsupported.translate('Keep source');
assert.equal(unsupported.getTranslationView('Keep source').status, 'error');
assert.equal(unsupported.t('Keep source'), 'Keep source');


// Concurrent requests for the same identity share one inference call.
let releaseTranslation;
let slowCalls = 0;
const slowRuntime = createLocaleRuntime({
  sourceLocale: 'en', locale: 'fr', provider: {
    id: 'slow-provider',
    async supports() { return true; },
    async translate({ text }) {
      slowCalls++;
      await new Promise((resolve) => { releaseTranslation = resolve; });
      return `FR:${text}`;
    },
  },
});
const firstRequest = slowRuntime.translate('Concurrent message');
const secondRequest = slowRuntime.translate('Concurrent message');
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(slowCalls, 1);
releaseTranslation();
await Promise.all([firstRequest, secondRequest]);
assert.equal(slowRuntime.t('Concurrent message'), 'FR:Concurrent message');

// Clearing while a request is in flight invalidates the old result.
let releaseStale;
const staleRuntime = createLocaleRuntime({
  sourceLocale: 'en', locale: 'fr', provider: {
    id: 'stale-provider',
    async supports() { return true; },
    async translate({ text }) {
      await new Promise((resolve) => { releaseStale = resolve; });
      return `STALE:${text}`;
    },
  },
});
const staleRequest = staleRuntime.translate('Clear me');
await new Promise((resolve) => setTimeout(resolve, 0));
await staleRuntime.clearCache();
releaseStale();
await staleRequest;
assert.equal(staleRuntime.t('Clear me'), 'Clear me');

console.log('LiveLocale core smoke tests passed');
