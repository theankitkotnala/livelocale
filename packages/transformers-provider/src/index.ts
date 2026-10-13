import type { TranslationProvider, TranslationRequest } from '@livelocale/core';

type TranslationPipeline = (text: string, options?: Record<string, unknown>) => Promise<unknown>;
type PipelineFactory = (task: string, model: string, options?: Record<string, unknown>) => Promise<TranslationPipeline>;

/**
 * M2M100 language codes supported by the default multilingual model.
 * Locale tags such as `fr-CA` are reduced to `fr` for this model.
 * This is a capability list, not a language-to-model mapping.
 */
const M2M100_LANGUAGES = new Set([
  'af', 'am', 'ar', 'ast', 'az', 'ba', 'be', 'bg', 'bn', 'br', 'bs', 'ca', 'ceb', 'cs', 'cv', 'cy',
  'da', 'de', 'el', 'en', 'es', 'et', 'fa', 'ff', 'fi', 'fr', 'fy', 'ga', 'gd', 'gl', 'gu', 'ha', 'he',
  'hi', 'hr', 'ht', 'hu', 'hy', 'id', 'ig', 'ilo', 'is', 'it', 'ja', 'jv', 'ka', 'kk', 'km', 'kn', 'ko',
  'lb', 'lg', 'ln', 'lo', 'lt', 'lv', 'mg', 'mk', 'ml', 'mn', 'mr', 'ms', 'my', 'ne', 'nl', 'no', 'ns',
  'ny', 'om', 'or', 'pa', 'pl', 'ps', 'pt', 'ro', 'ru', 'sd', 'si', 'sk', 'sl', 'so', 'sq', 'sr', 'ss',
  'su', 'sv', 'sw', 'ta', 'th', 'tl', 'tn', 'tr', 'uk', 'ur', 'uz', 'vi', 'wo', 'xh', 'yi', 'yo', 'zh', 'zu',
]);

export interface TransformersProviderOptions {
  /**
   * Multilingual model used by default. M2M100 accepts source/target language codes at inference time.
   * Model files may be downloaded on first use.
   */
  model?: string;
  /**
   * Optional advanced override for specialized pair-specific models. When provided, this callback
   * must return a compatible model ID for the requested pair. Most apps should omit it.
   */
  modelForPair?: (sourceLocale: string, targetLocale: string) => string | undefined;
  /** Bump this when a custom model mapping or model behavior changes, to invalidate old cache entries. */
  cacheVersion?: string;
  /** Optional pipeline options, e.g. device: 'webgpu' where supported. */
  pipelineOptions?: Record<string, unknown>;
  /** Limit the number of model pipelines retained in memory. */
  maxLoadedModels?: number;
}

/**
 * Browser-local translation using Transformers.js and a multilingual model by default.
 * No per-language model map is required. Application text is passed to local inference;
 * model assets may be downloaded from the configured model repository on first use.
 */
export class TransformersTranslationProvider implements TranslationProvider {
  readonly id: string;
  private readonly pipelines = new Map<string, Promise<TranslationPipeline>>();
  private inferenceQueue: Promise<void> = Promise.resolve();
  private readonly maxLoadedModels: number;
  private readonly model: string;
  private readonly usePairSpecificModels: boolean;

  constructor(private readonly options: TransformersProviderOptions = {}) {
    this.maxLoadedModels = Math.max(1, options.maxLoadedModels ?? 2);
    this.model = options.model ?? 'Xenova/m2m100_418M';
    this.usePairSpecificModels = typeof options.modelForPair === 'function';
    this.id = this.usePairSpecificModels
      ? `transformers-js-pair-models:${this.model}:${options.cacheVersion ?? '1'}`
      : `transformers-js-m2m100:${this.model}:${options.cacheVersion ?? '1'}`;
  }

  private languageCode(locale: string): string | undefined {
    try {
      return Intl.getCanonicalLocales(locale)[0]?.split('-')[0]?.toLowerCase();
    } catch {
      return undefined;
    }
  }

  private modelFor(sourceLocale: string, targetLocale: string): string | undefined {
    if (this.options.modelForPair) return this.options.modelForPair(sourceLocale, targetLocale);
    const source = this.languageCode(sourceLocale);
    const target = this.languageCode(targetLocale);
    return source && target && M2M100_LANGUAGES.has(source) && M2M100_LANGUAGES.has(target)
      ? this.model
      : undefined;
  }

  async supports(sourceLocale: string, targetLocale: string): Promise<boolean> {
    return typeof window !== 'undefined' && Boolean(this.modelFor(sourceLocale, targetLocale));
  }

  private async getPipeline(sourceLocale: string, targetLocale: string): Promise<TranslationPipeline> {
    const model = this.modelFor(sourceLocale, targetLocale);
    if (!model) throw new Error(`No local translation model supports ${sourceLocale} → ${targetLocale}`);
    const key = this.usePairSpecificModels
      ? `${sourceLocale}|${targetLocale}|${model}`
      : `multilingual|${model}`;
    let pending = this.pipelines.get(key);
    if (!pending) {
      pending = (async () => {
        const { pipeline } = await import('@huggingface/transformers');
        return (pipeline as unknown as PipelineFactory)('translation', model, this.options.pipelineOptions);
      })();
      this.pipelines.set(key, pending);
      void pending.catch(() => {
        if (this.pipelines.get(key) === pending) this.pipelines.delete(key);
      });
    } else {
      this.pipelines.delete(key);
      this.pipelines.set(key, pending);
    }
    while (this.pipelines.size > this.maxLoadedModels) {
      const oldestKey = this.pipelines.keys().next().value as string | undefined;
      if (!oldestKey || oldestKey === key) break;
      this.pipelines.delete(oldestKey);
    }
    return pending;
  }

  async translate(request: TranslationRequest): Promise<string> {
    if (typeof window === 'undefined') throw new Error('TransformersTranslationProvider requires a browser environment.');
    if (request.signal?.aborted) throw new DOMException('Translation aborted', 'AbortError');
    const pipeline = await this.getPipeline(request.sourceLocale, request.targetLocale);
    const options: Record<string, unknown> = {};
    // M2M100 is multilingual: the selected locale becomes a runtime inference option.
    // Pair-specific models generally encode the language pair in the model itself.
    if (!this.usePairSpecificModels) {
      options.src_lang = this.languageCode(request.sourceLocale);
      options.tgt_lang = this.languageCode(request.targetLocale);
    }
    // Keep browser inference single-file. Running many large decoder sessions at
    // once can exhaust memory and fail on constrained devices such as Safari.
    const inference = this.inferenceQueue.then(() => {
      if (request.signal?.aborted) throw new DOMException('Translation aborted', 'AbortError');
      return pipeline(request.text, options);
    });
    this.inferenceQueue = inference.then(() => undefined, () => undefined);
    const output = await inference;
    if (request.signal?.aborted) throw new DOMException('Translation aborted', 'AbortError');
    if (Array.isArray(output) && output.length > 0 && typeof output[0] === 'object' && output[0] !== null) {
      const row = output[0] as Record<string, unknown>;
      const value = row.translation_text ?? row.generated_text ?? row.text;
      if (typeof value === 'string') return value;
    }
    if (typeof output === 'string') return output;
    throw new Error('Local translation model returned an unsupported output shape.');
  }

  async dispose(): Promise<void> {
    this.pipelines.clear();
    await this.inferenceQueue;
  }
}
