import { Provider } from './base.js';
import { OpenAIChatProvider } from './openai-chat.js';

export type ProviderName = 'openai' | 'anthropic' | 'gemini' | 'kimi' | 'grok' | 'openrouter' | 'ollama' | 'custom';

const PROVIDER_NAMES = new Set<ProviderName>([
  'openai',
  'anthropic',
  'gemini',
  'kimi',
  'grok',
  'openrouter',
  'ollama',
  'custom',
]);

export function normalizeProviderName(value: unknown): ProviderName {
  const provider = String(value || '').trim().toLowerCase() as ProviderName;
  return PROVIDER_NAMES.has(provider) ? provider : 'openrouter';
}

export function resolveCloudApiKey(cfg: any, provider: Exclude<ProviderName, 'ollama'>): string | undefined {
  const prov = cfg.providers || {};
  switch (provider) {
    case 'kimi':
      return prov.kimi?.apiKey || process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
    case 'grok':
      return prov.grok?.apiKey || process.env.XAI_API_KEY;
    case 'custom':
      return prov.custom?.apiKey || process.env.YAMX_CUSTOM_API_KEY;
    default: {
      const block = prov[provider] as { apiKey?: string } | undefined;
      return block?.apiKey || process.env[`${provider.toUpperCase()}_API_KEY`];
    }
  }
}

/** Cloud providers need an API key; Ollama does not. */
export function providerUsesCloudApiKey(p: ProviderName): boolean {
  return p !== 'ollama';
}

/** True when config + env has a credential for this provider (always true for Ollama). */
export function hasCloudApiKey(cfg: any, provider: ProviderName): boolean {
  if (provider === 'custom') {
    const base = cfg?.providers?.custom?.baseUrl || process.env.YAMX_CUSTOM_BASE_URL;
    return Boolean(base && String(base).trim());
  }
  if (!providerUsesCloudApiKey(provider)) return true;
  const key = resolveCloudApiKey(cfg, provider as Exclude<ProviderName, 'ollama'>);
  return Boolean(key && String(key).trim());
}

/** Accept an http(s) chat base URL. A pasted /chat/completions path is stripped. */
export function normalizeChatBaseUrl(raw: string): string | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  let path = url.pathname.replace(/\/+$/, '');
  path = path.replace(/\/chat\/completions$/i, '').replace(/\/+$/, '');
  url.pathname = path || '/';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

/** Every connected model is the saved custom endpoint. Named provider names are ignored. */
export function createProvider(_name: string, model: string | undefined, cfg: any): Provider {
  const block = cfg?.providers?.custom as
    | { apiKey?: string; model?: string; baseUrl?: string; extraHeaders?: Record<string, string> }
    | undefined;
  const baseURL = String(block?.baseUrl || process.env.YAMX_CUSTOM_BASE_URL || '').trim();
  if (!baseURL) {
    throw new Error('Custom endpoint not configured. Set base URL, API key, and model with: yamx --onboard');
  }
  const key = String(block?.apiKey || process.env.YAMX_CUSTOM_API_KEY || '').trim() || 'not-needed';
  return new OpenAIChatProvider({
    name: 'custom',
    apiKey: key,
    model: model || block?.model || process.env.YAMX_CUSTOM_MODEL || 'custom',
    baseURL,
    defaultHeaders: block?.extraHeaders,
  });
}
