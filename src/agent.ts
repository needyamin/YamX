/**
 * YamX - Core Agent Loop
 * Production-grade ReAct agent with streaming, tool calling, approval flow,
 * markdown rendering, auto-retry, and multi-turn reasoning.
 */

import { Provider, Message, ToolCall, CompletionResult } from './providers/base.js';
import { allTools, getToolDefinitions, getTool } from './tools/registry.js';
import { ensureInsideProject } from './tools/utils.js';
import {
  isPseudoEnglishShellIntent,
  pseudoShellAdviceMessage,
} from './tools/shell.js';
import { evaluateToolCall, PermissionMode } from './policy.js';
import { HookManager } from './hooks.js';
import { setRunCommandAbortCheck } from './shell-abort-context.js';
import { UI } from './ui.js';
import {
  ASSISTANT_TRUNCATION_HISTORY_NOTE,
  capAssistantMarkdownSource,
  DEFAULT_MAX_ASSISTANT_MARKDOWN_CHARS,
} from './assistant-output-cap.js';
import { maybeRuntimePreflightMessage } from './runtime-preflight.js';
import { buildCurrentIntentMessage, classifyUserIntent } from './intent.js';
import { extractCodingBrief } from './project-intel.js';
import { setCrewRuntime } from './subagents.js';
import { FILE_EDIT_TOOLS, PARALLEL_READ_TOOLS, commandRepeatKey, fileEditChanged } from './crew-scheduler.js';

const MAX_TOOL_ITERATIONS = 40; // Safety: prevent infinite loops
const MAX_RETRIES = 3; // Retry on transient API failures
const RETRY_DELAYS = [1000, 3000, 8000]; // Exponential backoff (ms)
type EngineeringMode = 'balanced' | 'advanced' | 'elite';
const ENGINEERING_MODE: EngineeringMode = resolveEngineeringMode();
const TOOL_ITERATION_LIMIT = ENGINEERING_MODE === 'elite' ? 60 : ENGINEERING_MODE === 'advanced' ? 50 : MAX_TOOL_ITERATIONS;

function resolveEngineeringMode(): EngineeringMode {
  const raw = String(
    process.env.YAMX_ENGINEERING_MODE
    || process.env.YAMX_AGENT_LEVEL
    || process.env.YAMX_PRO_MODE
    || 'elite'
  ).toLowerCase().trim();
  if (['balanced', 'default', 'normal', 'base'].includes(raw)) return 'balanced';
  if (['advanced', 'pro', 'high'].includes(raw)) return 'advanced';
  return 'elite';
}

class AgentStopRequested extends Error {
  constructor() {
    super('Stopped by user.');
    this.name = 'AgentStopRequested';
  }
}

export interface AgentOptions {
  autoApprove?: boolean;
  stream?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** Restored from disk; if set, overrides fresh system-only bootstrap */
  initialHistory?: Message[] | null;
  onPersist?: () => void | Promise<void>;
  /** Total serialized history size (chars) before auto-compression */
  contextBudgetChars?: number;
  /** Number of newest messages to keep verbatim when compressing history. */
  contextKeepLastMessages?: number;
  /**
   * Optional aggressive mode for weak hardware: after turns grow large,
   * roll forward into a lightweight summary-only thread.
   */
  contextRolloverMode?: 'off' | 'summary-next-session';
  permissionMode?: PermissionMode;
  allowedShellCommands?: string[];
  deniedShellPatterns?: string[];
  hooksEnabled?: boolean;
  /** Run a hidden expert discussion before the main tool-capable response */
  modelCouncilEnabled?: boolean;
  /** Council mode: adaptive saves tokens, always maximizes planning, off disables it */
  modelCouncilMode?: 'adaptive' | 'always' | 'off';
  /** Maximum tool-result characters kept in model history */
  maxToolResultChars?: number;
  /** Neural-status noise, fancy tool banners, turn timing footer */
  verboseCli?: boolean;
  /** Cap assistant markdown rendered and stored per message */
  maxAssistantMarkdownChars?: number;
  /** For non-tty surfaces: decide approval-required tool calls without prompting. */
  nonInteractiveApprovals?: 'deny' | 'allow';
  /**
   * When true (default): install/PATH-style user lines run read-only local probes first;
   * results are injected before the model as a user-role yamx_local_preflight XML-style block.
   */
  preflightRuntimeProbes?: boolean;
  /** Suppress spinners and decorative terminal output (web / programmatic runners). */
  headlessUi?: boolean;
  subagentsEnabled?: boolean;
  subagentMaxParallel?: number;
  subagentMaxIterations?: number;
}

export class Agent {
  private provider: Provider;
  private history: Message[] = [];
  private ui: UI;
  private options: AgentOptions;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private fileChanges: Array<{ path: string; oldContent: string; action: string }> = [];
  private turnStartTime = 0;
  private toolCallCounts = new Map<string, number>();
  private editGeneration = 0;
  private hooks = new HookManager();
  private stopRequested = false;
  private stopWaiters = new Set<() => void>();

