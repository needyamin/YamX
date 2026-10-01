/**
 * YamX web API: mask secrets for GET, merge PATCH into on-disk Config.
 */

import type { YamConfig } from '../config/index.js';
import { Config } from '../config/index.js';

const MASK = '********';

/** Safe JSON for GET /api/config (never expose real API keys). */
export function publicConfigView(cfg: YamConfig): YamConfig {
  const providers: YamConfig['providers'] = { ...(cfg.providers || {}) };
  for (const name of Object.keys(providers)) {
    const p = providers[name as keyof typeof providers];
    if (!p || typeof p !== 'object') continue;
    const copy = { ...p } as Record<string, unknown>;
    if (typeof copy.apiKey === 'string' && copy.apiKey.length > 0) {
      copy.apiKey = MASK;
      copy.apiKeyPresent = true;
    } else {
      copy.apiKeyPresent = false;
    }
    (providers as Record<string, unknown>)[name] = copy;
  }
  return {
    ...cfg,
    providers: providers as YamConfig['providers'],
  };
}

function deepMerge<T extends Record<string, unknown>>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base;
  const p = patch as Record<string, unknown>;
  const out = { ...base };
  for (const key of Object.keys(p)) {
    const v = p[key];
    if (v === undefined) continue;
    const cur = out[key as keyof T] as unknown;
    if (
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      cur !== null &&
      typeof cur === 'object' &&
      !Array.isArray(cur)
    ) {
      (out as Record<string, unknown>)[key] = deepMerge(cur as Record<string, unknown>, v);
    } else {
      (out as Record<string, unknown>)[key] = v;
    }
  }
  return out;
}

/** Merge provider objects; only replace apiKey when non-empty and not mask placeholder. */
function mergeProviders(current: YamConfig['providers'], patch: unknown): YamConfig['providers'] {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return current || {};
  const next = { ...(current || {}) };
  for (const name of Object.keys(patch as object)) {
    const incoming = (patch as Record<string, unknown>)[name];
    if (!incoming || typeof incoming !== 'object') continue;
    const prev = { ...((next as Record<string, unknown>)[name] as object) } as Record<string, unknown>;
    const merged = { ...prev };
    if (typeof (incoming as Record<string, unknown>).apiKey === 'string') {
      const k = String((incoming as Record<string, unknown>).apiKey).trim();
      if (k && k !== MASK) merged.apiKey = k;
    }
    if ((incoming as Record<string, unknown>).model !== undefined) {
      merged.model = (incoming as Record<string, unknown>).model;
    }
    if ((incoming as Record<string, unknown>).baseUrl !== undefined) {
      merged.baseUrl = (incoming as Record<string, unknown>).baseUrl;
    }
    const extra = (incoming as Record<string, unknown>).extraHeaders;
    if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
      merged.extraHeaders = extra;
    }
    (next as Record<string, unknown>)[name] = merged;
  }
  return next as YamConfig['providers'];
}

/**
 * Apply JSON body to Config on disk, save, return masked view (re-load merges env again).
 */
export async function loadMergeSaveConfig(patch: unknown): Promise<{ public: YamConfig }> {
  const config = new Config();
  await config.load();
  const cfg = config.get();
  if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
    const p = patch as Record<string, unknown>;
    if (typeof p.defaultProvider === 'string') cfg.defaultProvider = p.defaultProvider;
    if (typeof p.defaultModel === 'string') cfg.defaultModel = p.defaultModel;
    if (p.settings && typeof p.settings === 'object') {
      cfg.settings = deepMerge(cfg.settings as unknown as Record<string, unknown>, p.settings) as YamConfig['settings'];
    }
    if (p.providers && typeof p.providers === 'object') {
      cfg.providers = mergeProviders(cfg.providers || {}, p.providers);
    }
  }
  await config.save();
  const refreshed = new Config();
  const after = await refreshed.load();
  return { public: publicConfigView(after) };
}

export async function resetConfigToDefaults(): Promise<{ public: YamConfig }> {
  const c = new Config();
  await c.resetToDefaults();
  const refreshed = new Config();
  const after = await refreshed.load();
  return { public: publicConfigView(after) };
}
