import assert from 'node:assert/strict';
import { NativeBrowserTranslator } from '../packages/browser/dist/index.js';

let availabilityCalls = 0;
let createCalls = 0;
let destroyCalls = 0;
globalThis.window = {
  Translator: {
    async availability({ sourceLanguage, targetLanguage }) {
      availabilityCalls++;
      return sourceLanguage === 'en' && targetLanguage === 'fr' ? 'available' : 'unavailable';
    },
    async create({ sourceLanguage, targetLanguage }) {
      createCalls++;
      return {
        async translate(text) { return `[${sourceLanguage}->${targetLanguage}] ${text}`; },
        destroy() { destroyCalls++; },
      };
    },
  },
};

const provider = new NativeBrowserTranslator();
assert.equal(await provider.supports('en', 'fr'), true);
assert.equal(await provider.supports('en', 'fr'), true);
assert.equal(availabilityCalls, 1, 'availability checks should be deduplicated');
assert.equal(await provider.supports('en', 'ja'), false);
assert.equal(await provider.translate({ text: 'Hello', sourceLocale: 'en', targetLocale: 'fr' }), '[en->fr] Hello');
assert.equal(await provider.translate({ text: 'Welcome', sourceLocale: 'en', targetLocale: 'fr' }), '[en->fr] Welcome');
assert.equal(createCalls, 1, 'native translator instances should be reused per language pair');
await provider.dispose();
assert.equal(destroyCalls, 1, 'native translator instances should be destroyed on dispose');

delete globalThis.window;
assert.equal(await provider.supports('en', 'fr'), false, 'provider must be SSR-safe');
console.log('LiveLocale browser provider smoke tests passed');
