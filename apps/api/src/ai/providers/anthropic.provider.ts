import { AICompletionRequest, AICompletionResult, AIProvider, AIProviderError } from './types';
import { postJson } from './http';

/** Provedor Anthropic (Messages API). A chave nunca sai do backend. */
export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';

  async complete(req: AICompletionRequest, apiKey: string): Promise<AICompletionResult> {
    const payload = {
      model: req.model,
      max_tokens: req.maxTokens ?? 1500,
      temperature: req.temperature ?? 0.2,
      system: req.system,
      messages: req.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: m.content })),
    };
    const res = await postJson(
      'https://api.anthropic.com/v1/messages',
      {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      payload,
    );
    if (!res.ok) {
      const msg = extractError(res.body) || `Anthropic HTTP ${res.status}`;
      throw new AIProviderError(msg, res.status, res.status === 429 || res.status >= 500);
    }
    const b = res.body as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (b.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('')
      .trim();
    if (!text) throw new AIProviderError('Resposta vazia do provedor.', res.status);
    return {
      text,
      tokensInput: b.usage?.input_tokens ?? 0,
      tokensOutput: b.usage?.output_tokens ?? 0,
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