  /** Retry wrapper for API calls */
  private async withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      this.throwIfStopped();
      try {
        return await this.cancellable(fn());
      } catch (error: any) {
        if (error instanceof AgentStopRequested) throw error;
        const isRetryable =
          error.status === 429 ||
          error.status === 500 ||
          error.status === 502 ||
          error.status === 503 ||
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT' ||
          error.code === 'ECONNREFUSED' ||
          error.code === 'UND_ERR_CONNECT_TIMEOUT' ||
          error.message?.includes('timeout') ||
          error.message?.includes('ECONNRESET');

        if (isRetryable && attempt < MAX_RETRIES - 1) {
          const delay = RETRY_DELAYS[attempt];
          this.ui.warn(`${label} failed (${error.message}). Retrying in ${delay / 1000}s… (${attempt + 1}/${MAX_RETRIES})`);
          await this.cancellable(new Promise(r => setTimeout(r, delay)));
          continue;
        }
        throw error;
      }
    }
    throw new Error('Max retries exceeded');
  }

  requestStop(): void {
    if (this.stopRequested) return;
    this.stopRequested = true;
    this.ui.stopSpinner();
    this.ui.cancelAssistantMarkdownStream();
    this.ui.warn('Interrupted — stopping shell now; ending this turn…');
    this.ui.replForceExitHint();
    for (const waiter of [...this.stopWaiters]) waiter();
  }

  isStopRequested(): boolean {
    return this.stopRequested;
  }

  private throwIfStopped(): void {
    if (this.stopRequested) throw new AgentStopRequested();
  }

  private cancellable<T>(promise: Promise<T>): Promise<T> {
    if (this.stopRequested) return Promise.reject(new AgentStopRequested());

    let waiter: (() => void) | null = null;
    const stopPromise = new Promise<T>((_, reject) => {
      waiter = () => reject(new AgentStopRequested());
      this.stopWaiters.add(waiter);
    });

    return Promise.race([promise, stopPromise]).finally(() => {
      if (waiter) this.stopWaiters.delete(waiter);
    });
  }

  constructor(provider: Provider, systemPrompt: string, options: AgentOptions = {}) {
    this.provider = provider;
    const merged = {
      autoApprove: false,
      stream: true,
      maxTokens: 16384,
      temperature: 0.1,
      modelCouncilEnabled: false,
      modelCouncilMode: 'adaptive' as const,
      maxToolResultChars: 24_000,
      contextKeepLastMessages: 16,
      contextRolloverMode: 'off' as const,
      verboseCli: false,
      maxAssistantMarkdownChars: DEFAULT_MAX_ASSISTANT_MARKDOWN_CHARS,
      preflightRuntimeProbes: true,
      ...options,
    };
    this.ui = new UI({
      verbose: merged.verboseCli === true,
      maxAssistantMarkdownChars: merged.maxAssistantMarkdownChars,
      headless: merged.headlessUi === true,
    });
    this.options = merged;
    if (this.options.initialHistory && this.options.initialHistory.length > 0) {
      this.history = JSON.parse(JSON.stringify(this.options.initialHistory)) as Message[];
    } else {
      this.history.push({ role: 'system', content: systemPrompt });
    }
  }

  getHistory(): Message[] {
    return JSON.parse(JSON.stringify(this.history)) as Message[];
  }

  /** Swap the model client after /connect without resetting the session. */
  setProvider(provider: Provider): void {
    this.provider = provider;
  }

  getProviderName(): string {
    return this.provider.name;
  }

  /** Replace the first system message after refreshing project context (e.g. offline project scan). */
  refreshSystemPrompt(content: string): void {
    if (this.history.length === 0) return;
    if (this.history[0].role !== 'system') return;
    this.history[0] = { role: 'system', content };
  }

  private estimateHistoryChars(): number {
    return this.history.reduce((n, m) => n + JSON.stringify(m).length, 0);
  }

  private contextKeepLastMessages(): number {
    const raw = Math.trunc(Number(this.options.contextKeepLastMessages ?? 16));
    if (!Number.isFinite(raw)) return 16;
    // Keep enough recent turns so the current user request never gets compacted away mid-turn.
    return Math.min(Math.max(raw, 4), 40);
  }

  private shouldRolloverForNextSession(): boolean {
    if ((this.options.contextRolloverMode ?? 'off') !== 'summary-next-session') return false;
    const budget = this.options.contextBudgetChars ?? 280_000;
    // Trigger before hard limits so next turn stays lightweight.
    return this.estimateHistoryChars() > Math.floor(budget * 0.45) && this.history.length > 8;
  }

  private async ensureContextBudget(): Promise<void> {
    const budget = this.options.contextBudgetChars ?? 280_000;
    const keepLast = this.contextKeepLastMessages();
    let guard = 0;
    while (this.estimateHistoryChars() > budget && this.history.length > 4 && guard < 10) {
      guard++;
      await this.compactMiddle(keepLast, true);
    }
  }

  /** Summarize the middle of history; keep system + last `keepLast` messages. Preserves system. */
  private async compactMiddle(keepLast: number, silent = false): Promise<void> {
    if (this.history.length <= 2 + keepLast) return;

    const systemPrompt = this.history[0];
    const safeKeepLast = Math.max(0, Math.trunc(keepLast));
    const recentMessages = safeKeepLast > 0 ? this.history.slice(-safeKeepLast) : [];
    const oldMessages = this.history.slice(1, this.history.length - safeKeepLast);

    if (oldMessages.length === 0) return;

    if (!silent) this.ui.startThinking('Compacting conversation...');
    else this.ui.startThinking('Optimizing context (long conversation)…');

    const oldText = oldMessages
      .map((m) => {
        const c = m.content ?? '';
        const toolInfo =
          m.role === 'tool'
            ? `[tool ${m.name ?? ''}]: ${c.slice(0, 2000)}`
            : m.tool_calls
              ? `[assistant tool_calls]`
              : `[${m.role}]: ${c.slice(0, 1500)}`;
        return toolInfo;
      })
      .join('\n---\n');

    const summaryResult = await this.withRetry(
      () =>
        this.provider.complete({
          messages: [
            {
              role: 'system',
              content:
                'Summarize the following chat segment for a coding assistant. Preserve: user goals, file paths touched, commands run, errors, and decisions. Be dense.',
            },
            { role: 'user', content: oldText.slice(0, 120_000) },
          ],
          maxTokens: 4096,
          temperature: 0.2,
        }),
      'Summarize'
    );

    this.ui.stopSpinner();

    const summary = summaryResult.content || 'Prior context summarized.';
    this.history = [
      systemPrompt,
      {
        role: 'user',
        content: `[Compressed thread memory — retain facts below for continuity]\n${summary}`,
      },
      {
        role: 'assistant',
        content:
          'Understood. I treat that summary as authoritative background for the recent messages that follow.',
      },
      ...recentMessages,
    ];

    if (!silent) {
      this.ui.success(`Compacted ${oldMessages.length} messages. History: ${this.history.length} messages.`);
    } else {
      this.ui.info('Context compressed to stay within model limits.');
    }

    await Promise.resolve(this.options.onPersist?.());
  }

  /** Main chat entry point */
  async chat(userInput: string): Promise<void> {
    this.stopRequested = false;
    this.activateCrew(userInput);
    try {
      await this.ensureContextBudget();
      this.throwIfStopped();
      const latestIntent = classifyUserIntent(userInput);
      this.history.push({ role: 'user', content: userInput });
      this.history.push({ role: 'user', content: buildCurrentIntentMessage(latestIntent) });

      if (this.options.preflightRuntimeProbes !== false && latestIntent.kind !== 'conversation') {
        this.throwIfStopped();
        const preflightBlob = await maybeRuntimePreflightMessage(userInput);
        if (preflightBlob) {
          this.ui.neuralStatus('preflight', 'attached read-only local probes to context');
          this.history.push({ role: 'user', content: preflightBlob });
        }
      }
      // Re-check budget after adding this turn's user/preflight context.
      await this.ensureContextBudget();

      this.fileChanges = []; // Reset undo buffer per turn
      this.toolCallCounts.clear();
      this.editGeneration = 0;
      this.turnStartTime = Date.now();

      this.ui.neuralStatus('input', 'request received; preparing model context');
      await this.runModelCouncil(userInput, latestIntent.kind);

      let iterations = 0;

      while (iterations < TOOL_ITERATION_LIMIT) {
        this.throwIfStopped();
        iterations++;

        if (this.options.stream) {
          const result = await this.streamResponse();
          this.throwIfStopped();
          if (!result.tool_calls || result.tool_calls.length === 0) {
            break; // No more tools, done
          }

          // Process tool calls
          const shouldContinue = await this.processToolCalls(result.tool_calls);
          if (!shouldContinue) break;
        } else {
          const result = await this.completeResponse();
          this.throwIfStopped();
          if (!result.tool_calls || result.tool_calls.length === 0) {
            break;
          }

          const shouldContinue = await this.processToolCalls(result.tool_calls);
          if (!shouldContinue) break;
        }
      }

      if (iterations >= TOOL_ITERATION_LIMIT) {
        this.ui.warn(`Reached maximum tool iterations (${TOOL_ITERATION_LIMIT}). Stopping.`);
      }

      if (this.options.verboseCli) {
        const elapsed = ((Date.now() - this.turnStartTime) / 1000).toFixed(1);
        this.ui.info(`Turn completed in ${elapsed}s · ${iterations} iteration${iterations > 1 ? 's' : ''}`);
      }

      if (this.shouldRolloverForNextSession()) {
        await this.compactMiddle(0, true);
        this.ui.info('Rolled to a lightweight summarized thread for the next turn.');
      }

      await Promise.resolve(this.options.onPersist?.());
    } catch (error: any) {
      if (error instanceof AgentStopRequested) {
        this.history.push({
          role: 'assistant',
          content: '[Stopped by user before the turn completed.]',
        });
        this.ui.warn('Stopped current YamX turn.');
        await Promise.resolve(this.options.onPersist?.());
        return;
      }
      throw error;
    } finally {
      setCrewRuntime(null);
      this.stopRequested = false;
      this.stopWaiters.clear();
      this.ui.cueTTYAfterBulkOutput();
    }
  }

  private activateCrew(userInput: string): void {
    setCrewRuntime({
      provider: this.provider,
      ui: this.ui,
      permissionMode: this.options.permissionMode,
      autoApprove: this.options.autoApprove,
      allowedShellCommands: this.options.allowedShellCommands,
      deniedShellPatterns: this.options.deniedShellPatterns,
      nonInteractiveApprovals: this.options.nonInteractiveApprovals,
      projectBrief: extractCodingBrief(userInput),
      maxIterations: this.options.subagentMaxIterations ?? 12,
      maxParallel: this.options.subagentMaxParallel ?? 3,
      enabled: this.options.subagentsEnabled !== false,
      hooksEnabled: this.options.hooksEnabled !== false,
      stopCheck: () => this.isStopRequested(),
    });
  }

  private async runModelCouncil(userInput: string, intentKind = classifyUserIntent(userInput).kind): Promise<void> {
    this.throwIfStopped();
    if (this.options.modelCouncilEnabled === false || this.options.modelCouncilMode === 'off') return;
    if (intentKind === 'conversation' || intentKind === 'empty') {
      this.ui.neuralStatus('council', 'skipped council for non-task turn');
      return;
    }
    if (this.options.modelCouncilMode !== 'always' && !this.shouldRunModelCouncil(userInput)) {
      this.ui.neuralStatus('council', 'adaptive token saver skipped council for this simple turn');
      return;
    }

    this.ui.neuralStatus('council', 'Analyst · Planner · Critic · Synthesizer discussing request');
    this.ui.startThinking('Consulting model council...');
    try {
      const recentContext = this.history
        .slice(-8)
        .map((message) => {
          const label = message.role.toUpperCase();
          const content = message.content || (message.tool_calls ? '[tool calls]' : '');
          return `${label}: ${content.slice(0, 3000)}`;
        })
        .join('\n\n');

      const result = await this.withRetry(
        () =>
          this.provider.complete({
            messages: [
              {
                role: 'system',
                content: [
                  'You are the hidden YamX model council. Discuss the user request before the main coding agent acts.',
                  'Use four concise expert perspectives:',
                  'Analyst: clarify intent and required outcome.',
                  'Planner: identify the smallest practical execution path. For code changes, specify: which files to read first, edit order (types→impls→tests), and the cheapest verification command.',
                  'Critic: identify risks, missing evidence, safety concerns, likely failure modes, and potential regressions. For multi-file changes, flag import/type propagation risks.',
                  'Synthesizer: give final private guidance the main agent should follow. Include: specific tool calls to start with, files to read, and the verification strategy.',
                  'Keep the whole council response under 900 tokens.',
                  'Do not ask the user questions unless the task is genuinely blocked.',
                  'Do not claim work is done. Do not include public-facing filler.',
                ].join('\n'),
              },
              {
                role: 'user',
                content: [
                  'Recent conversation and auto context:',
                  recentContext.slice(0, 30_000),
                  '',
                  'Current user request:',
                  userInput,
                  intentKind !== 'task' ? '' : `\nIntent classification: kind=${intentKind}`,
                ].filter(Boolean).join('\n'),
              },
            ],
            maxTokens: Math.min(1400, this.options.maxTokens || 1400),
            temperature: Math.max(0.1, Math.min(0.3, this.options.temperature ?? 0.1)),
          }),
        'Model council'
      );
      this.throwIfStopped();

      this.ui.stopSpinner();
      if (result.usage) {
        this.totalInputTokens += result.usage.inputTokens;
        this.totalOutputTokens += result.usage.outputTokens;
      }

      const notes = result.content?.trim();
      if (!notes) return;
      this.history.push({
        role: 'user',
        content: `<yamx_internal_model_council private="true">\n${notes.slice(0, 6_000)}\n</yamx_internal_model_council>\n\nUse these private notes to answer the original user request exactly. Do not mention the council unless the user asks how you reasoned.`,
      });
    } catch (error: any) {
      this.ui.stopSpinner();
      if (error instanceof AgentStopRequested) throw error;
      this.ui.warn(`Model council skipped: ${error.message}`);
    }
  }

  private shouldRunModelCouncil(userInput: string): boolean {
    if (ENGINEERING_MODE === 'elite') return true;
    if (ENGINEERING_MODE === 'advanced' && userInput.trim().length >= 40) return true;
    const text = userInput.toLowerCase();
    // Long inputs are likely complex tasks
    if (text.length > 400) return true;
    // Multiple file references suggest multi-file work
    const fileRefs = text.match(/\b[\w./\\-]+\.(ts|tsx|js|jsx|py|go|rs|java|json|yaml|yml|toml|md|c|cpp|h|cs|rb|php)\b/gi);
    if (fileRefs && fileRefs.length >= 2) return true;
    // Error paste — user is likely debugging
    if (/\b(TypeError|SyntaxError|ReferenceError|ENOENT|EACCES|EPERM|ECONNREFUSED|stack trace|traceback|segfault|panic|core dump)\b/i.test(text)) return true;
    // Infrastructure / architecture work
    if (/\b(docker|kubernetes|k8s|helm|terraform|ansible|ci\/cd|pipeline|microservice|monorepo|migration|schema|database)\b/.test(text)) return true;
    // Code quality / complex analysis
    if (/\b(refactor|redesign|architect|restructure|split|merge|decouple|abstract|generalize|optimize|benchmark|profile|memory leak|race condition|deadlock|thread)\b/.test(text)) return true;
    // Standard complexity triggers
    return /\b(fix|bug|error|broken|fail|crash|implement|add|create|refactor|review|analy[sz]e|architecture|security|performance|optimi[sz]e|test|build|deploy|database|migration|agent|powerful|advanced|pro|logs?|debug|investigate|diagnose|troubleshoot|integrate|upgrade|convert|port|rewrite)\b/.test(text);
  }

  /** Non-streaming completion */
  private async completeResponse(): Promise<CompletionResult> {
    this.throwIfStopped();
    this.ui.neuralStatus('model', 'sending context and tools to provider');
    this.ui.startThinking('Calling model API…');

    try {
      const result = await this.withRetry(() => this.provider.complete({
        messages: this.history,
        tools: getToolDefinitions(),
        maxTokens: this.options.maxTokens,
        temperature: this.options.temperature,
      }), 'API call');
      this.throwIfStopped();

      this.ui.stopSpinner();

      if (result.usage) {
        this.totalInputTokens += result.usage.inputTokens;
        this.totalOutputTokens += result.usage.outputTokens;
      }

      const assistantBody = result.content ?? '';
      let storedAssistantText: string | null | undefined = result.content;
      const maxMd = this.options.maxAssistantMarkdownChars ?? DEFAULT_MAX_ASSISTANT_MARKDOWN_CHARS;

      let capResult: ReturnType<typeof capAssistantMarkdownSource> | null = null;
      if (assistantBody.length) {
        capResult = capAssistantMarkdownSource(assistantBody, maxMd);
        if (capResult.truncated) {
          storedAssistantText = capResult.text + ASSISTANT_TRUNCATION_HISTORY_NOTE;
          this.ui.info(
            `Reply truncated (${capResult.text.length}/${capResult.originalLength} chars). Raise settings.maxAssistantMarkdownChars in ~/.yamx/config.json.`
          );
        }
      }

      const assistantMsg: Message = {
        role: 'assistant',
        content: storedAssistantText,
        tool_calls: result.tool_calls,
      };
      this.history.push(assistantMsg);

      if (capResult && this.options.headlessUi !== true) {
        const rendered = this.ui.renderMarkdown(capResult.text, { bypassCap: true });
        console.log('\n' + rendered);
      }

      return result;
    } catch (error: any) {
      this.ui.stopSpinner();
      if (error instanceof AgentStopRequested) throw error;
      this.ui.apiFailure('complete', error);
      return { content: null };
    }
  }

  /** Streaming completion with accumulated markdown rendering */
  private async streamResponse(): Promise<CompletionResult> {
    this.throwIfStopped();
    this.ui.neuralStatus('model', 'streaming provider response');
    this.ui.startThinking('Waiting for streamed reply…');

    try {
      let fullContent = '';
      const toolCalls: ToolCall[] = [];
      const toolCallBuffers: Record<string, { id: string; name: string; args: string; providerMetadata?: ToolCall['providerMetadata'] }> = {};
      let firstText = true;

      const stream = this.provider.stream({
        messages: this.history,
        tools: getToolDefinitions(),
        maxTokens: this.options.maxTokens,
        temperature: this.options.temperature,
      });

      while (true) {
        const next = await this.cancellable(stream.next());
        if (next.done) break;
        const chunk = next.value;
        if (this.stopRequested) {
          await stream.return?.(undefined as any).catch?.(() => undefined);
          throw new AgentStopRequested();
        }
        switch (chunk.type) {
          case 'text':
            if (firstText) {
              this.ui.stopSpinner();
              this.ui.beginAssistantMarkdownStream(true);
              firstText = false;
            }
            this.ui.appendAssistantMarkdownChunk(chunk.content || '');
            fullContent += chunk.content || '';
            break;

          case 'tool_call_start':
            if (chunk.toolCall?.id) {
              toolCallBuffers[chunk.toolCall.id] = {
                id: chunk.toolCall.id,
                name: chunk.toolCall.function?.name || '',
                args: chunk.toolCall.function?.arguments || '',
                providerMetadata: chunk.toolCall.providerMetadata,
              };
            }
            break;

          case 'tool_call_delta':
            if (chunk.toolCall?.id) {
              toolCallBuffers[chunk.toolCall.id] ??= {
                id: chunk.toolCall.id,
                name: '',
                args: '',
              };
              if (chunk.toolCall.function?.name) {
                toolCallBuffers[chunk.toolCall.id].name = chunk.toolCall.function.name;
              }
              if (chunk.toolCall.function?.arguments) {
                toolCallBuffers[chunk.toolCall.id].args += chunk.toolCall.function.arguments;
              }
              if (chunk.toolCall.providerMetadata) {
                toolCallBuffers[chunk.toolCall.id].providerMetadata = chunk.toolCall.providerMetadata;
              }
            }
            break;

          case 'tool_call_end':
            if (chunk.toolCall?.id) {
              const buf = toolCallBuffers[chunk.toolCall.id];
              if (buf) {
                if (!buf.name && chunk.toolCall.function?.name) {
                  buf.name = chunk.toolCall.function.name;
                }
                if (!buf.args && chunk.toolCall.function?.arguments) {
                  buf.args = chunk.toolCall.function.arguments;
                }
                if (chunk.toolCall.providerMetadata) {
                  buf.providerMetadata = chunk.toolCall.providerMetadata;
                }
                toolCalls.push({
                  id: buf.id,
                  type: 'function',
                  function: { name: buf.name, arguments: buf.args },
                  providerMetadata: buf.providerMetadata,
                });
              } else if (chunk.toolCall.function) {
                toolCalls.push(chunk.toolCall as ToolCall);
              }
            }
            break;

          case 'done':
            break;
        }
      }

      this.ui.finalizeAssistantMarkdownStream();

      this.ui.stopSpinner();

      let storedStreamText: string | null =
        fullContent.length > 0 ? fullContent.replace(/\s+$/, '') : null;

      if (storedStreamText?.length) {
        const cap = capAssistantMarkdownSource(
          storedStreamText,
          this.options.maxAssistantMarkdownChars ?? DEFAULT_MAX_ASSISTANT_MARKDOWN_CHARS
        );
        if (cap.truncated) {
          storedStreamText = cap.text + ASSISTANT_TRUNCATION_HISTORY_NOTE;
        }
      }

      // Add assistant message to history
      const assistantMsg: Message = {
        role: 'assistant',
        content: storedStreamText,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      };
      this.history.push(assistantMsg);

      return {
        content: fullContent || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    } catch (error: any) {
      this.ui.cancelAssistantMarkdownStream();
      this.ui.stopSpinner();
      if (error instanceof AgentStopRequested) throw error;
      this.ui.apiFailure('stream', error);
      return { content: null };
    }
  }

  /** Parse a single shell line from a small completion (fences, bullets, $ stripped). */
  private stripOneShellLineFromCompletion(raw: string): string | null {
    let t = (raw || '').trim();
    if (!t) return null;
    const fenced = /^```(?:[a-zA-Z0-9_-]+)?\s*\n([\s\S]*?)```/;
    const fm = t.match(fenced);
    if (fm) t = fm[1].trim();

    const lines = t
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !/^#{1,6}\s/.test(l));
    if (!lines.length) return null;

    let line = lines[0];
    if (/^NONE\.?$/i.test(line)) return null;
    line = line.replace(/^[-*•]\s+/, '').trim();
    line = line.replace(/^(?:CMD|Command)\s*:\s*/i, '').trim();
    line = line.replace(/^\$\s+/, '').trim();
    line = line.replace(/^>\s*/, '').trim();
    line = line.replace(/^["']|["']$/g, '').trim();
    if (!line || /^NONE\.?$/i.test(line)) return null;
    if (line.length > 4096) return null;
    return line;
  }

  /** Ask the active model for one executable-first substitution; null if unsafe or unparseable. */
  private async resolvePseudoShellCommand(command: string): Promise<string | null> {
    this.throwIfStopped();
    const platform = `${process.platform} ${process.arch}`;
    const osHint =
      process.platform === 'win32'
        ? 'Windows: first choice is often read-only probes (where, py -0, winget search); then winget/choco/scoop installers — never naked "install foo".'
        : 'Unix/macOS: use command -v / --version probes first; then apt/brew/dnf-native install lines.';

    type Opt = Parameters<Provider['complete']>[0];
    const opts: Opt = {
      messages: [
        {
          role: 'system',
            content:
              `You fix invalid shell one-liners proposed for YamX (English verbs first, like "install python"). ` +
              `Return ONE corrected executable-first shell line for this OS (${osHint}). ` +
              `Prefer harmless probes where appropriate; otherwise one concrete installer/package-manager command. Reply NONE only if ambiguous. ` +
              `Single line only; no markdown fences; no explanation.`,
        },
        {
          role: 'user',
          content: `Invalid or vague shell line:\n${command}\n\nPlatform: ${platform}\nEmit one replacement command or NONE.`,
        },
      ],
      maxTokens: 220,
      temperature: 0.05,
    };

    try {
      const result = await this.withRetry(() => this.provider.complete(opts), 'Shell intent');
      this.throwIfStopped();
      const line = this.stripOneShellLineFromCompletion(result.content || '');
      if (!line) return null;
      if (line === command.trim()) return null;
      if (isPseudoEnglishShellIntent(line)) return null;
      return line;
    } catch {
      return null;
    }
  }

  /** Process tool calls. Read-only calls in a row run together; writes and shell stay in order. */
  private async processToolCalls(toolCalls: ToolCall[]): Promise<boolean> {
    let index = 0;
    while (index < toolCalls.length) {
      this.throwIfStopped();
      if (this.canRunReadInParallel(toolCalls[index])) {
        const batch: ToolCall[] = [];
        while (index < toolCalls.length && this.canRunReadInParallel(toolCalls[index])) {
          batch.push(toolCalls[index]);
          index++;
        }
        const bags = await Promise.all(batch.map((tc) => this.executeOneToolCall(tc)));
        for (const bag of bags) this.history.push(...bag);
      } else {
        const bag = await this.executeOneToolCall(toolCalls[index]);
        this.history.push(...bag);
        index++;
      }
    }
    return true;
  }

  private canRunReadInParallel(tc: ToolCall): boolean {
    if (!PARALLEL_READ_TOOLS.has(tc.function.name)) return false;
    let args: any = {};
    try {
      args = JSON.parse(tc.function.arguments || '{}');
    } catch {
      return false;
    }
    const policy = evaluateToolCall(tc.function.name, args, {
      permissionMode: this.options.permissionMode,
      autoApprove: this.options.autoApprove,
      allowedShellCommands: this.options.allowedShellCommands,
      deniedShellPatterns: this.options.deniedShellPatterns,
    });
    return !policy.blocked && !policy.needsApproval;
  }

  private async executeOneToolCall(tc: ToolCall): Promise<Message[]> {
    const messages: Message[] = [];
    {
      this.throwIfStopped();
      const tool = getTool(tc.function.name);
      if (!tool) {
        this.ui.error(`Unknown tool: ${tc.function.name}`);
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: `Error: Unknown tool "${tc.function.name}". Available tools: ${Object.keys(allTools).join(', ')}`,
        });
        return messages;
      }

      let args: any;
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        this.ui.warn(`Malformed tool arguments for ${tc.function.name}, attempting repair…`);
        try {
          // Try to fix common JSON issues: trailing commas, single quotes
          const fixed = (tc.function.arguments || '{}')
            .replace(/,\s*}/g, '}')
            .replace(/,\s*]/g, ']')
            .replace(/'/g, '"');
          args = JSON.parse(fixed);
        } catch {
          args = {};
        }
      }

      // Model-assisted normalization for English-as-shell mistakes (before repeat key / approvals)
      if (
        (tc.function.name === 'run_command' || tc.function.name === 'run_command_background') &&
        typeof args.command === 'string' &&
        isPseudoEnglishShellIntent(args.command)
      ) {
        this.ui.startThinking('Finding a concrete shell command…');
        let normalized: string | null = null;
        try {
          this.throwIfStopped();
          normalized = await this.resolvePseudoShellCommand(args.command.trim());
        } finally {
          this.ui.stopSpinner();
        }

        if (normalized) {
          this.ui.info(`Shell intent corrected: "${args.command}" → "${normalized}"`);
          args.command = normalized;
        } else {
          const advice =
            pseudoShellAdviceMessage(args.command) ||
            `Unable to derive a runnable command from ${JSON.stringify(args.command)}`;
          this.ui.warn(`Could not normalize vague shell wording (no confident match from model).`);
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function.name,
            content: `${advice}\n(yamx: model-assisted normalization returned no safe substitution; pick an explicit installer binary first, e.g. winget/py/pip/apt/brew.)`,
          });
          return messages;
        }
      }

      // Check if approval is needed
      const toolKey = this.toolCallKey(tc.function.name, args);
      const toolCount = (this.toolCallCounts.get(toolKey) || 0) + 1;
      this.toolCallCounts.set(toolKey, toolCount);
      const repeatLimit = this.repeatLimit(tc.function.name);
      if (toolCount > repeatLimit) {
        const msg = `Skipped repeated ${tc.function.name} call with identical arguments. Choose a different diagnostic or implementation strategy.`;
        if (this.isUserVisibleRepeatWarning(tc.function.name)) {
          this.ui.warn(msg);
        } else {
          this.ui.neuralStatus('guard', `avoided duplicate ${tc.function.name}; trying a different path`);
        }
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: msg,
        });
        return messages;
      }

      const policy = evaluateToolCall(tc.function.name, args, {
        permissionMode: this.options.permissionMode,
        autoApprove: this.options.autoApprove,
        allowedShellCommands: this.options.allowedShellCommands,
        deniedShellPatterns: this.options.deniedShellPatterns,
      });
      if (policy.blocked) {
        const msg = `Policy blocked ${tc.function.name}: ${policy.reason}`;
        this.ui.warn(msg);
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: msg,
        });
        return messages;
      }

      if (this.options.hooksEnabled !== false) {
        const hook = await this.hooks.run('PreToolUse', {
          tool_name: tc.function.name,
          tool_args: args,
        }, tc.function.name);
        if (hook.blocked) {
          const msg = `PreToolUse hook blocked ${tc.function.name}: ${hook.errors.join('\n') || hook.output}`;
          this.ui.warn(msg);
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function.name,
            content: msg,
          });
          return messages;
        }
      }

      // Check if approval is needed
      if (tool.needsApproval && policy.needsApproval) {
        const isDangerous = policy.risk === 'destructive' || (tool.isDangerous?.(args) ?? false);

        if (this.options.nonInteractiveApprovals === 'deny') {
          const msg = `Action requires approval and was blocked in non-interactive mode: ${policy.reason}`;
          this.ui.warn(msg);
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function.name,
            content: msg,
          });
          return messages;
        }

        if (this.options.nonInteractiveApprovals !== 'allow') {
          this.ui.approvalNeeded(tc.function.name, args, isDangerous);
          const approved = await this.ui.confirmAction(
            'Do you want to proceed?',
            !isDangerous
          );

          if (!approved) {
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: tc.function.name,
              content: 'Action was DENIED by the user. Try a different approach or ask for clarification.',
            });
            return messages;
          }
        }
      }

      // Execute the tool
      this.ui.neuralStatus('action', `executing ${tc.function.name}`);
      this.ui.toolCall(tc.function.name, args);
      const startTime = Date.now();

      if (tc.function.name === 'run_command') {
        setRunCommandAbortCheck(() => this.isStopRequested());
      }
      try {
        // Track file changes for undo
        if (['write_file', 'edit_file', 'delete_file', 'multi_edit', 'patch_file', 'move_file', 'write_files'].includes(tc.function.name)) {
          if (tc.function.name === 'write_files' && Array.isArray(args?.writes)) {
            for (const w of args.writes) {
              if (w?.path) await this.trackFileChange(w.path);
            }
          } else if (args.path || args.source) {
            await this.trackFileChange(args.path || args.source);
          }
        }

        const result = await tool.execute(args);
        const duration = Date.now() - startTime;
        if (FILE_EDIT_TOOLS.has(tc.function.name) && fileEditChanged(result)) this.editGeneration += 1;
        this.ui.toolResult(tc.function.name, result, duration);

        if (this.options.hooksEnabled !== false) {
          const hook = await this.hooks.run('PostToolUse', {
            tool_name: tc.function.name,
            tool_args: args,
            result,
            duration_ms: duration,
          }, tc.function.name);
          if (hook.errors.length > 0) {
            this.ui.warn(`PostToolUse hook feedback: ${hook.errors.join('\n')}`);
          }
        }

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: this.prepareToolResultForHistory(tc.function.name, result),
        });
        this.throwIfStopped();
      } catch (error: any) {
        const duration = Date.now() - startTime;
        const errorMsg = `Error executing ${tc.function.name}: ${error.message}`;
        this.ui.error(`${errorMsg} (${duration}ms)`);

        if (this.options.hooksEnabled !== false) {
          const hook = await this.hooks.run('PostToolUseFailure', {
            tool_name: tc.function.name,
            tool_args: args,
            error: error.message,
            duration_ms: duration,
          }, tc.function.name);
          if (hook.errors.length > 0 || hook.output) {
            this.ui.warn(`PostToolUseFailure hook feedback: ${hook.errors.join('\n') || hook.output}`);
          }
        }

        const enrichedError = this.buildFailureProtocolBlob(tc.function.name, `${errorMsg}\n${error?.stack || ''}`);
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: enrichedError,
        });
      } finally {
        if (tc.function.name === 'run_command') {
          setRunCommandAbortCheck(null);
        }
      }
    }
    return messages;
  }

  private toolCallKey(name: string, args: unknown): string {
    return commandRepeatKey(name, args, this.editGeneration);
  }

  private repeatLimit(name: string): number {
    const readOnlyRepeatable = new Set([
      'read_file',
      'read_files',
      'list_files',
      'search_files',
      'grep_search',
      'file_info',
      'directory_tree',
      'git_status',
      'git_diff',
      'git_log',
      'task_list',
      'task_tail',
    ]);
    if (readOnlyRepeatable.has(name)) {
      return ENGINEERING_MODE === 'elite' ? 3 : ENGINEERING_MODE === 'advanced' ? 2 : 2;
    }
    if (name === 'run_command') return 1;
    return 1;
  }

  private isUserVisibleRepeatWarning(name: string): boolean {
    return !new Set([
      'run_command',
      'read_file',
      'read_files',
      'search_files',
      'grep_search',
      'log_inspect',
      'task_tail',
      'git_status',
      'git_diff',
    ]).has(name);
  }

  private compactToolResultForHistory(toolName: string, result: string): string {
    const maxChars = this.options.maxToolResultChars ?? 24_000;
    if (result.length <= maxChars) return result;

    const lines = result.split(/\r?\n/);
    const signalLines = lines.filter((line) => /(error|exception|fatal|failed|failure|warning|warn|traceback|stack|timeout|enoent|eacces|eperm|typeerror|syntaxerror|referenceerror)/i.test(line));
    const head = lines.slice(0, 80).join('\n');
    const tail = lines.slice(-160).join('\n');
    const signals = signalLines.slice(-80).join('\n');

    return [
      `[Tool result compacted for token economy: ${toolName}]`,
      `Original size: ${result.length.toLocaleString()} chars, ${lines.length.toLocaleString()} lines.`,
      signals ? '\nImportant error/warning lines:\n' + signals : '',
      '\nHead:\n' + head,
      '\nTail:\n' + tail,
      '\nUse narrower tool arguments (line ranges, max_results, log_inspect mode=latest-error/summary) if more detail is needed.',
    ].filter(Boolean).join('\n').slice(0, maxChars);
  }

  private prepareToolResultForHistory(toolName: string, result: string): string {
    const base = this.compactToolResultForHistory(toolName, result);
    if (!this.isFailureResult(toolName, result)) return base;

    const domain = this.classifyFailureDomain(result);
    const domainGuidance = this.failureDomainGuidance(domain);

    return [
      base,
      '',
      '<yamx_failure_protocol>',
      `failure_domain=${domain}`,
      'The previous command/tool result indicates a failure. Do not guess a fix from one line only.',
      'Next steps:',
      '1. Identify the exact error message, file path, stack frame, port, missing command, or failing assertion.',
      '2. If a background task or log file may exist, use task_tail or log_inspect mode=auto/latest-error/summary.',
      '3. Search the codebase for the exact symbol/error/config referenced by the logs.',
      '4. Apply the smallest fix, then rerun the narrow failing command.',
      ENGINEERING_MODE === 'elite'
        ? '5. After any patch/config change, run one strict verify command (typecheck/test/build target) before claiming success.'
        : '5. Run a narrow verify command after the fix.',
      domainGuidance,
      '</yamx_failure_protocol>',
    ].join('\n');
  }

  private buildFailureProtocolBlob(toolName: string, rawResult: string): string {
    const domain = this.classifyFailureDomain(rawResult);
    const domainGuidance = this.failureDomainGuidance(domain);
    const snippet = this.extractPrimaryErrorSnippet(rawResult);
    const severity = this.estimateFailureSeverity(domain, rawResult);
    const escalation = this.escalationHint(domain, rawResult);
    return [
      `[${toolName} failure detected]`,
      `primary_error=${snippet}`,
      '',
      '<yamx_failure_protocol>',
      `failure_domain=${domain}`,
      `severity=${severity}`,
      'The previous tool execution failed. Use evidence-driven repair only.',
      'Next steps:',
      '1. Confirm cwd, exact failing command, and first concrete error line.',
      '2. Run one targeted diagnostic command tied to that failure (not broad reinstall).',
      '3. Apply the smallest fix and rerun the narrow failing command.',
      '4. Verify with one explicit check command before success.',
      domainGuidance,
      escalation,
      '</yamx_failure_protocol>',
    ].join('\n');
  }

  private classifyFailureDomain(result: string): string {
    if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|getaddrinfo|DNS|socket hang up|network/i.test(result)) return 'network';
    if (/ENOENT|EACCES|EPERM|permission denied|access denied|not found|no such file/i.test(result)) return 'filesystem';
    if (/EADDRINUSE|port.*in use|address already in use/i.test(result)) return 'port-conflict';
    if (/Cannot find module|Module not found|ModuleNotFoundError|ImportError|require\(\)|ERR_MODULE_NOT_FOUND/i.test(result)) return 'missing-dependency';
    if (/SyntaxError|TypeError|ReferenceError|compile|parse|unexpected token|unterminated/i.test(result)) return 'code-error';
    if (/not recognized|command not found|is not a recognized|is not installed/i.test(result)) return 'missing-tool';
    if (/test.*fail|assertion|expect|assert|FAIL/i.test(result)) return 'test-failure';
    if (/build.*fail|compilation error|linker error|tsc|type error/i.test(result)) return 'build-failure';
    if (/timeout|timed out|deadline exceeded/i.test(result)) return 'timeout';
    if (/out of memory|heap|OOM|allocation failed|ENOMEM/i.test(result)) return 'memory';
    if (/deadlock|race condition|thread.*panic|mutex|lock/i.test(result)) return 'concurrency';
    if (/401|403|unauthorized|forbidden|invalid.*token|expired.*token|authentication.*fail/i.test(result)) return 'auth-failure';
    if (/migration|schema|constraint|foreign key|duplicate.*key|unique.*violation/i.test(result)) return 'database';
    return 'general';
  }

  private failureDomainGuidance(domain: string): string {
    switch (domain) {
      case 'network': return 'Domain hint: check if the target service/URL is reachable, verify DNS resolution, check proxy settings, confirm ports are open.';
      case 'filesystem': return 'Domain hint: verify the path exists, check file permissions, confirm cwd is correct, look for typos in path.';
      case 'port-conflict': return 'Domain hint: find the process using the port (lsof/netstat/ss), kill it or use a different port.';
      case 'missing-dependency': return 'Domain hint: check if the package is installed (npm ls / pip list), verify import paths match installed names, run install if missing.';
      case 'code-error': return 'Domain hint: read the exact file:line referenced, fix the syntax/type issue, then rerun. Check recent edits for introduced bugs. If multiple errors, fix ONLY the first one and rebuild.';
      case 'missing-tool': return 'Domain hint: verify the CLI tool is installed and on PATH (where/which/command -v), install it if missing with the appropriate package manager.';
      case 'test-failure': return 'Domain hint: read the failing test assertion, compare expected vs actual, inspect the tested function, fix the root cause not the test.';
      case 'build-failure': return 'Domain hint: read compiler/build errors from top to bottom, fix ONLY the FIRST error (later ones cascade), then rebuild.';
      case 'timeout': return 'Domain hint: check if the target is reachable, increase timeout if appropriate, verify the operation is not hanging on interactive input.';
      case 'memory': return 'Domain hint: check for infinite loops, unbounded data structures, or large file reads. Consider streaming or pagination.';
      case 'concurrency': return 'Domain hint: check for shared mutable state, missing locks/mutexes, promise/async ordering issues, unhandled rejection. Add proper synchronization.';
      case 'auth-failure': return 'Domain hint: check token/credential validity, verify env vars are set, check token expiration, confirm scope/permissions. Never log full credentials.';
      case 'database': return 'Domain hint: check migration status, verify schema matches code expectations, check constraints and indexes, verify connection string.';
      default: return 'Domain hint: focus on the first error line and trace from there.';
    }
  }

  private extractPrimaryErrorSnippet(result: string): string {
    const lines = (result || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    // Parse stack trace for the most actionable frame
    const stackFrame = lines.find((line) =>
      /^\s+at\s+.+\(?.+:\d+:\d+\)?/.test(line) ||
      /^\s*File "[^"]+", line \d+/.test(line) ||
      /^\s+\d+\s*\|/.test(line) ||
      /^\s*-->\s+src\//.test(line)
    );
    const firstSignal = lines.find((line) =>
      /(error|exception|fatal|failed|failure|traceback|panic|enoent|eacces|eperm|econnrefused|eaddrinuse|syntaxerror|typeerror|referenceerror|not found|not recognized|timed out)/i.test(line)
    );

    // Count total errors for cascade detection
    const errorCount = lines.filter((line) =>
      /\b(error|Error|ERROR)\b/.test(line) && !/\d+ errors?/.test(line)
    ).length;
    const cascadeNote = errorCount > 3 ? ` [${errorCount} errors detected — fix the first one, later ones likely cascade]` : '';

    const chosen = firstSignal || stackFrame || lines[0] || 'unknown error';
    return (chosen.replace(/\s+/g, ' ').slice(0, 260) + cascadeNote).slice(0, 320);
  }

  private estimateFailureSeverity(domain: string, result: string): 'low' | 'medium' | 'high' {
    if (/segfault|core dump|panic|fatal|out of memory|ENOMEM|SIGKILL|SIGSEGV|SIGABRT/i.test(result)) return 'high';
    if (['missing-dependency', 'missing-tool', 'port-conflict', 'build-failure', 'timeout', 'memory', 'network'].includes(domain)) return 'medium';
    return 'low';
  }

  private escalationHint(domain: string, result: string): string {
    if (ENGINEERING_MODE !== 'elite') return 'Escalation: if two fixes fail, broaden diagnostics with focused log/context reads.';
    if (domain === 'network') return 'Escalation: if first probe fails, step through interface → route → DNS → TCP → TLS → HTTP in order.';
    if (domain === 'build-failure' || domain === 'code-error') return 'Escalation: if first fix fails, inspect the exact file:line and nearest related config before any dependency reinstall. For cascading errors, fix ONLY the first error and rebuild.';
    if (domain === 'missing-tool' || domain === 'missing-dependency') return 'Escalation: verify PATH/package manager lockfile state before install/reinstall.';
    if (domain === 'test-failure') return 'Escalation: read the full test file and the implementation being tested. Check if the test expectation is correct or if the implementation changed.';
    if (domain === 'concurrency') return 'Escalation: add logging around the race, reproduce with controlled timing, verify lock ordering and async boundaries.';
    if (domain === 'database') return 'Escalation: check migration status, verify ORM model matches schema, check for pending migrations, verify connection pool config.';
    if (domain === 'auth-failure') return 'Escalation: check token expiration, verify env vars, test with a fresh token, verify API scope/permissions.';
    if (/exit\s+2|exit\s+127|command not found|not recognized/i.test(result)) return 'Escalation: confirm shell selection and executable path, then retry with explicit binary.';
    return 'Escalation: after one failed fix, switch from narrow retry to targeted file/config/log inspection.';
  }

  private isFailureResult(toolName: string, result: string): boolean {
    if (!['run_command', 'run_command_background', 'task_tail', 'log_inspect'].includes(toolName)) return false;
    return /\(exit\s+[1-9]\d*|timed out|error|exception|fatal|failed|failure|traceback|uncaught|unhandled|typeerror|syntaxerror|referenceerror|eaddrinuse|econnrefused|enoent|eacces|eperm|panic|abort|segfault|core dump|SIGKILL|SIGSEGV|SIGABRT|ERR_MODULE|Cannot find module|Module not found|command not found|not recognized|ImportError|ModuleNotFoundError|compilation error|linker error/i.test(result);
  }

  /** Track file changes for undo */
  private async trackFileChange(filePath: string) {
    const fs = await import('fs-extra');
    const target = ensureInsideProject(filePath);
    if (!target.ok) return;
    const fullPath = target.path;
    try {
      if (await fs.default.pathExists(fullPath)) {
        const content = await fs.default.readFile(fullPath, 'utf-8');
        this.fileChanges.push({ path: filePath, oldContent: content, action: 'modified' });
      } else {
        this.fileChanges.push({ path: filePath, oldContent: '', action: 'created' });
      }
    } catch {}
  }

  /** Undo last turn's file changes */
  async undo(): Promise<void> {
    if (this.fileChanges.length === 0) {
      this.ui.warn('No file changes to undo.');
      return;
    }

    const fs = await import('fs-extra');

    for (const change of this.fileChanges.reverse()) {
      const target = ensureInsideProject(change.path);
      if (!target.ok) continue;
      const fullPath = target.path;
      if (change.action === 'created') {
        await fs.default.unlink(fullPath).catch(() => {});
        this.ui.info(`Removed: ${change.path}`);
      } else {
        await fs.default.writeFile(fullPath, change.oldContent, 'utf-8');
        this.ui.info(`Reverted: ${change.path}`);
      }
    }

    this.fileChanges = [];
    this.ui.success('Changes undone.');
  }

  /** Clear history */
  clearHistory() {
    const system = this.history[0];
    this.history = [system];
    this.ui.success('Conversation history cleared.');
    void this.options.onPersist?.();
  }

  /** Compact history — summarize old messages to save tokens */
  async compact() {
    if (this.history.length <= 3) {
      this.ui.warn('Not enough history to compact.');
      return;
    }
    await this.compactMiddle(6, false);
  }

  /** Get usage stats */
  getUsageStats() {
    return {
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      historyLength: this.history.length,
      historyChars: this.estimateHistoryChars(),
    };
  }

  getUI(): UI {
    return this.ui;
  }
}
