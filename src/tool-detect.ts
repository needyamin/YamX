/**
 * Cross-platform local tool detection.
 *
 * Probes the system for common analysis/runtime helpers (python, node, jq, awk, ...)
 * so the agent can prefer running them locally instead of doing the work in the model.
 */

import { spawnSync } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';

export type ToolGroup =
  | 'runtimes'
  | 'data'
  | 'search'
  | 'text'
  | 'archive'
  | 'crypto'
  | 'network'
  | 'security'
  | 'database'
  | 'build'
  | 'container'
  | 'cloud'
  | 'shells';

export interface ToolProbeResult {
  name: string;
  path: string | null;
  group: ToolGroup;
  available: boolean;
}

interface ToolEntry {
  name: string;
  group: ToolGroup;
  aliases?: string[];
}

const TOOL_CATALOG: ToolEntry[] = [
  // runtimes / interpreters used for analysis
  { name: 'python', group: 'runtimes', aliases: ['python3', 'py'] },
  { name: 'python3', group: 'runtimes' },
  { name: 'py', group: 'runtimes' },
  { name: 'node', group: 'runtimes' },
  { name: 'deno', group: 'runtimes' },
  { name: 'bun', group: 'runtimes' },
  { name: 'ruby', group: 'runtimes' },
  { name: 'perl', group: 'runtimes' },
  { name: 'php', group: 'runtimes' },
  { name: 'go', group: 'runtimes' },
  { name: 'java', group: 'runtimes' },
  { name: 'dotnet', group: 'runtimes' },
  { name: 'rustc', group: 'runtimes' },
  { name: 'cargo', group: 'runtimes' },

  // structured data
  { name: 'jq', group: 'data' },
  { name: 'yq', group: 'data' },
  { name: 'xq', group: 'data' },
  { name: 'fx', group: 'data' },
  { name: 'mlr', group: 'data' },
  { name: 'duckdb', group: 'data' },
  { name: 'sqlite3', group: 'data' },
  { name: 'csvkit', group: 'data' },

  // search
  { name: 'rg', group: 'search' },
  { name: 'grep', group: 'search' },
  { name: 'egrep', group: 'search' },
  { name: 'ag', group: 'search' },
  { name: 'findstr', group: 'search' },
  { name: 'fd', group: 'search' },

  // text / data slicing
  { name: 'awk', group: 'text' },
  { name: 'gawk', group: 'text' },
  { name: 'sed', group: 'text' },
  { name: 'tr', group: 'text' },
  { name: 'sort', group: 'text' },
  { name: 'uniq', group: 'text' },
  { name: 'wc', group: 'text' },
  { name: 'cut', group: 'text' },
  { name: 'head', group: 'text' },
  { name: 'tail', group: 'text' },
  { name: 'paste', group: 'text' },
  { name: 'join', group: 'text' },
  { name: 'comm', group: 'text' },
  { name: 'diff', group: 'text' },
  { name: 'patch', group: 'text' },

  // archives / compression
  { name: 'tar', group: 'archive' },
  { name: 'gzip', group: 'archive' },
  { name: 'bzip2', group: 'archive' },
  { name: 'xz', group: 'archive' },
  { name: 'zip', group: 'archive' },
  { name: 'unzip', group: 'archive' },
  { name: '7z', group: 'archive' },
  { name: 'zstd', group: 'archive' },

  // crypto / encoding
  { name: 'openssl', group: 'crypto' },
  { name: 'gpg', group: 'crypto' },
  { name: 'base64', group: 'crypto' },
  { name: 'shasum', group: 'crypto' },
  { name: 'sha256sum', group: 'crypto' },
  { name: 'sha1sum', group: 'crypto' },
  { name: 'md5sum', group: 'crypto' },
  { name: 'xxd', group: 'crypto' },
  { name: 'od', group: 'crypto' },

  // network
  { name: 'curl', group: 'network' },
  { name: 'wget', group: 'network' },
  { name: 'http', group: 'network' },
  { name: 'httpie', group: 'network' },
  { name: 'xh', group: 'network' },
  { name: 'ping', group: 'network' },
  { name: 'tracert', group: 'network' },
  { name: 'traceroute', group: 'network' },
  { name: 'pathping', group: 'network' },
  { name: 'nslookup', group: 'network' },
  { name: 'dig', group: 'network' },
  { name: 'host', group: 'network' },
  { name: 'ipconfig', group: 'network' },
  { name: 'ifconfig', group: 'network' },
  { name: 'ip', group: 'network' },
  { name: 'route', group: 'network' },
  { name: 'netstat', group: 'network' },
  { name: 'ss', group: 'network' },
  { name: 'arp', group: 'network' },
  { name: 'nc', group: 'network' },
  { name: 'ncat', group: 'network' },
  { name: 'telnet', group: 'network' },
  { name: 'nmap', group: 'network' },
  { name: 'tcpdump', group: 'network' },
  { name: 'tshark', group: 'network' },
  { name: 'netsh', group: 'network' },
  { name: 'Get-NetIPConfiguration', group: 'network' },

  // security / audit
  { name: 'gitleaks', group: 'security' },
  { name: 'trufflehog', group: 'security' },
  { name: 'semgrep', group: 'security' },
  { name: 'trivy', group: 'security' },
  { name: 'grype', group: 'security' },
  { name: 'snyk', group: 'security' },
  { name: 'osv-scanner', group: 'security' },
  { name: 'npm-audit', group: 'security' },
  { name: 'pip-audit', group: 'security' },
  { name: 'bandit', group: 'security' },
  { name: 'safety', group: 'security' },
  { name: 'cargo-audit', group: 'security' },
  { name: 'govulncheck', group: 'security' },
  { name: 'composer', group: 'security' },
  { name: 'shellcheck', group: 'security' },
  { name: 'hadolint', group: 'security' },
  { name: 'checkov', group: 'security' },
  { name: 'tfsec', group: 'security' },
  { name: 'kube-score', group: 'security' },
  { name: 'kube-linter', group: 'security' },
  { name: 'kubescape', group: 'security' },

  // database clients
  { name: 'psql', group: 'database' },
  { name: 'mysql', group: 'database' },
  { name: 'mongosh', group: 'database' },
  { name: 'redis-cli', group: 'database' },

  // build
  { name: 'make', group: 'build' },
  { name: 'cmake', group: 'build' },
  { name: 'ninja', group: 'build' },

  // container / runtime
  { name: 'docker', group: 'container' },
  { name: 'docker-compose', group: 'container' },
  { name: 'podman', group: 'container' },
  { name: 'podman-compose', group: 'container' },
  { name: 'kubectl', group: 'container' },
  { name: 'kustomize', group: 'container' },
  { name: 'minikube', group: 'container' },
  { name: 'kind', group: 'container' },
  { name: 'helm', group: 'container' },

  // cloud
  { name: 'aws', group: 'cloud' },
  { name: 'gcloud', group: 'cloud' },
  { name: 'az', group: 'cloud' },
  { name: 'gh', group: 'cloud' },
  { name: 'glab', group: 'cloud' },
  { name: 'terraform', group: 'cloud' },
  { name: 'tofu', group: 'cloud' },
  { name: 'ansible', group: 'cloud' },
  { name: 'ansible-playbook', group: 'cloud' },
  { name: 'pulumi', group: 'cloud' },
  { name: 'vercel', group: 'cloud' },
  { name: 'netlify', group: 'cloud' },
  { name: 'flyctl', group: 'cloud' },
  { name: 'wrangler', group: 'cloud' },

  // shells
  { name: 'bash', group: 'shells' },
  { name: 'zsh', group: 'shells' },
  { name: 'fish', group: 'shells' },
  { name: 'pwsh', group: 'shells' },
  { name: 'powershell', group: 'shells' },
  { name: 'wsl', group: 'shells' },
];

