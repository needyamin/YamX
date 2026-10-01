/**
 * Parse a pasted curl command into an OpenAI-compatible chat endpoint.
 * This is the only way to connect a model.
 */

export interface ParsedCurlSetup {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  extraHeaders?: Record<string, string>;
}

export type CurlParseResult =
  | { ok: true; setup: ParsedCurlSetup }
  | { ok: false; error: string };

const DATA_FLAGS = new Set(['-d', '--data', '--data-raw', '--data-binary', '--data-ascii']);
const HEADER_FLAGS = new Set(['-H', '--header']);

/** Join shell line continuations: backslash, PowerShell backtick, cmd caret. */
export function normalizeCurlContinuations(raw: string): string {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\\\n/g, ' ')
    .replace(/`\n/g, ' ')
    .replace(/\^\n/g, ' ');
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const s = input.trim();
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    const quote = s[i];
    if (quote === '"' || quote === "'") {
      i++;
      let buf = '';
      while (i < s.length && s[i] !== quote) {
        if (quote === '"' && s[i] === '\\' && i + 1 < s.length) {
          buf += s[i + 1];
          i += 2;
          continue;
        }
        buf += s[i++];
      }
      if (i < s.length && s[i] === quote) i++;
      tokens.push(buf);
      continue;
    }
    let buf = '';
    while (i < s.length && !/\s/.test(s[i])) buf += s[i++];
    tokens.push(buf);
  }
  return tokens;
}

function splitHeader(raw: string): { name: string; value: string } | null {
  const idx = raw.indexOf(':');
  if (idx <= 0) return null;
  const name = raw.slice(0, idx).trim();
  const value = raw.slice(idx + 1).trim();
  if (!name) return null;
  return { name, value };
}

function modelFromBody(body: string | undefined): string | undefined {
  if (!body || body.startsWith('@')) return undefined;
  const trimmed = body.trim();
  try {
    const parsed = JSON.parse(trimmed) as { model?: unknown };
    if (typeof parsed?.model === 'string' && parsed.model.trim()) return parsed.model.trim();
  } catch {
    const match = trimmed.match(/"model"\s*:\s*"([^"]+)"/);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return undefined;
}

function chatBaseUrl(rawUrl: string): { ok: true; baseUrl: string } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'That curl command does not contain a valid URL.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Paste an HTTP(S) chat completions URL.' };
  }
  let path = url.pathname.replace(/\/+$/, '') || '/';
  if (/\/chat\/completions$/i.test(path)) {
    path = path.replace(/\/chat\/completions$/i, '') || '/';
  } else if (!/\/v1$/i.test(path)) {
    return {
      ok: false,
      error: 'That URL is not an OpenAI-compatible chat endpoint. Use a URL ending in /v1 or /chat/completions.',
    };
  }
  const pathname = path === '/' ? '' : path;
  const baseUrl = `${url.origin}${pathname}${url.search}`;
  return { ok: true, baseUrl };
}

export function parseCurlSetup(raw: string): CurlParseResult {
  const flat = normalizeCurlContinuations(raw);
  const tokens = tokenize(flat);
  if (tokens.length === 0) {
    return { ok: false, error: 'Paste a curl command. No HTTP(S) URL was found.' };
  }

  let url: string | undefined;
  let method: string | undefined;
  let body: string | undefined;
  const headers: Array<{ name: string; value: string }> = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const lower = token.toLowerCase();
    if (lower === 'curl' || lower === 'curl.exe') continue;
    if (token === '-X' || token === '--request') {
      method = tokens[++i];
      continue;
    }
    if (HEADER_FLAGS.has(token)) {
      const header = splitHeader(tokens[++i] || '');
      if (header) headers.push(header);
      continue;
    }
    if (DATA_FLAGS.has(token)) {
      body = tokens[++i];
      continue;
    }
    if (token === '--url') {
      url = tokens[++i];
      continue;
    }
    if (/^https?:\/\//i.test(token)) {
      url = token;
    }
  }

  if (!url) {
    return { ok: false, error: 'No HTTP(S) URL found in that curl command.' };
  }
  if (method && !/^post$/i.test(method)) {
    return { ok: false, error: 'Chat completions use POST. Remove -X or set it to POST.' };
  }

  const base = chatBaseUrl(url);
  if (!base.ok) return base;

  let apiKey: string | undefined;
  const extraHeaders: Record<string, string> = {};
  for (const header of headers) {
    const name = header.name.toLowerCase();
    if (name === 'authorization') {
      const bearer = header.value.match(/^Bearer\s+(\S+)/i);
      if (bearer?.[1]) apiKey = bearer[1];
      else if (header.value && !/^basic\s+/i.test(header.value)) apiKey = header.value;
      continue;
    }
    if (name === 'x-api-key' || name === 'api-key') {
      if (header.value) apiKey = header.value;
      continue;
    }
    if (name === 'content-type' || name === 'content-length' || name === 'accept') continue;
    if (header.value) extraHeaders[header.name] = header.value;
  }

  const model = modelFromBody(body);
  const setup: ParsedCurlSetup = { baseUrl: base.baseUrl };
  if (apiKey) setup.apiKey = apiKey;
  if (model) setup.model = model;
  if (Object.keys(extraHeaders).length) setup.extraHeaders = extraHeaders;
  return { ok: true, setup };
}
