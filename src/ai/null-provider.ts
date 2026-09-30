/**
 * YamX - Null AI Provider
 * Default provider when no AI keys are configured or user chooses offline mode.
 * Returns polite refusal messages so the system stays functional 100% offline.
 */

import { AiProvider, AiOptions, AiResponse } from './interface.js';

export class NullProvider implements AiProvider {
  readonly name = 'null';
  readonly isLocal = true;

  async isAvailable(): Promise<boolean> {
    return true; // Always available — that's the point
  }

  async complete(prompt: string, _options?: AiOptions): Promise<AiResponse> {
    return {
      content: this.buildResponse(prompt),
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  private buildResponse(prompt: string): string {
    const normalized = prompt.toLowerCase().trim();

    // Detect if the prompt is asking for something we can handle locally
    if (normalized.includes('file') || normalized.includes('read')) {
      return 'I can help with files offline. Try: "read <filepath>" or "list <dir>".';
    }
    if (normalized.includes('shell') || normalized.includes('command') || normalized.includes('run')) {
      return 'I can run shell commands offline. Try: "run <command>".';
    }
    if (normalized.includes('git')) {
      return 'I can run git operations offline. Try: "git status" or "git log".';
    }
    if (normalized.includes('help')) {
      return 'Type "help" to see all available offline commands.';
    }

    return [
      'YamX is running in offline mode (no AI provider configured).',
      '',
      'I can still help you with:',
      '  • Files: read, write, edit, search, list',
      '  • Shell: run commands, diagnostics, logs',
      '  • Git: status, diff, commit, log, branch',
      '  • DevOps: process, network, container checks',
      '  • Security: defensive scans and audits',
      '  • Project: codebase analysis and intel',
      '',
      'Type "help" for the full command list.',
      'To enable AI, run "ymax config" and add an API key.',
    ].join('\n');
  }
}
