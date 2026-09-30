import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { createRequire } from 'node:module';
import stripAnsi from 'strip-ansi';
import { Agent } from '../agent.js';
import { Config, type YamConfig } from '../config/index.js';
import { ContextEngine } from '../context.js';
import { SessionStore, type ChatSession } from '../session-store.js';
import type { Provider } from '../providers/base.js';
import {
  createProvider,
  normalizeProviderName,
  hasCloudApiKey,
  providerUsesCloudApiKey,
  type ProviderName,
} from '../providers/factory.js';
import {
  changeWorkspaceDirectory,
  ensureInsideProject,
  getSmartShell,
  getWorkspaceCwd,
  getWorkspaceRelativeCwd,
  PROJECT_ROOT,
  runProcess,
} from '../tools/utils.js';
import { classifyShellCommand } from '../tool-risk.js';
import { pseudoShellAdviceMessage } from '../tools/shell.js';
import { recordCommandRun } from '../command-memory.js';
import { parseDirectCommand } from '../direct-command.js';
import { classifyUserIntent } from '../intent.js';
import { loadMergeSaveConfig, publicConfigView, resetConfigToDefaults } from './config-handlers.js';
import { getToolCount, getToolDefinitions, getToolsByCategory } from '../tools/registry.js';
import { WEB_CSS, WEB_HTML, WEB_JS } from './ui.js';
import {
  getEngineeringReadiness,
  normalizeEngineeringProfile,
  normalizeEngineeringSuite,
  runEngineeringChallenge,
} from './engineering-diagnostics.js';
import { detectOfflineProjectScanIntent, runOfflineProjectScanAndSave } from '../offline-project-scan.js';

const require = createRequire(import.meta.url);

const SESSIONS_API = '/api/sessions';

function credentialSetupHint(provider: ProviderName): string {
  switch (provider) {
    case 'kimi':
      return 'Set KIMI_API_KEY or MOONSHOT_API_KEY, or paste a key under Settings, Providers.';
    case 'grok':
      return 'Set XAI_API_KEY, or paste a key under Settings, Providers.';
    default:
      return `Set ${provider.toUpperCase()}_API_KEY, or paste a key under Settings, Providers.`;
  }
}

function yamxConfigFilePath(): string {
  return pathJoin(homedir(), '.yamx', 'config.json');
}

function sessionListItem(s: ChatSession) {
  return {
    id: s.id,
    title: s.title,
    cwd: s.cwd,
    updatedAt: s.updatedAt,
    messageCount: s.messages?.length ?? 0,
  };
}

function sessionDetail(s: ChatSession, full: boolean) {
  const base = {
    id: s.id,
    title: s.title,
    cwd: s.cwd,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    messageCount: s.messages?.length ?? 0,
  };
  if (full) return { ...base, messages: s.messages };
  return base;
}

/** Single-session id from `/api/sessions/:id` (not `active`). */
function parseSessionIdPath(pathname: string): string | null {
  const prefix = `${SESSIONS_API}/`;
  if (!pathname.startsWith(prefix)) return null;
  const id = decodeURIComponent(pathname.slice(prefix.length));
  if (!id || id.includes('/') || id === 'active') return null;
  return id;
}