const probeCache = new Map<string, string | null>();

function isExecutableFile(candidate: string): boolean {
  try {
    const st = statSync(candidate);
    if (!st.isFile()) return false;
    if (process.platform !== 'win32') accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Filesystem fallback: walk PATH and look for an executable with this name.
 * Used when `where.exe` / `command -v` is unavailable or spawning is blocked,
 * so detection never silently reports "no tools" just because the probe failed.
 */
function resolveViaPath(name: string): string | null {
  const pathEnv = process.env.PATH || process.env.Path || '';
  const isWindows = process.platform === 'win32';
  const extensions = isWindows
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD;.VBS;.JS;.WSF;.WSH').split(';').filter(Boolean)
    : [''];

  for (const dir of pathEnv.split(path.delimiter).filter(Boolean)) {
    for (const ext of extensions) {
      const candidate = path.join(dir, name + ext);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

function resolveTool(name: string): string | null {
  if (probeCache.has(name)) return probeCache.get(name) ?? null;

  const isWindows = process.platform === 'win32';
  let resolved: string | null = null;

  try {
    if (isWindows) {
      const result = spawnSync('where.exe', [name], { encoding: 'utf8', windowsHide: true });
      if (result.status === 0) {
        const first = result.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
        if (first) resolved = first;
      }
    } else {
      const result = spawnSync('command', ['-v', name], { shell: true, encoding: 'utf8' });
      if (result.status === 0) {
        const first = result.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
        if (first) resolved = first;
      }
    }
  } catch {
    resolved = null;
  }

  if (!resolved) resolved = resolveViaPath(name);

  probeCache.set(name, resolved);
  return resolved;
}

export function detectLocalTools(): ToolProbeResult[] {
  const seen = new Set<string>();
  const results: ToolProbeResult[] = [];
  for (const entry of TOOL_CATALOG) {
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);
    const resolved = resolveTool(entry.name);
    results.push({
      name: entry.name,
      path: resolved,
      group: entry.group,
      available: !!resolved,
    });
  }
  return results;
}

export function findTool(name: string): string | null {
  return resolveTool(name);
}

const RUNTIME_ALTERNATIVES: Record<string, string[]> = {
  python: ['python3', 'py'],
  python3: ['python', 'py'],
  py: ['python', 'python3'],
  node: ['deno', 'bun'],
  awk: ['gawk'],
  grep: ['rg', 'egrep', 'findstr'],
  rg: ['grep', 'findstr'],
  shasum: ['sha256sum'],
  sha256sum: ['shasum'],
};

export function findToolWithFallback(preferred: string): { name: string; path: string } | null {
  const candidates = [preferred, ...(RUNTIME_ALTERNATIVES[preferred] || [])];
  for (const candidate of candidates) {
    const resolved = resolveTool(candidate);
    if (resolved) return { name: candidate, path: resolved };
  }
  return null;
}

export function pickFirstAvailable(...names: string[]): { name: string; path: string } | null {
  for (const name of names) {
    const resolved = resolveTool(name);
    if (resolved) return { name, path: resolved };
  }
  return null;
}

export function formatLocalToolsForPrompt(maxPerLine = 8): string {
  const probes = detectLocalTools();
  const grouped = new Map<ToolGroup, ToolProbeResult[]>();
  for (const probe of probes) {
    if (!probe.available) continue;
    const list = grouped.get(probe.group) ?? [];
    list.push(probe);
    grouped.set(probe.group, list);
  }

  const order: ToolGroup[] = ['runtimes', 'data', 'search', 'text', 'archive', 'crypto', 'network', 'security', 'database', 'build', 'container', 'cloud', 'shells'];
  const lines: string[] = [];
  for (const group of order) {
    const items = grouped.get(group);
    if (!items || items.length === 0) continue;
    const names = items.map((item) => item.name);
    const chunks: string[] = [];
    for (let i = 0; i < names.length; i += maxPerLine) {
      chunks.push(names.slice(i, i + maxPerLine).join(', '));
    }
    lines.push(`- ${group}: ${chunks.join(' | ')}`);
  }

  const missing = probes.filter((p) => !p.available && IMPORTANT_FOR_HINT.has(p.name)).map((p) => p.name);
  if (missing.length > 0) {
    lines.push(`- missing (consider fallback): ${missing.join(', ')}`);
  }

  return lines.join('\n') || '- no analysis tools probed';
}

const IMPORTANT_FOR_HINT = new Set([
  'python',
  'python3',
  'node',
  'jq',
  'yq',
  'awk',
  'sed',
  'rg',
  'grep',
  'curl',
  'base64',
  'sha256sum',
  'sqlite3',
  'ping',
  'nslookup',
  'netstat',
  'curl',
  'gitleaks',
  'semgrep',
  'trivy',
  'pip-audit',
  'bandit',
  'hadolint',
  'checkov',
  'docker',
  'kubectl',
  'helm',
  'terraform',
  'ansible-playbook',
]);

export function preferredAnalysisRunner(): { name: string; path: string } | null {
  return pickFirstAvailable('python', 'python3', 'py', 'node', 'deno', 'bun');
}

export function preferredJsonTool(): { name: string; path: string } | null {
  return pickFirstAvailable('jq', 'python', 'python3', 'node');
}

export function preferredYamlTool(): { name: string; path: string } | null {
  return pickFirstAvailable('yq', 'python', 'python3');
}

export function preferredSearchTool(): { name: string; path: string } | null {
  return pickFirstAvailable('rg', 'grep', 'findstr');
}

export function clearProbeCache(): void {
  probeCache.clear();
}

export function getProbedToolNames(): string[] {
  return TOOL_CATALOG.map((entry) => entry.name);
}

export function getToolPathSummary(): string {
  const probes = detectLocalTools();
  const ok = probes.filter((p) => p.available).length;
  const total = probes.length;
  return `${ok}/${total} local tools detected`;
}

export function getRelativeToolPath(absolutePath: string, cwd: string = process.cwd()): string {
  if (!absolutePath) return '';
  const rel = path.relative(cwd, absolutePath);
  return rel && !rel.startsWith('..') ? rel : absolutePath;
}
