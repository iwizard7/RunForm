export async function requestOllama(params: {
  system: string;
  prompt: string;
  model?: string;
}) {
  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    body: JSON.stringify({
      model: params.model ?? 'qwen2.5:3b',
      prompt: params.prompt,
      system: params.system,
      stream: false,
    }),
  });

  return response.json() as Promise<{ response: string }>;
}