function packageVersion(): string {
  try {
    return (require('../../package.json') as { version?: string }).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export interface WebServerOptions {
  host?: string;
  port?: number;
  allowDangerous?: boolean;
  providerName?: string;
  modelName?: string;
  providerOverride?: Provider;
  authUsername?: string;
  authPassword?: string;
  authRealm?: string;
}

interface WebAuthConfig {
  username: string;
  password: string;
  realm: string;
}

export interface WebCommandOptions {
  command: string;
  cwd?: string;
  shell?: string;
  timeoutMs?: number;
  maxChars?: number;
  allowDangerous?: boolean;
}

export interface WebCommandResult {
  ok: boolean;
  blocked: boolean;
  kind?: 'command' | 'chat' | 'offline_scan' | 'error';
  command: string;
  executedCommand?: string;
  output: string;
  code: number | null;
  timedOut: boolean;
  durationMs: number;
  shell?: string;
  reason?: string;
  risk?: string;
  cwd: string;
  allowDangerous: boolean;
  provider?: string;
  model?: string;
  sessionId?: string;
}

export interface RunningWebServer {
  server: http.Server;
  url: string;
  host: string;
  port: number;
  close(): Promise<void>;
}

const DEFAULT_PORT = 8765;
const DEFAULT_HOST = '127.0.0.1';
const FETCH_BLOCKED_PORTS = new Set([1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080]);

export async function startYamxWebServer(options: WebServerOptions = {}): Promise<RunningWebServer> {
  const host = options.host || DEFAULT_HOST;
  const port = normalizePort(options.port, DEFAULT_PORT);
  const allowDangerous = options.allowDangerous === true;
  const runtime = new WebAgentRuntime(options);
  const auth = normalizeWebAuth({
    username: options.authUsername ?? process.env.YAMX_WEB_USERNAME,
    password: options.authPassword ?? process.env.YAMX_WEB_PASSWORD,
    realm: options.authRealm ?? process.env.YAMX_WEB_AUTH_REALM,
  });
  return startYamxWebServerWithRuntime({ host, port, allowDangerous, runtime, auth }, 0);
}

async function startYamxWebServerWithRuntime(
  options: { host: string; port: number; allowDangerous: boolean; runtime: WebAgentRuntime; auth: WebAuthConfig | null },
  attempt: number
): Promise<RunningWebServer> {
  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res, {
        allowDangerous: options.allowDangerous,
        runtime: options.runtime,
        auth: options.auth,
      });
    } catch (error: any) {
      sendJson(res, 500, { error: error?.message || 'Internal server error' });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const actualPort = address?.port || options.port;
  if (options.port === 0 && FETCH_BLOCKED_PORTS.has(actualPort) && attempt < 8) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    return startYamxWebServerWithRuntime(options, attempt + 1);
  }

  return {
    server,
    host: options.host,
    port: actualPort,
    url: `http://${formatHostForUrl(options.host)}:${actualPort}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export async function executeWebCommand(options: WebCommandOptions): Promise<WebCommandResult> {
  const started = Date.now();
  const command = String(options.command || '').trim();
  const allowDangerous = options.allowDangerous === true;
  if (!command) {
    return failure(command, 'Error: command is required.', started, allowDangerous);
  }

  const directCommand = parseDirectCommand(command);
  if (!directCommand) {
    const intent = classifyUserIntent(command);
    const message =
      intent.kind === 'conversation'
        ? 'Hi. This web panel runs local shell commands. Try `node -v`, `npm test`, `git status`, or use the YamX terminal REPL for chat.'
        : intent.kind === 'clarification'
          ? 'Need a concrete shell command here, for example `npm test` or `git status`.'
          : 'This web panel only executes command-like input. Use a real command, or prefix one with `run:`.';
    return {
      ok: true,
      blocked: false,
      command,
      output: message,
      code: 0,
      timedOut: false,
      durationMs: Date.now() - started,
      cwd: getWorkspaceRelativeCwd(),
      allowDangerous,
    };
  }

  const risk = classifyShellCommand(directCommand);
  if ((risk.destructive || risk.risk === 'sensitive') && !allowDangerous) {
    return {
      ...failure(command, `Blocked: ${risk.reason}. Restart with --allow-dangerous to enable this from the web UI.`, started, allowDangerous),
      blocked: true,
      risk: risk.risk,
    };
  }

  const pseudo = pseudoShellAdviceMessage(directCommand);
  if (pseudo) return failure(command, pseudo, started, allowDangerous);

  const cdTarget = parsePersistentCd(directCommand);
  if (!options.cwd && cdTarget !== undefined) {
    const rel = cdTarget ? changeWorkspaceDirectory(cdTarget) : getWorkspaceRelativeCwd();
    return {
      ok: !rel.startsWith('Error:'),
      blocked: false,
      command,
      executedCommand: directCommand,
      output: rel.startsWith('Error:') ? rel : `cwd: ${rel}`,
      code: rel.startsWith('Error:') ? 1 : 0,
      timedOut: false,
      durationMs: Date.now() - started,
      cwd: getWorkspaceRelativeCwd(),
      allowDangerous,
    };
  }

  const cwd = options.cwd
    ? ensureInsideProject(options.cwd)
    : { ok: true as const, path: getWorkspaceCwd() };
  if (!cwd.ok) return failure(command, cwd.error, started, allowDangerous);

  const smart = getSmartShell(directCommand, options.shell || 'auto');
  const timeoutMs = boundedNumber(options.timeoutMs, 120_000, 1_000, 600_000);
  const maxChars = boundedNumber(options.maxChars, 80_000, 1_000, 500_000);
  const result = await runProcess(smart.shell.command, [...smart.shell.args, smart.command], {
    cwd: cwd.path,
    timeoutMs,
    maxChars,
  });

  await recordCommandRun({
    command: smart.command,
    cwd: cwd.path,
    code: result.code,
    timedOut: result.timedOut,
    output: result.text,
  });

  let output = result.text;
  if (result.timedOut) output = output ? `${output}\n(timed out after ${timeoutMs}ms)` : `(timed out after ${timeoutMs}ms)`;
  if (result.code !== 0 && result.code !== null) output = output ? `${output}\n(exit ${result.code})` : `(exit ${result.code})`;
  if (!output) output = result.code === 0 ? '(no output)' : `(exit ${result.code}, no output)`;

  return {
    ok: result.code === 0 && !result.timedOut,
    blocked: false,
    command,
    executedCommand: smart.command,
    output,
    code: result.code,
    timedOut: result.timedOut,
    durationMs: Date.now() - started,
    shell: smart.shell.label,
    reason: smart.reason,
    risk: risk.risk,
    cwd: getWorkspaceRelativeCwd(),
    allowDangerous,
  };
}

class WebAgentRuntime {
  private readonly allowDangerous: boolean;
  private readonly providerName?: string;
  private readonly modelName?: string;
  private readonly providerOverride?: Provider;
  private agentEnv?: {
    agent: Agent;
    cfg: YamConfig;
    store: SessionStore;
    session: ChatSession;
    provider: Provider;
  };
  private cfg?: YamConfig;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: WebServerOptions) {
    this.allowDangerous = options.allowDangerous === true;
    this.providerName = options.providerName;
    this.modelName = options.modelName;
    this.providerOverride = options.providerOverride;
  }

  async state(): Promise<{
    provider: string;
    model: string;
    sessionId?: string;
    providerUsesApiKey: boolean;
    providerApiKeyConfigured: boolean;
    agentCanRun: boolean;
    providerHint: string | null;
    sessionWarm?: boolean;
  }> {
    if (this.agentEnv) {
      const name = normalizeProviderName(this.agentEnv.provider.name);
      const usesKey = providerUsesCloudApiKey(name);
      return {
        provider: name,
        model: this.agentEnv.provider.modelId,
        sessionId: this.agentEnv.session.id,
        providerUsesApiKey: usesKey,
        providerApiKeyConfigured: true,
        agentCanRun: true,
        providerHint: null,
        sessionWarm: true,
      };
    }

    const cfg = await this.loadConfig();
    const pid = normalizeProviderName(this.providerName ?? cfg.defaultProvider ?? 'openrouter');
    const usesKey = providerUsesCloudApiKey(pid);

    const block = cfg.providers?.[pid as keyof YamConfig['providers']] as { model?: string } | undefined;
    const cfgBlockModel =
      typeof block?.model === 'string' ? String(block.model).trim() : '';
    const dm = typeof cfg.defaultModel === 'string' ? cfg.defaultModel.trim() : '';
    const modelCli = this.modelName && String(this.modelName).trim();

    const model = modelCli || dm || cfgBlockModel || '';

    const credentialed = hasCloudApiKey(cfg, pid);
    const canRun = credentialed;
    let hint: string | null = null;
    if (usesKey && !credentialed) {
      hint = credentialSetupHint(pid);
    }

    return {
      provider: pid,
      model,
      sessionId: undefined,
      providerUsesApiKey: usesKey,
      providerApiKeyConfigured: credentialed,
      agentCanRun: canRun,
      providerHint: hint,
      sessionWarm: false,
    };
  }

  async handleInput(options: Omit<WebCommandOptions, 'allowDangerous'>): Promise<WebCommandResult> {
    if (parseDirectCommand(options.command)) {
      return executeWebCommand({ ...options, allowDangerous: this.allowDangerous });
    }
    return this.chat(options.command);
  }

  async chat(message: string): Promise<WebCommandResult> {
    return this.enqueue(() => this.chatNow(message));
  }

  private async chatNow(message: string): Promise<WebCommandResult> {
    const started = Date.now();
    const command = String(message || '').trim();
    if (!command) return failure(command, 'Error: message is required.', started, this.allowDangerous);

    const intent = classifyUserIntent(command);
    // Conversational input is only short-circuited when nothing can answer it.
    // With a provider available (override, warm env, or configured credentials)
    // greetings and vague requests still reach the agent.
    const canAnswer = await this.agentCanAnswer();
    if (intent.kind === 'conversation' && !canAnswer) {
      const { provider, model } = await this.resolveProviderLabels();
      return {
        ok: true,
        blocked: false,
        kind: 'chat',
        command,
        output:
          'This YamX web panel is command-focused. Send a concrete CLI task like `git status`, `npm test`, `ls`, or ask for a command for Windows/macOS/Linux.',
        code: 0,
        timedOut: false,
        durationMs: Date.now() - started,
        cwd: getWorkspaceRelativeCwd(),
        allowDangerous: this.allowDangerous,
        provider,
        model,
        sessionId: this.agentEnv?.session.id,
      };
    }

    if (intent.kind === 'clarification' && !canAnswer) {
      const { provider, model } = await this.resolveProviderLabels();
      return {
        ok: true,
        blocked: false,
        kind: 'chat',
        command,
        output:
          'Need a concrete command-line request. Example: `install node on ubuntu`, `git undo last commit`, or `find large files on windows`.',
        code: 0,
        timedOut: false,
        durationMs: Date.now() - started,
        cwd: getWorkspaceRelativeCwd(),
        allowDangerous: this.allowDangerous,
        provider,
        model,
        sessionId: this.agentEnv?.session.id,
      };
    }

    const scanIntent = detectOfflineProjectScanIntent(command);
    if (scanIntent) {
      try {
        const result = await runOfflineProjectScanAndSave(PROJECT_ROOT, scanIntent);
        if (this.agentEnv) {
          const sp = await new ContextEngine(PROJECT_ROOT).buildSystemPrompt();
          this.agentEnv.agent.refreshSystemPrompt(sp);
          this.agentEnv.session.messages = this.agentEnv.agent.getHistory();
          await this.agentEnv.store.saveSession(this.agentEnv.session);
        }
        const { provider, model } = await this.resolveProviderLabels();
        return {
          ok: true,
          blocked: false,
          kind: 'offline_scan',
          command,
          output: result.shortLines.join('\n'),
          code: 0,
          timedOut: false,
          durationMs: Date.now() - started,
          cwd: getWorkspaceRelativeCwd(),
          allowDangerous: this.allowDangerous,
          provider,
          model,
          sessionId: this.agentEnv?.session.id,
        };
      } catch (error: any) {
        return {
          ...failure(
            command,
            `Offline scan failed: ${error?.message || error}`,
            started,
            this.allowDangerous
          ),
          kind: 'error',
        };
      }
    }

    try {
      const env = await this.getAgentEnv();
      const captured = await captureConsoleOutput(async () => {
        await env.agent.chat(command);
      });
      const fromTurn = assistantTextAfterLastUserMessage(env.agent.getHistory());
      const output = fromTurn.trim() || captured.trim() || '(no response)';
      return {
        ok: true,
        blocked: false,
        kind: 'chat',
        command,
        output,
        code: 0,
        timedOut: false,
        durationMs: Date.now() - started,
        cwd: getWorkspaceRelativeCwd(),
        allowDangerous: this.allowDangerous,
        provider: env.provider.name,
        model: env.provider.modelId,
        sessionId: env.session.id,
      };
    } catch (error: any) {
      return {
        ...failure(command, `AI error: ${error?.message || 'Unable to run YamX agent.'}`, started, this.allowDangerous),
        kind: 'chat',
      };
    }
  }

  /** True when a provider can actually answer: override, warm env, or configured credentials. */
  private async agentCanAnswer(): Promise<boolean> {
    if (this.providerOverride || this.agentEnv) return true;
    try {
      const cfg = await this.loadConfig();
      const pid = normalizeProviderName(this.providerName ?? cfg.defaultProvider ?? 'openrouter');
      if (!providerUsesCloudApiKey(pid)) return true;
      return hasCloudApiKey(cfg, pid);
    } catch {
      return false;
    }
  }

  /**
   * Provider/model labels for responses that return before the agent env exists.
   * The env is lazy, so greeting/clarification replies previously reported
   * `undefined` for provider even when an override or configured default was set.
   */
  private async resolveProviderLabels(): Promise<{ provider?: string; model?: string }> {
    if (this.providerOverride) {
      return { provider: this.providerOverride.name, model: this.providerOverride.modelId };
    }
    if (this.agentEnv) {
      return { provider: this.agentEnv.provider.name, model: this.agentEnv.provider.modelId };
    }
    try {
      const cfg = await this.loadConfig();
      return {
        provider: this.providerName || cfg.defaultProvider,
        model: this.modelName || cfg.defaultModel,
      };
    } catch {
      return {};
    }
  }

  private async enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async loadConfig(): Promise<YamConfig> {
    if (this.cfg) return this.cfg;
    const config = new Config();
    this.cfg = await config.load();
    return this.cfg;
  }

  /** After config.json changes: drop caches so the next chat uses new provider + settings. */
  invalidateCaches(): void {
    this.cfg = undefined;
    this.agentEnv = undefined;
  }

  private async getAgentEnv(): Promise<NonNullable<WebAgentRuntime['agentEnv']>> {
    if (this.agentEnv) return this.agentEnv;

    const cfg = await this.loadConfig();
    const provider = this.providerOverride || createProvider(
      this.providerName || cfg.defaultProvider || 'openrouter',
      this.modelName || cfg.defaultModel,
      cfg
    );
    const contextEngine = new ContextEngine(PROJECT_ROOT);
    const systemPrompt = await contextEngine.buildSystemPrompt();
    const store = new SessionStore();
    await store.init();

    let session: ChatSession | null = null;
    const activeId = await store.getActiveSessionId();
    if (activeId) session = await store.loadSession(activeId);
    if (!session) {
      session = await store.createSession(PROJECT_ROOT, { role: 'system', content: systemPrompt });
    }

    const saveToDisk = async () => {
      if (!this.agentEnv) return;
      this.agentEnv.session.messages = this.agentEnv.agent.getHistory();
      this.agentEnv.store.updateTitleFromFirstMessage(this.agentEnv.session);
      await this.agentEnv.store.saveSession(this.agentEnv.session);
    };

    const agent = new Agent(provider, systemPrompt, {
      autoApprove: true,
      stream: false,
      maxTokens: cfg.settings?.maxTokens || 16384,
      temperature: cfg.settings?.temperature ?? 0.1,
      initialHistory: session.messages,
      onPersist: saveToDisk,
      contextBudgetChars: cfg.settings?.contextBudgetChars ?? 280_000,
      contextKeepLastMessages: cfg.settings?.contextKeepLastMessages ?? 16,
      contextRolloverMode: cfg.settings?.contextRolloverMode ?? 'off',
      permissionMode: cfg.settings?.permissionMode ?? 'default',
      allowedShellCommands: cfg.settings?.allowedShellCommands ?? [],
      deniedShellPatterns: cfg.settings?.deniedShellPatterns ?? [],
      hooksEnabled: cfg.settings?.hooksEnabled !== false,
      modelCouncilEnabled: cfg.settings?.modelCouncil?.enabled === true,
      modelCouncilMode: cfg.settings?.modelCouncil?.mode ?? 'adaptive',
      maxToolResultChars: cfg.settings?.maxToolResultChars ?? 24_000,
      verboseCli: false,
      maxAssistantMarkdownChars: cfg.settings?.maxAssistantMarkdownChars ?? 3200,
      preflightRuntimeProbes: cfg.settings?.preflightRuntimeProbes !== false,
      nonInteractiveApprovals: this.allowDangerous ? 'allow' : 'deny',
      headlessUi: true,
    });

    this.agentEnv = { agent, cfg, store, session, provider };
    return this.agentEnv;
  }

  /** New chat file under ~/.yamx/sessions with current system prompt. */
  async createChatSession(body: {
    title?: string;
    cwd?: string;
    activate?: boolean;
  }): Promise<ChatSession> {
    const cfg = await this.loadConfig();
    const contextEngine = new ContextEngine(PROJECT_ROOT);
    const systemPrompt = await contextEngine.buildSystemPrompt();
    const store = new SessionStore();
    await store.init();
    let cwd = getWorkspaceCwd();
    if (typeof body.cwd === 'string' && body.cwd.trim()) {
      const resolved = ensureInsideProject(body.cwd.trim());
      if (!resolved.ok) throw new Error(resolved.error);
      cwd = resolved.path;
    }
    const activate = body.activate !== false;
    const session = await store.createSession(
      cwd,
      { role: 'system', content: systemPrompt },
      { activate }
    );
    if (typeof body.title === 'string' && body.title.trim()) {
      session.title = body.title.trim().slice(0, 240);
      await store.saveSession(session);
    }
    this.invalidateCaches();
    return session;
  }
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: { allowDangerous: boolean; runtime: WebAgentRuntime; auth: WebAuthConfig | null }
): Promise<void> {
  const url = new URL(req.url || '/', 'http://localhost');
  if (!isAuthorized(req, options.auth)) {
    return sendAuthRequired(req, res, options.auth?.realm || 'YamX Web');
  }
  if (req.method === 'GET' && url.pathname === '/') return sendText(res, 200, WEB_HTML, 'text/html; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/style.css') return sendText(res, 200, WEB_CSS, 'text/css; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/app.js') return sendText(res, 200, WEB_JS, 'text/javascript; charset=utf-8');

  try {
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const agentState = await options.runtime.state();
      return sendJson(res, 200, {
        ok: true,
        cwd: getWorkspaceRelativeCwd(),
        root: PROJECT_ROOT,
        platform: process.platform,
        allowDangerous: options.allowDangerous,
        provider: agentState.provider,
        model: agentState.model,
        sessionId: agentState.sessionId,
        providerUsesApiKey: agentState.providerUsesApiKey,
        providerApiKeyConfigured: agentState.providerApiKeyConfigured,
        agentCanRun: agentState.agentCanRun,
        providerHint: agentState.providerHint,
        sessionWarm: agentState.sessionWarm ?? false,
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/info') {
      return sendJson(res, 200, {
        ok: true,
        version: packageVersion(),
        node: process.version,
        platform: process.platform,
        cwd: getWorkspaceRelativeCwd(),
        projectRoot: PROJECT_ROOT,
        configPath: yamxConfigFilePath(),
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/config') {
      const config = new Config();
      const cfg = await config.load();
      return sendJson(res, 200, { ok: true, config: publicConfigView(cfg), configPath: yamxConfigFilePath() });
    }

    if (req.method === 'PATCH' && url.pathname === '/api/config') {
      const body = await readJsonBody(req);
      const { public: pub } = await loadMergeSaveConfig(body);
      options.runtime.invalidateCaches();
      return sendJson(res, 200, { ok: true, config: pub });
    }

    if (req.method === 'POST' && url.pathname === '/api/config/reset') {
      await resetConfigToDefaults();
      options.runtime.invalidateCaches();
      const config = new Config();
      const cfg = await config.load();
      return sendJson(res, 200, { ok: true, config: publicConfigView(cfg) });
    }

    if (req.method === 'POST' && url.pathname === '/api/runtime/reload') {
      options.runtime.invalidateCaches();
      return sendJson(res, 200, { ok: true, message: 'Agent cache cleared; next request loads fresh config.' });
    }

    if (req.method === 'GET' && url.pathname === '/api/tools') {
      return sendJson(res, 200, {
        ok: true,
        count: getToolCount(),
        byCategory: getToolsByCategory(),
        tools: getToolDefinitions().map((d) => ({
          name: d.name,
          description: d.description,
          parameters: d.parameters,
        })),
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/engineering/readiness') {
      const force = url.searchParams.get('force');
      const report = await getEngineeringReadiness(force === '1' || force === 'true');
      return sendJson(res, 200, { ok: true, report });
    }

    if (req.method === 'POST' && url.pathname === '/api/engineering/challenge') {
      const body = await readJsonBody(req);
      const suite = normalizeEngineeringSuite(body.suite);
      const profile = normalizeEngineeringProfile(body.profile);
      const force = body.force === true;
      const report = await runEngineeringChallenge({ suite, profile, force });
      return sendJson(res, 200, { ok: true, report });
    }

    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      const store = new SessionStore();
      await store.init();
      const list = await store.listSessions();
      const activeSessionId = await store.getActiveSessionId();
      return sendJson(res, 200, {
        ok: true,
        activeSessionId,
        sessions: list.map(sessionListItem),
      });
    }

    if (req.method === 'POST' && url.pathname === `${SESSIONS_API}/active`) {
      const body = await readJsonBody(req);
      const id = body.id === null || body.id === '' ? null : String(body.id);
      const store = new SessionStore();
      await store.init();
      if (id) {
        const session = await store.loadSession(id);
        if (!session) return sendJson(res, 400, { ok: false, error: 'Session not found' });
      }
      await store.setActiveSessionId(id);
      options.runtime.invalidateCaches();
      return sendJson(res, 200, { ok: true, activeSessionId: id });
    }

    if (req.method === 'POST' && url.pathname === SESSIONS_API) {
      const body = await readJsonBody(req);
      const session = await options.runtime.createChatSession({
        title: typeof body.title === 'string' ? body.title : undefined,
        cwd: typeof body.cwd === 'string' ? body.cwd : undefined,
        activate: body.activate !== false,
      });
      return sendJson(res, 201, { ok: true, session: sessionDetail(session, false) });
    }

    const resourceSessionId = parseSessionIdPath(url.pathname);
    if (resourceSessionId) {
      const store = new SessionStore();
      await store.init();

      if (req.method === 'GET') {
        const session = await store.loadSession(resourceSessionId);
        if (!session) return sendJson(res, 404, { ok: false, error: 'Session not found' });
        const full = url.searchParams.get('full') === '1' || url.searchParams.get('full') === 'true';
        return sendJson(res, 200, { ok: true, session: sessionDetail(session, full) });
      }

      if (req.method === 'PATCH') {
        const body = await readJsonBody(req);
        const session = await store.loadSession(resourceSessionId);
        if (!session) return sendJson(res, 404, { ok: false, error: 'Session not found' });
        if (typeof body.title === 'string') {
          const t = body.title.trim();
          if (t) session.title = t.slice(0, 240);
        }
        await store.saveSession(session);
        options.runtime.invalidateCaches();
        return sendJson(res, 200, { ok: true, session: sessionDetail(session, false) });
      }

      if (req.method === 'DELETE') {
        const deleted = await store.deleteSession(resourceSessionId);
        if (!deleted) return sendJson(res, 404, { ok: false, error: 'Session not found' });
        options.runtime.invalidateCaches();
        return sendJson(res, 200, { ok: true, deleted: resourceSessionId });
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/routes') {
      const groups = [
        {
          name: 'State & project',
          endpoints: [
            { method: 'GET', path: '/api/state', note: 'cwd, provider, model, sessionId + API key · agent-ready flags · hints' },
            { method: 'GET', path: '/api/info', note: 'version, node, configPath, projectRoot' },
          ],
        },
        {
          name: 'Configuration',
          endpoints: [
            { method: 'GET', path: '/api/config', note: 'masked ~/.yamx/config.json' },
            { method: 'PATCH', path: '/api/config', body: '{ partial }', note: 'merge + save' },
            { method: 'POST', path: '/api/config/reset', body: '{}', note: 'reset defaults' },
            { method: 'POST', path: '/api/runtime/reload', body: '{}', note: 'invalidate agent cache' },
          ],
        },
        {
          name: 'Sessions (CRUD)',
          endpoints: [
            { method: 'GET', path: '/api/sessions', note: 'list + activeSessionId' },
            { method: 'POST', path: '/api/sessions', body: '{ title?, cwd?, activate? }', note: 'create chat' },
            { method: 'GET', path: '/api/sessions/:id', note: 'read; ?full=1 includes messages' },
            { method: 'PATCH', path: '/api/sessions/:id', body: '{ title }', note: 'rename' },
            { method: 'DELETE', path: '/api/sessions/:id', note: 'delete' },
            { method: 'POST', path: '/api/sessions/active', body: '{ id } | null', note: 'set active' },
          ],
        },
        {
          name: 'Agent & tools',
          endpoints: [
            { method: 'GET', path: '/api/tools', note: 'definitions + categories' },
            { method: 'GET', path: '/api/engineering/readiness', note: 'offline readiness snapshot + scores' },
            {
              method: 'POST',
              path: '/api/engineering/challenge',
              body: '{ suite?, profile?, force? }',
              note: 'run suite: vm/fullstack/devops/network/security/all',
            },
            {
              method: 'POST',
              path: '/api/command',
              body: '{ command, shell?, cwd?, timeoutMs?, maxChars? }',
              note: 'shell or chat with optional execution overrides',
            },
            { method: 'POST', path: '/api/chat', body: '{ message }', note: 'agent only' },
          ],
        },
      ];
      const routes = groups.flatMap((g) => g.endpoints.map((e) => ({ ...e, group: g.name })));
      return sendJson(res, 200, { ok: true, groups, routes });
    }

    if (req.method === 'POST' && url.pathname === '/api/command') {
      const body = await readJsonBody(req);
      const result = await options.runtime.handleInput({
        command: String(body.command || ''),
        shell: typeof body.shell === 'string' ? body.shell : undefined,
        cwd: typeof body.cwd === 'string' ? body.cwd : undefined,
        timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined,
        maxChars: typeof body.maxChars === 'number' ? body.maxChars : undefined,
      });
      return sendJson(res, 200, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const body = await readJsonBody(req);
      const result = await options.runtime.chat(String(body.message || body.command || ''));
      return sendJson(res, 200, result);
    }
  } catch (error: any) {
    const msg = error?.message || 'Bad request';
    return sendJson(res, 400, { ok: false, error: msg });
  }

  sendJson(res, 404, { error: 'Not found' });
}

function parsePersistentCd(command: string): string | undefined {
  const match = /^(?:cd|chdir|pushd)(?:\s+(.+))?$/i.exec(command.trim());
  if (!match) return undefined;
  return (match[1] || '').trim().replace(/^["']|["']$/g, '');
}

async function captureConsoleOutput(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalErrorWrite = process.stderr.write.bind(process.stderr);

  const push = (...args: unknown[]) => {
    chunks.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  };

  console.log = (...args: unknown[]) => push(...args);
  console.warn = (...args: unknown[]) => push(...args);
  console.error = (...args: unknown[]) => push(...args);
  (process.stdout.write as any) = (chunk: any, ..._args: any[]) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
    return true;
  };
  (process.stderr.write as any) = (chunk: any, ..._args: any[]) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
    return true;
  };

  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    (process.stdout.write as any) = originalWrite;
    (process.stderr.write as any) = originalErrorWrite;
  }

  return stripAnsi(chunks.join('\n'))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Assistant reply text for the current turn (after the last user message in history). */
function assistantTextAfterLastUserMessage(
  history: Array<{ role: string; content: string | null | undefined }>
): string {
  let lastUserIdx = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  for (let i = history.length - 1; i > lastUserIdx; i--) {
    const message = history[i];
    if (message.role === 'assistant' && message.content?.trim()) {
      return message.content.trim();
    }
  }
  return '';
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function normalizePort(value: unknown, fallback: number): number {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return fallback;
  return port;
}

function normalizeWebAuth(input: { username?: string; password?: string; realm?: string }): WebAuthConfig | null {
  const username = String(input.username ?? '').trim();
  const password = String(input.password ?? '');
  if (!username || !password) return null;
  const realmRaw = String(input.realm ?? '').trim();
  return {
    username,
    password,
    realm: realmRaw || 'YamX Web',
  };
}

function isAuthorized(req: http.IncomingMessage, auth: WebAuthConfig | null): boolean {
  if (!auth) return true;
  const value = req.headers.authorization;
  if (typeof value !== 'string' || !value.startsWith('Basic ')) return false;
  const encoded = value.slice(6).trim();
  if (!encoded) return false;
  let decoded = '';
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return false;
  }
  const split = decoded.indexOf(':');
  if (split < 0) return false;
  const username = decoded.slice(0, split);
  const password = decoded.slice(split + 1);
  return safeEquals(username, auth.username) && safeEquals(password, auth.password);
}

function safeEquals(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function sendAuthRequired(req: http.IncomingMessage, res: http.ServerResponse, realm: string): void {
  const safeRealm = realm.replace(/\\/g, '').replace(/"/g, '');
  res.setHeader('www-authenticate', `Basic realm="${safeRealm}", charset="UTF-8"`);
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  if (path.startsWith('/api/')) {
    sendJson(res, 401, { ok: false, error: 'Authentication required.' });
    return;
  }
  sendText(res, 401, 'Authentication required.', 'text/plain; charset=utf-8');
}

function failure(command: string, output: string, started: number, allowDangerous: boolean): WebCommandResult {
  return {
    ok: false,
    blocked: false,
    command,
    output,
    code: 1,
    timedOut: false,
    durationMs: Date.now() - started,
    cwd: getWorkspaceRelativeCwd(),
    allowDangerous,
  };
}

function formatHostForUrl(host: string): string {
  if (host === '0.0.0.0') return '127.0.0.1';
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (!type.includes('application/json')) throw new Error('Expected application/json.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 32_768) throw new Error('Request body too large.');
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

function sendText(res: http.ServerResponse, status: number, body: string, contentType: string): void {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'self'",
  });
  res.end(body);
}

function sendJson(res: http.ServerResponse, status: number, body: any): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}
