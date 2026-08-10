/**
 * Contrato de PROVEDOR de IA (§45). A camada de análise depende apenas desta
 * interface — trocar Anthropic por OpenAI (ou outro) não altera o serviço.
 * O provedor recebe mensagens já montadas e devolve TEXTO cru + uso de tokens.
 * A validação de JSON estruturado e o cache ficam no AiService, não aqui.
 */
export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AICompletionRequest {
  model: string;
  system: string;
  messages: AIMessage[];
  /** Máximo de tokens de saída. */
  maxTokens?: number;
  temperature?: number;
  /** Pede formato JSON quando o provedor suporta. */
  json?: boolean;
}

export interface AICompletionResult {
  text: string;
  tokensInput: number;
  tokensOutput: number;
  model: string;
  provider: string;
}

export interface AIProvider {
  readonly name: string;
  complete(req: AICompletionRequest, apiKey: string): Promise<AICompletionResult>;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retriable = false,
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}
