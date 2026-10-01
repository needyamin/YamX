/**
 * YamX - Configuration Manager
 * Manages API keys, model preferences, and session settings.
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';

export interface YamConfig {
  defaultProvider: string;
  defaultModel: string;
  providers: {
    openai?: { apiKey: string; model?: string; baseUrl?: string };
    anthropic?: { apiKey: string; model?: string };
    gemini?: { apiKey: string; model?: string };
    kimi?: { apiKey: string; model?: string };
    grok?: { apiKey: string; model?: string };
    openrouter?: { apiKey: string; model?: string };
    ollama?: { baseUrl?: string; model?: string };
    /** OpenAI-compatible chat endpoint: base URL, API key, and any model name. */
    custom?: {
      apiKey?: string;
      model?: string;
      baseUrl?: string;
      extraHeaders?: Record<string, string>;
    };
  };
  settings: {
    autoApprove: boolean;
    streamOutput: boolean;
    maxTokens: number;
    temperature: number;
    autoCommit: boolean;
    /** Approx. total JSON size of history before auto-summarization (chars) */
    contextBudgetChars: number;
    /** Keep this many latest messages verbatim when context compacts. */
    contextKeepLastMessages: number;
    /** Optional aggressive mode for weak hardware. */
    contextRolloverMode: 'off' | 'summary-next-session';
    permissionMode: 'default' | 'ask' | 'read-only' | 'auto-safe';
    allowedShellCommands: string[];
    deniedShellPatterns: string[];
    hooksEnabled: boolean;
    modelCouncil: {
      enabled: boolean;
      mode?: 'adaptive' | 'always' | 'off';
    };
    maxToolResultChars: number;
    subagents: {
      enabled: boolean;
      defaultModel?: string;
      maxParallel?: number;
      maxIterations?: number;
    };
    /** When true: neural-status lines, fancy tool banners, turn timing. Default off = quieter CLI. */
    verboseCli?: boolean;
    /** Max assistant markdown chars shown and persisted per reply (hard UX/token guard). */
    maxAssistantMarkdownChars?: number;
    /** Read-only runtime/project ops probes auto-run before agent turn for install/PATH/diagnose asks (default on). */
    preflightRuntimeProbes?: boolean;
    /**
     * When true: before each session (throttled), check npm for a newer @needyamin/yamx and prompt to upgrade.
     * Disable with env YAMX_SKIP_UPDATE_CHECK=1 or in CI.
     */
    checkForUpdates?: boolean;
  };
}

const DEFAULT_CONFIG: YamConfig = {
  defaultProvider: 'custom',
  defaultModel: 'deepseek-chat',
  providers: {},
  settings: {
    autoApprove: false,
    streamOutput: true,
    maxTokens: 16384,
    temperature: 0.1,
    autoCommit: false,
    contextBudgetChars: 280_000,
    contextKeepLastMessages: 16,
    contextRolloverMode: 'off',
    permissionMode: 'default',
    allowedShellCommands: [],
    deniedShellPatterns: [],
    hooksEnabled: true,
    modelCouncil: {
      enabled: false,
      mode: 'adaptive',
    },
    maxToolResultChars: 24_000,
    subagents: {
      enabled: true,
      maxParallel: 3,
      maxIterations: 12,
    },
    verboseCli: false,
    maxAssistantMarkdownChars: 3200,
    preflightRuntimeProbes: true,
    checkForUpdates: false,
  },
};

export class Config {
  private configDir: string;
  private configPath: string;
  private config: YamConfig;

  constructor() {
    this.configDir = path.join(os.homedir(), '.yamx');
    this.configPath = path.join(this.configDir, 'config.json');
    this.config = DEFAULT_CONFIG;
  }

