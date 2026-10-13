export type TranslationStatus = 'source' | 'loading' | 'translated' | 'error';

export interface TranslationRequest {
  text: string;
  sourceLocale: string;
  targetLocale: string;
  context?: string;
  signal?: AbortSignal;
}

export interface TranslationProvider {
  /** Stable identity for this provider configuration; bump it when translation behavior changes. */
  readonly id: string;
  supports(sourceLocale: string, targetLocale: string): Promise<boolean>;
  initialize?(options?: { signal?: AbortSignal }): Promise<void>;
  translate(request: TranslationRequest): Promise<string>;
  dispose?(): Promise<void> | void;
}


export class FallbackTranslationProvider implements TranslationProvider {
  readonly id: string;
  private readonly supportCache = new Map<string, Promise<boolean>>();
  constructor(private readonly providers: TranslationProvider[]) {
    this.id = providers.map((provider) => provider.id).join('+') || 'no-provider';
  }
  async supports(sourceLocale: string, targetLocale: string): Promise<boolean> {
    const key = `${sourceLocale}|${targetLocale}`;
    let pending = this.supportCache.get(key);
    if (!pending) {
      pending = (async () => {
        for (const provider of this.providers) {
          try { if (await provider.supports(sourceLocale, targetLocale)) return true; } catch { /* Try the next provider. */ }
        }
        return false;
      })();
      this.supportCache.set(key, pending);
    }
    return pending;
  }
  async translate(request: TranslationRequest): Promise<string> {
    const errors: unknown[] = [];
    for (const provider of this.providers) {
      try {
        if (!(await provider.supports(request.sourceLocale, request.targetLocale))) continue;
        return await provider.translate(request);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error;
        errors.push(error);
      }
    }
    throw new AggregateError(errors, `No translation provider succeeded for ${request.sourceLocale} → ${request.targetLocale}`);
  }
  async dispose(): Promise<void> {
    await Promise.all(this.providers.map(async (provider) => provider.dispose?.()));
  }
}

export interface CacheRecord {
  key: string;
  value: string;
  createdAt: number;
  lastUsedAt: number;
  providerId: string;
}

