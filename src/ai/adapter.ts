/**
 * YamX - AI Provider Adapter
 * Bridges the existing provider implementations (OpenAI, Anthropic, Ollama, etc.)
 * to the new AiProvider interface. Allows gradual migration without breaking changes.
 */

import { AiProvider, AiOptions, AiResponse, AiStreamChunk } from './interface.js';
import { Provider, Message, ToolDefinition } from '../providers/base.js';

export class ProviderAdapter implements AiProvider {
  readonly name: string;
  readonly isLocal: boolean;

  private provider: Provider;

  constructor(provider: Provider, isLocal = false) {
    this.provider = provider;
    this.name = provider.name;
    this.isLocal = isLocal;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Quick health check via a minimal completion
      const result = await this.provider.complete({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 5,
      });
      return result.content !== null || (result.tool_calls !== undefined);
    } catch {
      return false;
    }
  }

  async complete(prompt: string, options?: AiOptions): Promise<AiResponse> {
    const messages: Message[] = [];
    if (options?.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const tools = options?.tools as ToolDefinition[] | undefined;

    const result = await this.provider.complete({
      messages,
      tools,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
    });

    return {
      content: result.content,
      toolCalls: result.tool_calls,
      usage: result.usage,
    };
  }

  async *stream(prompt: string, options?: AiOptions): AsyncGenerator<AiStreamChunk> {
    const messages: Message[] = [];
    if (options?.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const tools = options?.tools as ToolDefinition[] | undefined;

    for await (const chunk of this.provider.stream({
      messages,
      tools,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
    })) {
      switch (chunk.type) {
        case 'text':
          yield { type: 'text', content: chunk.content };
          break;
        case 'tool_call_start':
        case 'tool_call_delta':
          yield { type: 'tool_call', toolCall: chunk.toolCall };
          break;
        case 'done':
          yield { type: 'done' };
          break;
      }
    }
  }
}