  async load(): Promise<YamConfig> {
    let hasConfigFile = false;
    try {
      hasConfigFile = await fs.pathExists(this.configPath);
      if (hasConfigFile) {
        const data = await fs.readJSON(this.configPath);
        this.config = { ...DEFAULT_CONFIG, ...data, settings: { ...DEFAULT_CONFIG.settings, ...data.settings } };
      }
    } catch {
      // Use defaults
    }

    // DEFAULT_* are bootstrap defaults (applied only when config file does not exist yet).
    if (!hasConfigFile && process.env.DEFAULT_PROVIDER?.trim()) {
      this.config.defaultProvider = process.env.DEFAULT_PROVIDER.trim();
    }
    if (!hasConfigFile && process.env.DEFAULT_MODEL?.trim()) {
      this.config.defaultModel = process.env.DEFAULT_MODEL.trim();
    }

    /**
     * Explicit runtime overrides. If set, these force provider/model every load.
     * Keep unset when you want provider changes from web/CLI config to persist.
     */
    if (process.env.YAMX_PROVIDER?.trim()) {
      this.config.defaultProvider = process.env.YAMX_PROVIDER.trim();
    }
    if (process.env.YAMX_MODEL?.trim()) {
      this.config.defaultModel = process.env.YAMX_MODEL.trim();
    }

    const envBudget = Number(process.env.YAMX_CONTEXT_BUDGET_CHARS);
    if (Number.isFinite(envBudget) && envBudget >= 10_000) {
      this.config.settings.contextBudgetChars = Math.trunc(envBudget);
    }
    const envKeepLast = Number(process.env.YAMX_CONTEXT_KEEP_LAST_MESSAGES);
    if (Number.isFinite(envKeepLast) && envKeepLast >= 0) {
      this.config.settings.contextKeepLastMessages = Math.min(Math.trunc(envKeepLast), 40);
    }
    const envRollover = String(process.env.YAMX_CONTEXT_ROLLOVER_MODE || '').trim().toLowerCase();
    if (envRollover === 'summary-next-session' || envRollover === 'off') {
      this.config.settings.contextRolloverMode = envRollover;
    }

    // Override with env vars
    if (process.env.OPENAI_API_KEY) {
      this.config.providers.openai = {
        ...this.config.providers.openai,
        apiKey: process.env.OPENAI_API_KEY,
      };
    }
    if (process.env.OPENAI_BASE_URL?.trim()) {
      this.config.providers.openai = {
        ...this.config.providers.openai,
        baseUrl: process.env.OPENAI_BASE_URL.trim(),
      } as YamConfig['providers']['openai'];
    }
    if (process.env.YAMX_OPENAI_API_KEY?.trim()) {
      this.config.providers.openai = {
        ...this.config.providers.openai,
        apiKey: process.env.YAMX_OPENAI_API_KEY.trim(),
      };
    }
    if (process.env.YAMX_OPENAI_BASE_URL?.trim()) {
      this.config.providers.openai = {
        ...this.config.providers.openai,
        baseUrl: process.env.YAMX_OPENAI_BASE_URL.trim(),
      } as YamConfig['providers']['openai'];
    }
    if (process.env.ANTHROPIC_API_KEY) {
      this.config.providers.anthropic = {
        ...this.config.providers.anthropic,
        apiKey: process.env.ANTHROPIC_API_KEY,
      };
    }
    if (process.env.GEMINI_API_KEY) {
      this.config.providers.gemini = {
        ...this.config.providers.gemini,
        apiKey: process.env.GEMINI_API_KEY,
      };
    }
    const kimiKey = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
    if (kimiKey) {
      this.config.providers.kimi = {
        ...this.config.providers.kimi,
        apiKey: kimiKey,
      };
    }
    if (process.env.XAI_API_KEY) {
      this.config.providers.grok = {
        ...this.config.providers.grok,
        apiKey: process.env.XAI_API_KEY,
      };
    }
    if (process.env.OPENROUTER_API_KEY) {
      this.config.providers.openrouter = {
        ...this.config.providers.openrouter,
        apiKey: process.env.OPENROUTER_API_KEY,
      };
    }
    if (process.env.YAMX_CUSTOM_API_KEY?.trim() || process.env.YAMX_CUSTOM_BASE_URL?.trim() || process.env.YAMX_CUSTOM_MODEL?.trim()) {
      this.config.providers.custom = {
        ...this.config.providers.custom,
        ...(process.env.YAMX_CUSTOM_API_KEY?.trim()
          ? { apiKey: process.env.YAMX_CUSTOM_API_KEY.trim() }
          : {}),
        ...(process.env.YAMX_CUSTOM_BASE_URL?.trim()
          ? { baseUrl: process.env.YAMX_CUSTOM_BASE_URL.trim() }
          : {}),
        ...(process.env.YAMX_CUSTOM_MODEL?.trim()
          ? { model: process.env.YAMX_CUSTOM_MODEL.trim() }
          : {}),
      };
    }

    return this.config;
  }

  async save(): Promise<void> {
    await fs.ensureDir(this.configDir);
    await fs.writeJSON(this.configPath, this.config, { spaces: 2 });
  }

  get(): YamConfig {
    return this.config;
  }

  set(key: string, value: any) {
    const keys = key.split('.');
    let obj: any = this.config;
    for (let i = 0; i < keys.length - 1; i++) {
      if (obj[keys[i]] === undefined) {
        obj[keys[i]] = {};
      }
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
  }

  /** Replace on-disk config with defaults (sessions under ~/.yamx/sessions are kept). */
  async resetToDefaults(): Promise<void> {
    this.config = {
      ...DEFAULT_CONFIG,
      providers: {},
      settings: { ...DEFAULT_CONFIG.settings },
    };
    await this.save();
  }
}
