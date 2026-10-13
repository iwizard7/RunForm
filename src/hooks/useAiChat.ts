'use client';

import { useCallback, useEffect, useState } from 'react';
import { addChatMessage, clearChatMessages, getChatMessages, type ChatMessage } from '@/lib/actions';
import { streamOllama } from '@/lib/ollama';
import { UserPreferences, defaultPreferences, getIntensityScore } from '@/lib/ai';
import { Language } from '@/lib/translations';
import { WorkoutData } from '@/lib/parser';
import type { PersonalBest } from '@/lib/actions';

const CONTEXT_MESSAGES = 10;

type UseAiChatParams = {
  lang: Language;
  history: WorkoutData[];
  personalBests: PersonalBest[];
  weeklyLoadLabel: string;
  weeklyRecoveryLabel: string;
  preferences?: UserPreferences;
  profileName: string;
};

/**
 * A persistent chat with the local coach. Messages are stored in the app's
 * SQLite database so the conversation survives reloads, while replies stream
 * in token-by-token from Ollama.
 */
export function useAiChat(params: UseAiChatParams) {
  const {
    lang,
    history,
    personalBests,
    weeklyLoadLabel,
    weeklyRecoveryLabel,
    preferences = defaultPreferences,
    profileName,
  } = params;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  // Small models often ignore a lone "Answer in Russian" inside an English
  // system prompt; repeating the directive in the target language at the end
  // of the request makes the replies stick to the UI language.
  const closingLanguageLine =
    lang === 'ru' ? 'Ответь полностью на русском языке.' : 'Answer entirely in English.';

  useEffect(() => {
    void getChatMessages(100)
      .then(setMessages)
      .catch((err) => console.error('[RunForm] loading chat history failed:', err));
  }, []);

  const buildSystemPrompt = useCallback(() => {
    const recent = history
      .slice(0, 5)
      .map(
        (item) =>
          `- ${new Date(item.startDate).toLocaleDateString()}: ${item.distance.toFixed(1)} km, pace ${item.pace}, avg HR ${item.avgHeartRate} bpm, intensity ${getIntensityScore(item)}`,
      )
      .join('\n');
    const bests =
      personalBests
        .filter((record) => record.condition === 'outdoor')
        .map((record) => `${record.type}: ${record.value.toFixed(2)} min/km`)
        .join(', ') || 'none yet';
    const { z1, z2, z3, z4, z5 } = preferences.hrZones;

    return [
      `You are ${profileName}'s personal running coach inside the RunForm app. Answer in ${lang === 'ru' ? 'Russian' : 'English'}, concise and concrete, at most 120 words unless asked for detail.`,
      `Weekly load: ${weeklyLoadLabel}. Recovery: ${weeklyRecoveryLabel}. Threshold pace: ${preferences.thresholdPace} min/km. HR zones: Z1<${z1}, Z2 ${z1}-${z2}, Z3 ${z2}-${z3}, Z4 ${z3}-${z4}, Z5>${z5}.`,
      `Outdoor personal bests: ${bests}.`,
      recent ? `Recent workouts:\n${recent}` : 'No workouts imported yet.',
      'Use this context to give personalized answers; never invent data you were not given.',
    ].join('\n');
  }, [history, personalBests, preferences, profileName, lang, weeklyLoadLabel, weeklyRecoveryLabel]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      setIsStreaming(true);
      const now = new Date().toISOString();
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: trimmed,
        createdAt: now,
      };
      const assistantId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        userMessage,
        { id: assistantId, role: 'assistant', content: '', createdAt: now },
      ]);

      try {
        await addChatMessage('user', trimmed);

        const conversation = [...messages, userMessage]
          .slice(-CONTEXT_MESSAGES)
          .map((message) => `${message.role === 'user' ? 'Athlete' : 'Coach'}: ${message.content}`)
          .join('\n');

        const full = await streamOllama(
          {
            system: buildSystemPrompt(),
            prompt: `Conversation so far:\n${conversation}\n\nCoach's reply:\n${closingLanguageLine}`,
          },
          (text) =>
            setMessages((prev) =>
              prev.map((message) => (message.id === assistantId ? { ...message, content: text } : message)),
            ),
        );
        await addChatMessage('assistant', full);
      } catch (err) {
        console.error('[RunForm] chat send failed:', err);
        const errorText =
          lang === 'ru'
            ? '❌ Ollama не отвечает. Убедитесь, что сервис запущен на localhost:11434.'
            : '❌ Ollama is not responding. Make sure the service runs on localhost:11434.';
        setMessages((prev) =>
          prev.map((message) => (message.id === assistantId ? { ...message, content: errorText } : message)),
        );
      } finally {
        setIsStreaming(false);
      }
    },
    [buildSystemPrompt, closingLanguageLine, isStreaming, lang, messages],
  );

  const clear = useCallback(async () => {
    if (isStreaming) return;
    try {
      await clearChatMessages();
      setMessages([]);
    } catch (err) {
      console.error('[RunForm] clearing chat failed:', err);
    }
  }, [isStreaming]);

  return { messages, isStreaming, send, clear };
}
