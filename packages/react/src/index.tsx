import React, { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  createLocaleRuntime,
  formatForLocale,
  type LocaleRuntime,
  type RuntimeOptions,
  type TranslationStatus,
} from '@livelocale/core';

const LocaleContext = createContext<LocaleRuntime | null>(null);

export interface LocaleProviderProps {
  /** Runtime configuration is captured on mount. Change the provider's React key to replace the runtime. */
  config: RuntimeOptions;
  children: React.ReactNode;
}

export function LocaleProvider({ config, children }: LocaleProviderProps) {
  const runtime = useMemo(() => createLocaleRuntime(config), []);
  const lifecycle = useRef(0);
  useEffect(() => {
    const generation = ++lifecycle.current;
    return () => {
      // Defer disposal by one microtask so React StrictMode's effect replay can reattach.
      queueMicrotask(() => {
        if (lifecycle.current === generation) void runtime.dispose();
      });
    };
  }, [runtime]);
  return <LocaleContext.Provider value={runtime}>{children}</LocaleContext.Provider>;
}

function useRuntime(): LocaleRuntime {
  const runtime = useContext(LocaleContext);
  if (!runtime) throw new Error('LiveLocale hooks must be used inside <LocaleProvider>.');
  return runtime;
}

export function useLocale() {
  const runtime = useRuntime();
  useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
  const locale = runtime.getLocale();
  return useMemo(() => ({
    locale,
    sourceLocale: runtime.getSourceLocale(),
    setLocale: (nextLocale: string) => runtime.setLocale(nextLocale),
    /** Pure synchronous lookup: returns source text until a translation is available. */
    t: (message: string, values?: Record<string, unknown>, context?: string) => runtime.t(message, values, context),
    format: formatForLocale(locale),
    preload: (nextLocale: string, messages: Array<{ text: string; context?: string }>) => runtime.preload(nextLocale, messages),
    clearCache: () => runtime.clearCache(),
    runtime,
  }), [runtime, locale]);
}

/**
 * Preload a stable list of source messages for the active locale. This is useful for
 * translating a screen without maintaining a translated catalog.
 */
export function useTranslations(messages: readonly string[]) {
  const runtime = useRuntime();
  const locale = runtime.getLocale();
  useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
  const messagesKey = JSON.stringify(messages);

  useEffect(() => {
    const parsed = JSON.parse(messagesKey) as string[];
    void runtime.preload(locale, parsed.map((text) => ({ text }))).catch(() => {
      // Per-message failures are exposed by the runtime and onError callback.
    });
  }, [runtime, locale, messagesKey]);

  return {
    locale,
    t: (message: string, values?: Record<string, unknown>, context?: string) =>
      runtime.getTranslationView(message, values, context, locale).text,
    status: (message: string, context?: string) =>
      runtime.getTranslationView(message, undefined, context, locale).status,
  };
}

export interface UseTranslationOptions {
  context?: string;
  locale?: string;
  values?: Record<string, unknown>;
}

export interface UseTranslationResult {
  text: string;
  status: TranslationStatus;
  locale: string;
  error?: unknown;
}

/**
 * Translate one message without starting asynchronous work during render.
 * The source message renders immediately; translation is requested in an effect.
 */
export function useTranslation(message: string, options: UseTranslationOptions = {}): UseTranslationResult {
  const runtime = useRuntime();
  const locale = options.locale ?? runtime.getLocale();
  useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
  const view = runtime.getTranslationView(message, options.values, options.context, locale);

  useEffect(() => {
    void runtime.translate(message, { context: options.context, locale }).catch(() => {
      // The runtime exposes failures as a view state and invokes its configured onError handler.
    });
  }, [runtime, message, options.context, locale]);

  return view;
}
