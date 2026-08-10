import { AIProvider } from './types';
import { AnthropicProvider } from './anthropic.provider';
import { OpenAIProvider } from './openai.provider';

export const SUPPORTED_PROVIDERS = ['anthropic', 'openai'] as const;
export type ProviderName = (typeof SUPPORTED_PROVIDERS)[number];

/** Modelos padrão sugeridos por provedor (o usuário pode sobrescrever). */
export const DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: 'claude-sonnet-4-5',
  openai: 'gpt-4o-mini',
};

export function buildProvider(name: string): AIProvider {
  switch (name) {
    case 'anthropic':
      return new AnthropicProvider();
    case 'openai':
      return new OpenAIProvider();
    default:
      throw new Error(`Provedor de IA não suportado: ${name}`);
  }
}
