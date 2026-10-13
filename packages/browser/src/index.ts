import type { CacheRecord, TranslationCache, TranslationProvider, TranslationRequest } from '@livelocale/core';

interface NativeTranslatorInstance {
  translate(text: string): Promise<string>;
  destroy?: () => void;
}
interface NativeTranslatorStatic {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(options: { sourceLanguage: string; targetLanguage: string; monitor?: (monitor: EventTarget) => void }): Promise<NativeTranslatorInstance>;
}

declare global {
  interface Window { Translator?: NativeTranslatorStatic }
}

export class NativeBrowserTranslator implements TranslationProvider {
  readonly id = 'native-browser-translator-v1';
  private readonly instances = new Map<string, Promise<NativeTranslatorInstance>>();
  private readonly availability = new Map<string, Promise<boolean>>();

  async supports(sourceLocale: string, targetLocale: string): Promise<boolean> {
    if (typeof window === 'undefined' || !window.Translator) return false;
    const key = `${sourceLocale}:${targetLocale}`;
    let pending = this.availability.get(key);
    if (!pending) {
      pending = (async () => {
        try {
          const availability = await window.Translator!.availability({ sourceLanguage: sourceLocale, targetLanguage: targetLocale });
          return availability === 'available' || availability === 'downloadable' || availability === 'downloading';
        } catch { return false; }
      })();
      this.availability.set(key, pending);
    }
    return pending;
  }

  async translate(request: TranslationRequest): Promise<string> {
    if (typeof window === 'undefined' || !window.Translator) {
      throw new Error('The browser Translator API is unavailable in this environment.');
    }
    const key = `${request.sourceLocale}:${request.targetLocale}`;
    let instance = this.instances.get(key);
    if (!instance) {
      instance = window.Translator.create({ sourceLanguage: request.sourceLocale, targetLanguage: request.targetLocale });
      this.instances.set(key, instance);
      void instance.catch(() => {
        if (this.instances.get(key) === instance) this.instances.delete(key);
      });
    }
    const translator = await instance;
    if (request.signal?.aborted) throw new DOMException('Translation aborted', 'AbortError');
    return translator.translate(request.text);
  }

  async dispose(): Promise<void> {
    for (const pending of this.instances.values()) {
      try { (await pending).destroy?.(); } catch { /* Ignore failed initialization during cleanup. */ }
    }
    this.instances.clear();
    this.availability.clear();
  }
}

export class IndexedDbTranslationCache implements TranslationCache {
  private dbPromise?: Promise<IDBDatabase>;
  constructor(private readonly dbName = 'livelocale-cache-v1', private readonly storeName = 'translations', maxEntries = 5000) {
    this.maxEntries = Math.max(1, Math.floor(maxEntries));
  }
  private readonly maxEntries: number;

  private open(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is unavailable'));
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) db.createObjectStore(this.storeName, { keyPath: 'key' });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); this.dbPromise = undefined; };
        resolve(db);
      };
      request.onerror = () => {
        this.dbPromise = undefined;
        reject(request.error ?? new Error('Failed to open IndexedDB'));
      };
      request.onblocked = () => {
        this.dbPromise = undefined;
        reject(new Error('IndexedDB upgrade is blocked by another open connection'));
      };
    });
    return this.dbPromise;
  }

  async get(key: string): Promise<CacheRecord | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      let result: CacheRecord | undefined;
      const request = store.get(key);
      request.onsuccess = () => {
        const record = request.result as CacheRecord | undefined;
        if (record) {
          record.lastUsedAt = Date.now();
          store.put(record);
          result = record;
        }
      };
      transaction.oncomplete = () => resolve(result ? { ...result } : undefined);
      transaction.onerror = () => reject(transaction.error ?? new Error('Cache read failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Cache read aborted'));
    });
  }

  async set(record: CacheRecord): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      store.put(record);
      const allRequest = store.getAll();
      allRequest.onsuccess = () => {
        const records = allRequest.result as CacheRecord[];
        if (records.length > this.maxEntries) {
          records.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
          for (const stale of records.slice(0, records.length - this.maxEntries)) store.delete(stale.key);
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Cache write failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Cache write aborted'));
    });
  }

  async clear(): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      transaction.objectStore(this.storeName).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Cache clear failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Cache clear aborted'));
    });
  }
}

export function createBrowserDefaults() {
  return {
    provider: new NativeBrowserTranslator(),
    cache: new IndexedDbTranslationCache(),
  };
}
