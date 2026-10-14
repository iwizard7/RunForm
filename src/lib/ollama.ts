export type OllamaRequest = {
  system: string;
  prompt: string;
  model?: string;
  /** Base64 images for vision models (e.g. workout screenshots). */
  images?: string[];
};

export type OllamaCallOptions = {
  /**
   * Reuse the previous answer for the same system+prompt+model instead of
   * calling the model again. Only sensible for one-shot text generations
   * (readiness, flags, advice) whose inputs rarely change within a session.
   */
  cache?: boolean;
  /** Time-to-live for cached answers. Defaults to 60 minutes. */
  cacheTtlMs?: number;
  /**
   * Raise the proxy route's non-stream timeout for long generations (a
   * multi-week race plan can take minutes on a small local model). Clamped
   * server-side to 5..300 s; the default non-stream budget is 45 s.
   */
  timeoutMs?: number;
};

const MODEL_STORAGE_KEYS = {
  text: 'runform.aiModel',
  vision: 'runform.aiVisionModel',
} as const;

const CACHE_KEY_PREFIX = 'runform.aicache.v1.';
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 40;
const MAX_CACHE_TEXT_CHARS = 20_000;

/**
 * Reads the model picked in Settings. An empty/missing value falls back to
 * the server default (env or qwen3:4b), so the picker is optional.
 */
function selectedModel(hasImages: boolean): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  try {
    const key = hasImages ? MODEL_STORAGE_KEYS.vision : MODEL_STORAGE_KEYS.text;
    const value = window.localStorage.getItem(key);
    return value && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

function resolveRequestModel(params: OllamaRequest): string | undefined {
  return params.model ?? selectedModel((params.images?.length ?? 0) > 0);
}

/**
 * Stable cache key for an answer: a double FNV-1a pass over model, system
 * prompt and prompt. Collisions would only ever reuse a wrong-but-similar
 * answer for the same local user, and the second pass makes them unlikely.
 */
export function buildCacheKey(system: string, prompt: string, model: string | undefined): string {
  const input = `${model ?? 'default'} ${system} ${prompt}`;
  let forward = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    forward ^= input.charCodeAt(i);
    forward = Math.imul(forward, 0x01000193) >>> 0;
  }
  let backward = 0x811c9dc5;
  for (let i = input.length - 1; i >= 0; i--) {
    backward ^= input.charCodeAt(i);
    backward = Math.imul(backward, 0x01000193) >>> 0;
  }
  return `${forward.toString(36)}-${backward.toString(36)}-${input.length}`;
}

function readCachedAnswer(key: string, ttlMs: number): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as { t?: number; text?: string };
    if (typeof entry.text !== 'string' || !entry.text) return null;
    if (typeof entry.t !== 'number' || Date.now() - entry.t > ttlMs) {
      window.localStorage.removeItem(CACHE_KEY_PREFIX + key);
      return null;
    }
    return entry.text;
  } catch {
    return null;
  }
}

function writeCachedAnswer(key: string, text: string): void {
  if (typeof window === 'undefined' || !text || text.length > MAX_CACHE_TEXT_CHARS) return;
  try {
    // Prune expired entries and cap the count so the cache cannot grow into
    // a quota error over weeks of use.
    const now = Date.now();
    const stamped: Array<{ key: string; t: number }> = [];
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const storageKey = window.localStorage.key(i);
      if (!storageKey || !storageKey.startsWith(CACHE_KEY_PREFIX)) continue;
      let t = 0;
      try {
        const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}') as { t?: number };
        t = typeof parsed.t === 'number' ? parsed.t : 0;
      } catch {
        t = 0;
      }
      if (now - t > DEFAULT_CACHE_TTL_MS) {
        window.localStorage.removeItem(storageKey);
      } else {
        stamped.push({ key: storageKey, t });
      }
    }
    if (stamped.length >= MAX_CACHE_ENTRIES) {
      stamped.sort((a, b) => a.t - b.t);
      for (const stale of stamped.slice(0, stamped.length - MAX_CACHE_ENTRIES + 1)) {
        window.localStorage.removeItem(stale.key);
      }
    }
    window.localStorage.setItem(CACHE_KEY_PREFIX + key, JSON.stringify({ t: now, text }));
  } catch {
    // Storage full or disabled — the answer is still shown, just not cached.
  }
}

/** Performs a regular blocking request and returns the full response text. */
export async function requestOllama(params: OllamaRequest, options?: OllamaCallOptions) {
  const model = resolveRequestModel(params);
  const cacheKey =
    options?.cache && (params.images?.length ?? 0) === 0
      ? buildCacheKey(params.system, params.prompt, model)
      : null;
  const ttl = options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

  if (cacheKey) {
    const cached = readCachedAnswer(cacheKey, ttl);
    if (cached !== null) {
      return { response: cached };
    }
  }

  const response = await fetch('/api/ollama', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...params, model, ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Ollama request failed');
  }

  const data = (await response.json()) as { response: string };
  if (cacheKey && data.response) {
    writeCachedAnswer(cacheKey, data.response);
  }
  return data;
}

/**
 * Streams the reply from Ollama. `onText` receives the accumulated text after
 * every chunk, which makes it trivial to drive React state while the model is
 * still generating. Returns the final full text.
 */
export async function streamOllama(
  params: OllamaRequest,
  onText: (fullText: string) => void,
  options?: OllamaCallOptions,
): Promise<string> {
  const model = resolveRequestModel(params);
  const cacheKey =
    options?.cache && (params.images?.length ?? 0) === 0
      ? buildCacheKey(params.system, params.prompt, model)
      : null;
  const ttl = options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

  if (cacheKey) {
    const cached = readCachedAnswer(cacheKey, ttl);
    if (cached !== null) {
      onText(cached);
      return cached;
    }
  }

  const response = await fetch('/api/ollama', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...params, model, stream: true }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Ollama request failed');
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Streaming is not supported in this browser.');
  }

  const decoder = new TextDecoder();
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    full += decoder.decode(value, { stream: true });
    onText(full);
  }
  onText(full);
  if (cacheKey && full) {
    writeCachedAnswer(cacheKey, full);
  }
  return full;
}
