/**
 * YamX - Base Expert Class
 * Abstract foundation for all domain-specific expert modules.
 */

import { YamConfig } from '../config/index.js';

export interface ExecutionContext {
  cwd: string;
  sessionId?: string;
  userConfig: YamConfig;
  cancellationToken?: { cancelled: boolean };
}

export interface ExpertResult {
  success: boolean;
  output: string | Record<string, any>;
  artifacts?: string[];
  followUpIntents?: string[];
  error?: string;
}

export interface WorkflowStep {
  name: string;
  description: string;
  required: boolean;
}

export interface WorkflowDefinition {
  name: string;
  steps: WorkflowStep[];
}

export abstract class BaseExpert {
  abstract readonly name: string;
  abstract readonly domain: string;
  abstract readonly capabilities: string[];

  abstract canHandle(intent: string, params: Record<string, any>): Promise<boolean>;
  abstract execute(intent: string, params: Record<string, any>, context: ExecutionContext): Promise<ExpertResult>;
  abstract getWorkflow(): WorkflowDefinition;

  protected formatOutput(content: string, title?: string): string {
    const lines: string[] = [];
    if (title) lines.push(`═══ ${title} ═══`);
    lines.push(content);
    return lines.join('\n');
  }

  protected formatError(message: string): ExpertResult {
    return {
      success: false,
      output: message,
      error: message,
    };
  }

  protected formatSuccess(output: string, artifacts?: string[], followUp?: string[]): ExpertResult {
    return {
      success: true,
      output,
      artifacts,
      followUpIntents: followUp,
    };
  }
}
