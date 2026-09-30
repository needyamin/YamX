/**
 * YamX - AI Provider Interface
 * Abstract contract for all AI providers (cloud, local, or null).
 * Future AI integrations implement this interface.
 */

export interface AiOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: any[];
  systemPrompt?: string;
}

export interface AiResponse {
  content: string | null;
  toolCalls?: any[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface AiStreamChunk {
  type: 'text' | 'tool_call' | 'done';
  content?: string;
  toolCall?: any;
}

export interface AiProvider {
  readonly name: string;
  readonly isLocal: boolean;

  /** Check if this provider is usable right now (keys installed, service reachable, etc.) */
  isAvailable(): Promise<boolean>;

  /** Single-turn completion */
  complete(prompt: string, options?: AiOptions): Promise<AiResponse>;

  /** Streaming completion (optional) */
  stream?(prompt: string, options?: AiOptions): AsyncGenerator<AiStreamChunk>;
}