export interface TranslationCache {
  get(key: string): Promise<CacheRecord | undefined>;
  set(record: CacheRecord): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryTranslationCache implements TranslationCache {
  private readonly records = new Map<string, CacheRecord>();
  private readonly maxEntries: number;
  constructor(maxEntries = 2000) { this.maxEntries = Math.max(1, Math.floor(maxEntries)); }

  async get(key: string): Promise<CacheRecord | undefined> {
    const record = this.records.get(key);
    if (!record) return undefined;
    record.lastUsedAt = Date.now();
    this.records.delete(key);
    this.records.set(key, record);
    return { ...record };
  }

  async set(record: CacheRecord): Promise<void> {
    this.records.delete(record.key);
    this.records.set(record.key, { ...record });
    while (this.records.size > this.maxEntries) {
      const oldest = this.records.keys().next().value as string | undefined;
      if (!oldest) break;
      this.records.delete(oldest);
    }
  }

  async clear(): Promise<void> { this.records.clear(); }
}

export interface RuntimeOptions {
  sourceLocale: string;
  locale?: string;
  supportedLocales?: string[];
  /**
   * Extra locales to translate for every `preload()` call. Use `'all'` to
   * preload every supported locale, or a list to preload selected locales.
   * The active locale passed to `preload()` is always included.
   */
  preLoadLangOptions?: 'all' | readonly string[];
  provider?: TranslationProvider;
  cache?: TranslationCache;
  glossaryVersion?: string;
  onError?: (error: unknown, request: TranslationRequest) => void;
  /** Maximum number of resolved translations/views kept in runtime memory. Defaults to 1000. */
  maxMemoryEntries?: number;
}

export interface TranslationView {
  text: string;
  status: TranslationStatus;
  locale: string;
  error?: unknown;
}

function stableHash(value: string): string {
  // FNV-1a: stable cache key, not a cryptographic hash.
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function interpolate(message: string, values?: Record<string, unknown>): string {
  if (!values) return message;
  return message.replace(/\{([\w.-]+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined || value === null ? match : String(value);
  });
}

function protectPlaceholders(message: string): { protectedText: string; tokens: Array<{ marker: string; original: string }> } {
  const tokens: Array<{ marker: string; original: string }> = [];
  const protectedText = message.replace(/\{([\w.-]+)\}/g, (original) => {
    const marker = `LIVELocaleTOKEN${tokens.length}END`;
    tokens.push({ marker, original });
    return marker;
  });
  return { protectedText, tokens };
}

function restorePlaceholders(message: string, tokens: Array<{ marker: string; original: string }>): string {
  for (const token of tokens) {
    const occurrences = message.split(token.marker).length - 1;
    if (occurrences !== 1) {
      throw new Error(`Translation changed, removed, or duplicated a protected interpolation token (${token.marker}).`);
    }
  }
  return tokens.reduce((result, token) => result.split(token.marker).join(token.original), message);
}

export class LocaleRuntime {
  private locale: string;
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private readonly memory = new Map<string, string>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly views = new Map<string, TranslationView>();
  private readonly sourceLocale: string;
  private readonly supportedLocales: Set<string>;
  private readonly restrictLocales: boolean;
  private readonly preloadLocales: string[];
  private readonly cache: TranslationCache;
  private readonly provider?: TranslationProvider;
  private readonly onError?: RuntimeOptions['onError'];
  private readonly glossaryVersion: string;
  private readonly memoryLimit: number;
  private generation = 0;
  private disposed = false;

  constructor(options: RuntimeOptions) {
    const source = Intl.getCanonicalLocales(options.sourceLocale)[0];
    if (!source) throw new RangeError(`Invalid source locale: ${options.sourceLocale}`);
    const initial = Intl.getCanonicalLocales(options.locale ?? source)[0];
    if (!initial) throw new RangeError(`Invalid locale: ${options.locale}`);
    this.sourceLocale = source;
    this.locale = initial;
    this.restrictLocales = options.supportedLocales !== undefined;
    this.supportedLocales = new Set((options.supportedLocales ?? [source]).map((tag) => {
      const canonical = Intl.getCanonicalLocales(tag)[0];
      if (!canonical) throw new RangeError(`Invalid supported locale: ${tag}`);
      return canonical;
    }));
    this.supportedLocales.add(source);
    if (options.preLoadLangOptions === 'all') {
      if (options.supportedLocales === undefined) {
        throw new RangeError("preLoadLangOptions: 'all' requires supportedLocales to be configured.");
      }
      this.preloadLocales = [...this.supportedLocales];
    } else if (Array.isArray(options.preLoadLangOptions)) {
      this.preloadLocales = options.preLoadLangOptions.map((tag) => {
        const canonical = Intl.getCanonicalLocales(tag)[0];
        if (!canonical) throw new RangeError(`Invalid preload locale: ${tag}`);
        if (this.restrictLocales && !this.supportedLocales.has(canonical)) {
          throw new RangeError(`Preload locale is not in supportedLocales: ${canonical}`);
        }
        return canonical;
      });
    } else {
      this.preloadLocales = [];
    }
    if (this.restrictLocales && !this.supportedLocales.has(initial)) {
      throw new RangeError(`Unsupported initial locale: ${initial}`);
    }
    this.memoryLimit = Math.max(1, Math.floor(options.maxMemoryEntries ?? 1000));
    this.cache = options.cache ?? new MemoryTranslationCache(this.memoryLimit);
    this.provider = options.provider;
    this.onError = options.onError;
    this.glossaryVersion = options.glossaryVersion ?? '1';
  }

  getLocale(): string { return this.locale; }
  getSourceLocale(): string { return this.sourceLocale; }
  getVersion(): number { return this.version; }
  getSnapshot = (): number => this.version;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  private remember<T>(map: Map<string, T>, key: string, value: T): void {
    map.delete(key);
    map.set(key, value);
    while (map.size > this.memoryLimit) {
      const oldest = map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }

  private canonicalLocale(locale: string): string {
    const canonical = Intl.getCanonicalLocales(locale)[0];
    if (!canonical) throw new RangeError(`Invalid locale: ${locale}`);
    if (this.restrictLocales && !this.supportedLocales.has(canonical)) {
      throw new RangeError(`Unsupported locale: ${canonical}`);
    }
    return canonical;
  }

  setLocale(locale: string): void {
    const canonical = this.canonicalLocale(locale);
    if (canonical === this.locale) return;
    this.locale = canonical;
    this.emit();
  }

  /** A pure, synchronous lookup. It never starts translation work during render. */
  t(message: string, values?: Record<string, unknown>, context?: string): string {
    return this.getTranslationView(message, values, context).text;
  }

  /** Read the currently available translation without starting asynchronous work. */
  getTranslationView(
    message: string,
    values?: Record<string, unknown>,
    context?: string,
    targetLocale = this.locale,
  ): TranslationView {
    const target = this.canonicalLocale(targetLocale);
    if (target === this.sourceLocale || !this.provider) {
      return { text: interpolate(message, values), status: 'source', locale: target };
    }
    const key = this.key(message, context, target);
    const current = this.views.get(key);
    const inMemory = this.memory.get(key);
    const translated = inMemory ?? (current?.status === 'translated' ? current.text : undefined);
    if (inMemory !== undefined) { this.memory.delete(key); this.memory.set(key, inMemory); }
    if (current) { this.views.delete(key); this.views.set(key, current); }
    return {
      text: interpolate(translated ?? message, values),
      status: translated !== undefined ? 'translated' : (current?.status ?? 'source'),
      locale: target,
      ...(current?.error ? { error: current.error } : {}),
    };
  }

  /** Explicitly request translation. React integrations call this from an effect, never render. */
  async translate(
    message: string,
    options: { context?: string; locale?: string } = {},
  ): Promise<TranslationView> {
    if (this.disposed) throw new Error('LocaleRuntime has been disposed. Create a new runtime to translate again.');
    const target = this.canonicalLocale(options.locale ?? this.locale);
    if (target === this.sourceLocale || !this.provider || message.length === 0 || message.trim().length === 0) {
      return { text: message, status: 'source', locale: target };
    }
    const key = this.key(message, options.context, target);
    await this.resolve(message, options.context, target, key);
    return this.getTranslationView(message, undefined, options.context, target);
  }

  private key(message: string, context: string | undefined, targetLocale: string): string {
    // Store the full identity rather than a short non-cryptographic hash to avoid collisions.
    return JSON.stringify({
      schema: 2,
      sourceLocale: this.sourceLocale,
      targetLocale,
      message,
      context: context ?? '',
      glossaryVersion: this.glossaryVersion,
      providerId: this.provider?.id ?? 'none',
    });
  }

  private reportError(error: unknown, request: TranslationRequest): void {
    try { this.onError?.(error, request); } catch { /* User error handlers must not break the runtime. */ }
  }

  private async resolve(message: string, context: string | undefined, targetLocale: string, key: string): Promise<void> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    if (!this.provider) return;
    const generation = this.generation;
    const request: TranslationRequest = {
      text: message,
      sourceLocale: this.sourceLocale,
      targetLocale,
      ...(context ? { context } : {}),
    };
    this.remember(this.views, key, { text: message, status: 'loading', locale: targetLocale });
    this.emit();

    const task = (async () => {
      try {
        try {
          const cached = await this.cache.get(key);
          if (generation !== this.generation || this.disposed) return;
          if (cached && typeof cached.value === 'string' && cached.value.length > 0) {
            this.remember(this.memory, key, cached.value);
            this.remember(this.views, key, { text: cached.value, status: 'translated', locale: targetLocale });
            this.emit();
            return;
          }
        } catch (cacheError) {
          this.reportError(cacheError, request);
        }

        if (!(await this.provider!.supports(this.sourceLocale, targetLocale))) {
          throw new Error(`Translation provider does not support ${this.sourceLocale} → ${targetLocale}`);
        }
        if (generation !== this.generation || this.disposed) return;
        const protectedMessage = protectPlaceholders(message);
        const rawTranslation = await this.provider!.translate({ ...request, text: protectedMessage.protectedText });
        if (generation !== this.generation || this.disposed) return;
        const translated = restorePlaceholders(rawTranslation, protectedMessage.tokens).trim();
        if (!translated) throw new Error('Translation provider returned an empty translation');
        this.remember(this.memory, key, translated);
        this.remember(this.views, key, { text: translated, status: 'translated', locale: targetLocale });
        this.emit();
        try {
          await this.cache.set({ key, value: translated, createdAt: Date.now(), lastUsedAt: Date.now(), providerId: this.provider!.id });
        } catch (cacheError) {
          // Persistence is best-effort. A storage failure must not discard a valid translation.
          this.reportError(cacheError, request);
        }
      } catch (error) {
        if (generation !== this.generation || this.disposed) return;
        this.remember(this.views, key, { text: message, status: 'error', locale: targetLocale, error });
        this.reportError(error, request);
        this.emit();
      }
    })().finally(() => {
      if (this.inFlight.get(key) === task) this.inFlight.delete(key);
    });
    this.inFlight.set(key, task);
    return task;
  }

  async preload(locale: string, messages: Array<{ text: string; context?: string }>): Promise<void> {
    const target = this.canonicalLocale(locale);
    if (!this.provider) return;
    const targets = [...new Set([target, ...this.preloadLocales])]
      .filter((preloadLocale) => preloadLocale !== this.sourceLocale);
    // Process locales one at a time to avoid multiplying model work and memory
    // pressure when a screen opts into preloading many languages. Messages are
    // also sequential so a single local model is not asked to infer in parallel.
    for (const preloadLocale of targets) {
      for (const item of messages) {
        await this.translate(item.text, { context: item.context, locale: preloadLocale });
      }
    }
  }

  async clearCache(): Promise<void> {
    this.generation++;
    this.inFlight.clear();
    this.memory.clear();
    this.views.clear();
    this.emit();
    await this.cache.clear();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.inFlight.clear();
    this.listeners.clear();
    await this.provider?.dispose?.();
  }
}

export function createLocaleRuntime(options: RuntimeOptions): LocaleRuntime {
  return new LocaleRuntime(options);
}

export function formatForLocale(locale: string) {
  return {
    number(value: number, options?: Intl.NumberFormatOptions) {
      return new Intl.NumberFormat(locale, options).format(value);
    },
    currency(value: number, options: { currency: string } & Omit<Intl.NumberFormatOptions, 'style' | 'currency'>) {
      return new Intl.NumberFormat(locale, { ...options, style: 'currency', currency: options.currency }).format(value);
    },
    date(value: Date | number, options?: Intl.DateTimeFormatOptions) {
      return new Intl.DateTimeFormat(locale, options).format(value);
    },
    plural(value: number, options?: Intl.PluralRulesOptions) {
      return new Intl.PluralRules(locale, options).select(value);
    },
    list(values: string[], options?: Intl.ListFormatOptions) {
      return new Intl.ListFormat(locale, options).format(values);
    },
  };
}
