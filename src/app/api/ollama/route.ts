import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_OLLAMA_URL = 'http://localhost:11434/api/generate';
// qwen3:4b follows instructions better than qwen2.5:3b at a similar size,
// which matters for language adherence and JSON plans on 8 GB machines.
const DEFAULT_MODEL = 'qwen3:4b';
// Screenshots are understood by multimodal models; qwen2.5-vl stays local.
const DEFAULT_VISION_MODEL = 'qwen2.5-vl:3b';
const MODEL_PATTERN = /^[A-Za-z0-9._-]+(:[A-Za-z0-9._-]+)?$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const NON_STREAM_TIMEOUT_MS = 45_000;
const STREAM_TIMEOUT_MS = 300_000;
const MIN_TIMEOUT_MS = 5_000;

/**
 * Streaming keeps the connection alive for the full 300 s budget. For
 * non-streaming calls the default is the short 45 s budget, but long
 * generations (multi-week race plans) may raise it per request, clamped so a
 * client cannot pin a worker for longer than the streaming cap.
 */
function resolveTimeout(requested: number | undefined, stream: boolean): number {
  if (stream) return STREAM_TIMEOUT_MS;
  if (typeof requested !== 'number' || Number.isNaN(requested)) return NON_STREAM_TIMEOUT_MS;
  return Math.min(STREAM_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, requested));
}

/** Caps for the whitelisted generation options a client may forward. */
const MAX_NUM_CTX = 16_384;
const MAX_NUM_PREDICT = 8_192;

/**
 * Only num_ctx and num_predict cross the proxy, clamped to sane bounds — a
 * long structured answer (a multi-week plan) needs a context larger than the
 * model's default 4096 or it stalls mid-generation.
 */
function resolveOptions(requested: OllamaRequestBody['options']): Record<string, number> | undefined {
  if (!requested) return undefined;
  const options: Record<string, number> = {};
  if (typeof requested.num_ctx === 'number' && requested.num_ctx > 0) {
    options.num_ctx = Math.min(MAX_NUM_CTX, Math.max(2_048, Math.round(requested.num_ctx)));
  }
  if (typeof requested.num_predict === 'number' && requested.num_predict > 0) {
    options.num_predict = Math.min(MAX_NUM_PREDICT, Math.max(64, Math.round(requested.num_predict)));
  }
  return Object.keys(options).length > 0 ? options : undefined;
}
// Keep the loaded model resident for a while so the next request does not pay
// the 10-30 s cold-load again. Override with OLLAMA_KEEP_ALIVE (e.g. "0" to
// unload immediately and free RAM).
const KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE ?? '30m';

type OllamaRequestBody = {
  system: string;
  prompt: string;
  model?: string;
  /** When true the reply is streamed back as plain-text deltas. */
  stream?: boolean;
  /** Base64-encoded images for vision models. */
  images?: string[];
  /** Optional override of the non-stream timeout; clamped to 5..300 s. */
  timeoutMs?: number;
  /** Whitelisted generation limits forwarded to Ollama, each clamped. */
  options?: {
    num_ctx?: number;
    num_predict?: number;
  };
};

/**
 * Validates a model name so the route cannot be pointed at arbitrary Ollama
 * endpoints, and returns the model to use for this request. Vision requests
 * default to the configured vision model instead of the text-only default.
 */
function resolveModel(requested: string | undefined, hasImages: boolean): string | null {
  const fallback = hasImages
    ? process.env.OLLAMA_VISION_MODEL ?? DEFAULT_VISION_MODEL
    : process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;
  const model = requested ?? fallback;
  return MODEL_PATTERN.test(model) ? model : null;
}

