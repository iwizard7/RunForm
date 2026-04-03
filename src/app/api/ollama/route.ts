import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_OLLAMA_URL = 'http://localhost:11434/api/generate';
const DEFAULT_MODEL = 'qwen2.5:3b';

type OllamaRequestBody = {
  system: string;
  prompt: string;
  model?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<OllamaRequestBody>;

    if (!body.system || !body.prompt) {
      return NextResponse.json({ error: 'Missing system or prompt' }, { status: 400 });
    }

    const response = await fetch(process.env.OLLAMA_URL ?? DEFAULT_OLLAMA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: body.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_MODEL,
        prompt: body.prompt,
        system: body.system,
        stream: false,
      }),
      signal: AbortSignal.timeout(45_000),
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: errorText || 'Ollama request failed' },
        { status: response.status },
      );
    }

    const data = (await response.json()) as { response?: string };
    return NextResponse.json({ response: data.response ?? '' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Ollama error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
