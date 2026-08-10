import { AICompletionRequest, AICompletionResult, AIProvider, AIProviderError } from './types';
import { postJson } from './http';

/** Provedor OpenAI (Chat Completions). A chave nunca sai do backend. */
export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';

  async complete(req: AICompletionRequest, apiKey: string): Promise<AICompletionResult> {
    const payload: Record<string, unknown> = {
      model: req.model,
      temperature: req.temperature ?? 0.2,
      max_tokens: req.maxTokens ?? 1500,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
    };
    if (req.json) payload.response_format = { type: 'json_object' };
    const res = await postJson(
      'https://api.openai.com/v1/chat/completions',
      { authorization: `Bearer ${apiKey}` },
      payload,
    );
    if (!res.ok) {
      const msg = extractError(res.body) || `OpenAI HTTP ${res.status}`;
      throw new AIProviderError(msg, res.status, res.status === 429 || res.status >= 500);
    }
    const b = res.body as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = (b.choices?.[0]?.message?.content ?? '').trim();
    if (!text) throw new AIProviderError('Resposta vazia do provedor.', res.status);
    return {
      text,
      tokensInput: b.usage?.prompt_tokens ?? 0,
      tokensOutput: b.usage?.completion_tokens ?? 0,
      model: req.model,
      provider: this.name,
    };
  }
}

function extractError(body: unknown): string | null {
  if (body && typeof body === 'object' && 'error' in body) {
    const e = (body as { error?: { message?: string } }).error;
    if (e?.message) return e.message;
  }
  return null;
}