function validateImages(images: unknown): { ok: true; images: string[] } | { ok: false; error: string } {
  if (!Array.isArray(images) || images.length === 0) {
    return { ok: false, error: 'images must be a non-empty array' };
  }
  if (images.length > 3) {
    return { ok: false, error: 'too many images' };
  }
  for (const image of images) {
    if (typeof image !== 'string' || !BASE64_PATTERN.test(image)) {
      return { ok: false, error: 'image must be base64-encoded' };
    }
    // base64 expands 4/3 in size — reject before it reaches the model.
    if (image.length > (MAX_IMAGE_BYTES * 4) / 3 + 4) {
      return { ok: false, error: `image exceeds ${MAX_IMAGE_BYTES} bytes` };
    }
  }
  return { ok: true, images: images as string[] };
}

/**
 * Reads the NDJSON stream from Ollama and forwards only the text deltas, so
 * the browser receives one continuous UTF-8 text stream.
 */
function toTextStream(upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = upstream.getReader();
  let buffer = '';

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let parsed: { response?: string; error?: string };
          try {
            parsed = JSON.parse(trimmed) as { response?: string; error?: string };
          } catch {
            continue; // partial or unknown line — keep reading
          }
          if (parsed.error) {
            controller.enqueue(encoder.encode(`\n[Ollama error] ${parsed.error}`));
            controller.close();
            void reader.cancel();
            return;
          }
          if (parsed.response) {
            controller.enqueue(encoder.encode(parsed.response));
          }
        }
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      void reader.cancel(reason);
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<OllamaRequestBody>;

    if (!body.system || !body.prompt) {
      return NextResponse.json({ error: 'Missing system or prompt' }, { status: 400 });
    }

    const hasImages = Array.isArray(body.images) && body.images.length > 0;
    const model = resolveModel(body.model, hasImages);
    if (!model) {
      return NextResponse.json({ error: 'Invalid model name' }, { status: 400 });
    }

    let images: string[] | undefined;
    if (hasImages) {
      const validation = validateImages(body.images);
      if (!validation.ok) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }
      images = validation.images;
    }

    const stream = body.stream === true;
    const payload = {
      model,
      prompt: body.prompt,
      system: body.system,
      stream,
      keep_alive: KEEP_ALIVE,
      ...(images ? { images } : {}),
      ...(() => {
        const options = resolveOptions(body.options);
        return options ? { options } : {};
      })(),
    };

    const upstream = await fetch(process.env.OLLAMA_URL ?? DEFAULT_OLLAMA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(resolveTimeout(body.timeoutMs, stream)),
      cache: 'no-store',
    });

    if (!upstream.ok) {
      const errorText = await upstream.text();
      return NextResponse.json(
        { error: errorText || 'Ollama request failed' },
        { status: upstream.status },
      );
    }

    if (stream) {
      if (!upstream.body) {
        return NextResponse.json({ error: 'Ollama returned an empty stream' }, { status: 502 });
      }
      return new Response(toTextStream(upstream.body), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    const data = (await upstream.json()) as { response?: string };
    return NextResponse.json({ response: data.response ?? '' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Ollama error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Derives the /api/tags endpoint from the configured Ollama URL. */
function tagsUrl(): string {
  const base = process.env.OLLAMA_URL ?? DEFAULT_OLLAMA_URL;
  return base.replace(/\/api\/[^/?]+$/, '/api/tags');
}

/**
 * Lists the models installed in Ollama so the settings UI can offer them in
 * a picker instead of requiring env vars. Names and sizes only — nothing else
 * about the local machine leaves this route.
 */
export async function GET() {
  try {
    const upstream = await fetch(tagsUrl(), {
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });

    if (!upstream.ok) {
      const errorText = await upstream.text();
      return NextResponse.json(
        { error: errorText || 'Ollama request failed' },
        { status: upstream.status },
      );
    }

    const data = (await upstream.json()) as {
      models?: Array<{ name?: string; size?: number }>;
    };
    const models = (data.models ?? [])
      .filter((item): item is { name: string; size?: number } => typeof item.name === 'string')
      .map((item) => ({ name: item.name, size: typeof item.size === 'number' ? item.size : 0 }));
    return NextResponse.json({ models });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Ollama error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
