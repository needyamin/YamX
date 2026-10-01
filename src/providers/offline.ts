/**
 * Local provider used when no model is connected.
 * The REPL still runs: shell, files, git, and the offline router.
 * Cloud turns stay behind /connect.
 */

import { Provider, CompletionOptions, CompletionResult, StreamChunk } from './base.js';

const OFFLINE_NOTE = [
  'Offline mode is on. Shell, files, git, and local routing work without a model.',
  'Run /connect when you want to attach an AI.',
].join('\n');

export class OfflineProvider implements Provider {
  name = 'offline';
  modelId = 'local';

  async complete(_options: CompletionOptions): Promise<CompletionResult> {
    return { content: OFFLINE_NOTE };
  }

  async *stream(_options: CompletionOptions): AsyncGenerator<StreamChunk> {
    yield { type: 'text', content: OFFLINE_NOTE };
    yield { type: 'done' };
  }
}
