export async function requestOllama(params: {
  system: string;
  prompt: string;
  model?: string;
}) {
  const response = await fetch('/api/ollama', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Ollama request failed');
  }

  return response.json() as Promise<{ response: string }>;
}
