/**
 * YamX command corrections — local, offline command intelligence for wrong commands.
 *
 * Three correction sources, merged and ranked:
 *  1. cross-platform translation (Windows cmd on Linux/macOS and vice versa),
 *  2. first-word typo correction against binaries actually available on this machine,
 *  3. the existing fuzzy `suggestCommandFix` database as a fallback.
 *
 * Every correction is verified against the local PATH before it is proposed, and
 * destructive corrections are flagged so the caller can refuse auto-execution.
 */

import path from 'node:path';
import { isDangerousShellCommand } from './tool-risk.js';
import { isCommandNotFoundFailure } from './direct-shell-diagnose.js';
import { suggestCommandFix } from './command-intelligence.js';
import { getLocalFirstPathEntries } from './tools/utils.js';

export type PlatformTarget = 'windows' | 'linux' | 'macos';

export interface CommandCorrection {
  original: string;
  corrected: string;
  kind: 'cross-platform' | 'typo' | 'fuzzy';
  confidence: number;
  reason: string;
  dangerous: boolean;
  target?: PlatformTarget;
}

export interface CorrectionOptions {
  /** Failure output of the original run, when correcting an actual failure. */
  output?: string;
  cwd?: string;
}

export interface TranslateResult {
  corrected: string;
  confidence: number;
  reason: string;
  target: PlatformTarget;
}

/** Minimum confidence for a correction to be executed without asking. */
export const AUTO_FIX_MIN_CONFIDENCE = 0.75;

export function currentTarget(): PlatformTarget {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return 'linux';
}

/** YAMX_AUTO_FIX=off/0/false/no/disabled turns off unattended auto-execution. */
export function autoFixEnabled(): boolean {
  const raw = String(process.env.YAMX_AUTO_FIX ?? '').toLowerCase().trim();
  return !['off', '0', 'false', 'no', 'disabled'].includes(raw);
}

/* ── Local executable discovery (PATH + project-local bin dirs) ────────── */

const SHELL_BUILTINS = new Set([
  'cd', 'pwd', 'dir', 'ls', 'echo', 'set', 'export', 'unset', 'history',
  'type', 'alias', 'unalias', 'pushd', 'popd', 'where', 'cls', 'clear',
  'ver', 'copy', 'move', 'del', 'erase', 'mkdir', 'rmdir', 'md', 'rd',
  'ren', 'start', 'exit', 'for', 'if', 'goto', 'call', 'shift', 'rem',
  'source', 'env', 'printenv', 'which', 'false', 'true', 'test', 'printf',
  'read', 'return', 'local', 'declare', 'function', 'time', 'trap', 'umask',
  'wait', 'exec', 'eval', 'bg', 'fg', 'jobs', 'kill', 'getopts', 'hash',
  'fc', 'bind', 'compgen', 'complete', 'shopt', 'suspend', 'logout', 'date',
]);

const EXECUTABLE_EXTENSIONS = process.platform === 'win32'
  ? ['.com', '.exe', '.bat', '.cmd', '.ps1']
  : ['', '.sh'];

let _cachedAvailable: { cwd: string; at: number; names: Set<string> } | null = null;
const AVAILABLE_CACHE_TTL_MS = 30_000;
const AVAILABLE_MAX_DIRS = 60;
const AVAILABLE_MAX_FILES = 8_000;

/**
 * Executable names currently reachable from this machine: PATH directories,
 * project-local bin dirs (node_modules/.bin, .venv, …) and shell builtins.
 * Cached for 30s per cwd so keystroke-level use stays cheap.
 */
export async function getAvailableCommandNames(cwd = process.cwd()): Promise<Set<string>> {
  const now = Date.now();
  if (_cachedAvailable && _cachedAvailable.cwd === cwd && now - _cachedAvailable.at < AVAILABLE_CACHE_TTL_MS) {
    return _cachedAvailable.names;
  }

  const names = new Set<string>(SHELL_BUILTINS);
  const seenDirs = new Set<string>();
  const dirs: string[] = [];

  const pathEnv = Object.entries(process.env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
  const rawDirs = [...getLocalFirstPathEntries(cwd), ...pathEnv.split(path.delimiter).filter(Boolean)];
  for (const dir of rawDirs) {
    const entry = dir.trim();
    if (!entry) continue;
    const resolved = entry.toLowerCase();
    if (seenDirs.has(resolved)) continue;
    seenDirs.add(resolved);
    dirs.push(entry);
    if (dirs.length >= AVAILABLE_MAX_DIRS) break;
  }

  let scanned = 0;
  for (const dir of dirs) {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await import('node:fs/promises').then((fsp) => fsp.readdir(dir, { withFileTypes: true }));
    } catch {
      continue;
    }
    for (const item of entries) {
      if (scanned >= AVAILABLE_MAX_FILES) break;
      if (!item.isFile() && !item.isSymbolicLink()) continue;
      const name = item.name;
      if (!name) continue;
      scanned += 1;
      const lower = name.toLowerCase();
      names.add(lower);
      const dot = lower.lastIndexOf('.');
      if (dot > 0 && EXECUTABLE_EXTENSIONS.includes(lower.slice(dot))) {
        names.add(lower.slice(0, dot));
      }
    }
    if (scanned >= AVAILABLE_MAX_FILES) break;
  }

  _cachedAvailable = { cwd, at: now, names };
  return names;
}

/* ── Cross-platform translation rules ──────────────────────────────────── */

interface RuleContext {
  target: PlatformTarget;
  piped: boolean;
}

interface TranslateRule {
  test: RegExp;
  build: (m: RegExpExecArray, ctx: RuleContext) => string | null;
  confidence: number;
  label: string;
}

const dequote = (s: string): string => s.trim().replace(/^["']|["']$/g, '');

function psFile(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function findstrFlagsFromGrep(flagGroups: string[]): string {
  const flags = new Set<string>();
  for (const group of flagGroups) {
    for (const ch of group) {
      if (ch === 'r' || ch === 'R') flags.add('/S');
      else if (ch === 'i') flags.add('/I');
      else if (ch === 'n') flags.add('/N');
      else if (ch === 'v') flags.add('/V');
      else if (ch === 'l') flags.add('/M');
    }
  }
  return [...flags].join(' ');
}

function grepFlagsFromFindstr(flags: string[]): string {
  const out = new Set<string>();
  for (const raw of flags) {
    const f = raw.toUpperCase();
    if (f === '/S' || f === '/S /B') out.add('-r');
    else if (f === '/I') out.add('-i');
    else if (f === '/N') out.add('-n');
    else if (f === '/V') out.add('-v');
    else if (f === '/M') out.add('-l');
  }
  return [...out].join(' ');
}

/** Unix/macOS commands → the correct native Windows command. */
const WIN_RULES: TranslateRule[] = [
  {
    label: 'export is a PowerShell environment variable on Windows',
    confidence: 0.8,
    test: /^\s*export\s+([A-Za-z_]\w*)=(.*)$/i,
    build: (m) => `$env:${m[1]} = "${dequote(m[2])}"`,
  },
  {
    label: 'VAR=value prefix becomes $env: assignment in PowerShell',
    confidence: 0.65,
    test: /^\s*([A-Za-z_]\w*)=(?:"([^"]*)"|'([^']*)'|(\S+))\s+(.+)$/,
    build: (m) => `$env:${m[1]} = "${dequote(m[2] || m[3] || m[4] || '')}"; ${m[5]}`,
  },
  {
    label: 'printenv → $env: (PowerShell)',
    confidence: 0.65,
    test: /^\s*printenv\s+([A-Za-z_]\w*)\s*$/i,
    build: (m) => `$env:${m[1]}`,
  },
  {
    label: 'env → list environment variables (PowerShell)',
    confidence: 0.65,
    test: /^\s*env\s*$/i,
    build: () => 'Get-ChildItem Env:',
  },
  {
    label: 'pwd → cd prints the current directory on Windows',
    confidence: 0.85,
    test: /^\s*pwd\s*$/i,
    build: () => 'cd',
  },
  {
    label: 'ls with flags → dir',
    confidence: 0.85,
    test: /^\s*ls\s+(-[a-zA-Z]+)\s+(.+)$/i,
    build: (m) => (/-a/i.test(m[1]) ? `dir /a ${m[2].trim()}` : `dir ${m[2].trim()}`),
  },
  {
    label: 'ls → dir',
    confidence: 0.85,
    test: /^\s*ls(?:\s+(-[a-zA-Z]+))?\s*$/i,
    build: (m) => (m[1] && /-a/i.test(m[1]) ? 'dir /a' : 'dir'),
  },
  {
    label: 'll/la are aliases for dir /a on Windows',
    confidence: 0.7,
    test: /^\s*(?:ll|la)\s*$/i,
    build: () => 'dir /a',
  },
  {
    label: 'cat → type',
    confidence: 0.85,
    test: /^\s*cat\s+(.+)$/i,
    build: (m) => `type ${m[1].trim()}`,
  },
  {
    label: 'head → Get-Content -TotalCount (PowerShell)',
    confidence: 0.7,
    test: /^\s*head\s+(?:-n\s*(\d+)\s+)?(.+)$/i,
    build: (m) => `powershell -NoProfile -Command "Get-Content -TotalCount ${m[1] || '10'} ${psFile(dequote(m[2]))}"`,
  },
  {
    label: 'tail -n → Get-Content -Tail (PowerShell)',
    confidence: 0.7,
    test: /^\s*tail\s+-n\s*(\d+)\s+(.+)$/i,
    build: (m) => `powershell -NoProfile -Command "Get-Content -Tail ${m[1]} ${psFile(dequote(m[2]))}"`,
  },
  {
    label: 'tail -f → Get-Content -Wait (PowerShell)',
    confidence: 0.65,
    test: /^\s*tail\s+-f\s+(.+)$/i,
    build: (m) => `powershell -NoProfile -Command "Get-Content -Wait ${psFile(dequote(m[1]))}"`,
  },
  {
    label: 'touch → create empty file(s) via cmd',
    confidence: 0.75,
    test: /^\s*touch\s+(.+)$/i,
    build: (m) => m[1].trim().split(/\s+/).map((f) => `if not exist ${dequote(f)} type NUL > ${dequote(f)}`).join(' && '),
  },
  {
    label: 'mkdir -p → mkdir (cmd creates intermediate directories)',
    confidence: 0.8,
    test: /^\s*mkdir\s+-p\s+(.+)$/i,
    build: (m) => `mkdir ${m[1].trim()}`,
  },
  {
    label: 'rm -r → rmdir /s /q',
    confidence: 0.7,
    test: /^\s*rm\s+-[a-zA-Z]*r[a-zA-Z]*\s+(.+)$/i,
    build: (m) => `rmdir /s /q ${dequote(m[1])}`,
  },
  {
    label: 'rm -f → del /f',
    confidence: 0.7,
    test: /^\s*rm\s+-f\s+(.+)$/i,
    build: (m) => `del /f ${m[1].trim()}`,
  },
  {
    label: 'rm → del',
    confidence: 0.75,
    test: /^\s*rm\s+(.+)$/i,
    build: (m) => `del ${m[1].trim()}`,
  },
  {
    label: 'cp -r → xcopy /e /i',
    confidence: 0.7,
    test: /^\s*cp\s+-[a-zA-Z]*r[a-zA-Z]*\s+(.+)$/i,
    build: (m) => {
      const parts = m[1].trim().split(/\s+/);
      if (parts.length !== 2) return null;
      return `xcopy /e /i ${dequote(parts[0])} ${dequote(parts[1])}`;
    },
  },
  {
    label: 'cp → copy',
    confidence: 0.8,
    test: /^\s*cp\s+(.+)$/i,
    build: (m) => `copy ${m[1].trim()}`,
  },
  {
    label: 'mv → move',
    confidence: 0.8,
    test: /^\s*mv\s+(.+)$/i,
    build: (m) => `move ${m[1].trim()}`,
  },
  {
    label: 'which/command -v → where',
    confidence: 0.85,
    test: /^\s*(?:which|command\s+-v)\s+(.+)$/i,
    build: (m) => `where ${m[1].trim()}`,
  },
  {
    label: 'clear → cls',
    confidence: 0.9,
    test: /^\s*clear\s*$/i,
    build: () => 'cls',
  },
  {
    label: 'grep → findstr',
    confidence: 0.75,
    test: /^\s*grep\s+(.+)$/i,
    build: (m, ctx) => {
      const words = m[1].trim().split(/\s+/);
      const flagGroups: string[] = [];
      let pattern: string | null = null;
      const rest: string[] = [];
      for (const word of words) {
        if (!pattern && /^-[a-zA-Z]+$/.test(word)) { flagGroups.push(word.slice(1)); continue; }
        if (!pattern) pattern = word;
        else rest.push(word);
      }
      if (!pattern) return null;
      const flags = findstrFlagsFromGrep(flagGroups);
      const path = rest.length ? ` ${rest.join(' ')}` : ctx.piped ? '' : ' *';
      return `findstr ${flags} ${/^["']/.test(pattern) ? pattern : `"${pattern}"`}${path}`.replace(/\s+/g, ' ').trim();
    },
  },
  {
    label: 'find . -name → Get-ChildItem -Recurse -Filter (PowerShell)',
    confidence: 0.55,
    test: /^\s*find\s+(?:\.|~)\s+(?:-iname|-name)\s+(.+)$/i,
    build: (m) => `powershell -NoProfile -Command "Get-ChildItem -Recurse -Filter ${dequote(m[1])} -Force"`,
  },
  {
    label: 'ps aux → tasklist',
    confidence: 0.85,
    test: /^\s*ps\s+(?:aux|-ef|-e|-A)\s*$/i,
    build: () => 'tasklist',
  },
  {
    label: 'ps → tasklist',
    confidence: 0.85,
    test: /^\s*ps\s*$/i,
    build: () => 'tasklist',
  },
  {
    label: 'top/htop → top CPU processes (PowerShell)',
    confidence: 0.55,
    test: /^\s*(?:top|htop)\s*$/i,
    build: () => 'powershell -NoProfile -Command "Get-Process | Sort-Object CPU -Descending | Select-Object -First 20"',
  },
  {
    label: 'neofetch → Windows system card',
    confidence: 0.8,
    test: /^\s*(?:neofetch|fastfetch|screenfetch|pfetch)\s*$/i,
    build: () =>
      "$os = Get-CimInstance Win32_OperatingSystem; $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1; $cs = Get-CimInstance Win32_ComputerSystem; Write-Output ($env:USERNAME + '@' + $env:COMPUTERNAME); Write-Output ('OS: ' + $os.Caption + ' ' + $os.Version); Write-Output ('Host: ' + $cs.Manufacturer + ' ' + $cs.Model); Write-Output ('CPU: ' + $cpu.Name); Write-Output ('Memory: ' + [math]::Round($os.TotalVisibleMemorySize/1MB,1) + ' GB')",
  },
  {
    label: 'kill → taskkill /pid',
    confidence: 0.65,
    test: /^\s*kill\s+(?:-9\s+|-TERM\s+)?(\d+)\s*$/i,
    build: (m) => `taskkill /PID ${m[1]}`,
  },
  {
    label: 'pkill → taskkill /im',
    confidence: 0.55,
    test: /^\s*pkill\s+(?:-f\s+)?(.+)$/i,
    build: (m) => `taskkill /F /IM ${/\./.test(m[1]) ? dequote(m[1]) : `${dequote(m[1])}.exe`}`,
  },
  {
    label: 'ifconfig → ipconfig',
    confidence: 0.85,
    test: /^\s*ifconfig\s*$/i,
    build: () => 'ipconfig',
  },
  {
    label: 'ip addr → ipconfig',
    confidence: 0.85,
    test: /^\s*ip\s+(?:addr|a)\s*$/i,
    build: () => 'ipconfig',
  },
  {
    label: 'ip → ipconfig',
    confidence: 0.9,
    test: /^\s*ip\s*$/i,
    build: () => 'ipconfig',
  },
  {
    label: 'ip link → ipconfig',
    confidence: 0.85,
    test: /^\s*ip\s+link\s*$/i,
    build: () => 'ipconfig',
  },
  {
    label: 'ip route → route print',
    confidence: 0.85,
    test: /^\s*ip\s+(?:route|r)\s*$/i,
    build: () => 'route print',
  },
  {
    label: 'traceroute → tracert',
    confidence: 0.85,
    test: /^\s*(?:traceroute|tracepath)\s+(.+)$/i,
    build: (m) => `tracert ${m[1].trim()}`,
  },
  {
    label: 'ss → netstat -ano',
    confidence: 0.7,
    test: /^\s*ss\s+(-[a-zA-Z]+)?\s*$/i,
    build: () => 'netstat -ano',
  },
  {
    label: 'netstat -tulpen → netstat -ano',
    confidence: 0.8,
    test: /^\s*netstat\s+-tulpen\s*$/i,
    build: () => 'netstat -ano',
  },
  {
    label: 'dig → nslookup',
    confidence: 0.7,
    test: /^\s*dig\s+(?:\+\S+\s+)*(\S+)\s*$/i,
    build: (m) => `nslookup ${m[1]}`,
  },
  {
    label: 'nc host port → Test-NetConnection (PowerShell)',
    confidence: 0.6,
    test: /^\s*nc\s+(?:-vz\s+)?(\S+)\s+(\d+)\s*$/i,
    build: (m) => `powershell -NoProfile -Command "Test-NetConnection ${m[1]} -Port ${m[2]}"`,
  },
  {
    label: 'ping -c → ping -n',
    confidence: 0.85,
    test: /^\s*ping\s+-c\s*(\d+)\s+(.+)$/i,
    build: (m) => `ping -n ${m[1]} ${m[2].trim()}`,
  },
  {
    label: 'wget url → curl -O url',
    confidence: 0.7,
    test: /^\s*wget\s+(?:-\S+\s+)*(.+)$/i,
    build: (m) => `curl -O ${m[1].trim()}`,
  },
  {
    label: 'man x → x --help',
    confidence: 0.55,
    test: /^\s*man\s+(\S+)\s*$/i,
    build: (m) => `${m[1]} --help`,
  },
  {
    label: 'apt/dnf/yum/pacman/apk install → winget install',
    confidence: 0.55,
    test: /^\s*(?:apt(?:-get)?|dnf|yum|zypper|pacman|apk)\s+(?:install|-S)\s+(.+)$/i,
    build: (m) => `winget install ${m[1].trim()}`,
  },
  {
    label: 'apt search → winget search',
    confidence: 0.55,
    test: /^\s*(?:apt(?:-get)?|dnf|yum)\s+search\s+(.+)$/i,
    build: (m) => `winget search ${m[1].trim()}`,
  },
  {
    label: 'apt remove → winget uninstall',
    confidence: 0.5,
    test: /^\s*(?:apt(?:-get)?|dnf|yum)\s+(?:remove|erase)\s+(.+)$/i,
    build: (m) => `winget uninstall ${m[1].trim()}`,
  },
  {
    label: 'apt list --installed → winget list',
    confidence: 0.5,
    test: /^\s*apt(?:-get)?\s+list\s+--installed\s*$/i,
    build: () => 'winget list',
  },
  {
    label: 'brew install → winget install',
    confidence: 0.6,
    test: /^\s*brew\s+install\s+(.+)$/i,
    build: (m) => `winget install ${m[1].trim()}`,
  },
  {
    label: 'brew search → winget search',
    confidence: 0.55,
    test: /^\s*brew\s+search\s+(.+)$/i,
    build: (m) => `winget search ${m[1].trim()}`,
  },
  {
    label: 'brew list → winget list',
    confidence: 0.5,
    test: /^\s*brew\s+list\s*$/i,
    build: () => 'winget list',
  },
  {
    label: 'systemctl status → Get-Service (PowerShell)',
    confidence: 0.65,
    test: /^\s*systemctl\s+status\s+(.+)$/i,
    build: (m) => `powershell -NoProfile -Command "Get-Service ${psFile(dequote(m[1]))}"`,
  },
  {
    label: 'systemctl start/stop/restart → PowerShell service cmdlets',
    confidence: 0.55,
    test: /^\s*systemctl\s+(start|stop|restart)\s+(.+)$/i,
    build: (m) => `powershell -NoProfile -Command "${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()}-Service ${psFile(dequote(m[2]))}"`,
  },
  {
    label: 'service x status → Get-Service (PowerShell)',
    confidence: 0.6,
    test: /^\s*service\s+(\S+)\s+status\s*$/i,
    build: (m) => `powershell -NoProfile -Command "Get-Service ${psFile(m[1])}"`,
  },
  {
    label: 'open/xdg-open → start',
    confidence: 0.7,
    test: /^\s*(?:open|xdg-open)\s+(.+)$/i,
    build: (m) => `start "" ${m[1].trim()}`,
  },
  {
    label: 'less → more',
    confidence: 0.65,
    test: /^\s*less\s+(.+)$/i,
    build: (m) => `more ${m[1].trim()}`,
  },
  {
    label: 'nano/vim/vi → notepad',
    confidence: 0.55,
    test: /^\s*(?:nano|vim|vi)\s+(.+)$/i,
    build: (m) => `notepad ${m[1].trim()}`,
  },
  {
    label: 'df -h → Get-PSDrive (PowerShell)',
    confidence: 0.6,
    test: /^\s*df\s+(-h)?\s*$/i,
    build: () => 'powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem"',
  },
  {
    label: 'free -h → memory info (PowerShell)',
    confidence: 0.5,
    test: /^\s*free\s+(-h)?\s*$/i,
    build: () => 'powershell -NoProfile -Command "Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory"',
  },
  {
    label: 'uname → ver',
    confidence: 0.7,
    test: /^\s*uname(?:\s+-[a-zA-Z]+)?\s*$/i,
    build: () => 'ver',
  },
  {
    label: 'date → Get-Date (PowerShell)',
    confidence: 0.6,
    test: /^\s*date\s*$/i,
    build: () => 'Get-Date',
  },
  {
    label: 'sleep → Start-Sleep (PowerShell)',
    confidence: 0.55,
    test: /^\s*sleep\s+(\d+)\s*$/i,
    build: (m) => `powershell -NoProfile -Command "Start-Sleep -Seconds ${m[1]}"`,
  },
  {
    label: 'history → doskey /history',
    confidence: 0.55,
    test: /^\s*history\s*$/i,
    build: () => 'doskey /history',
  },
  {
    label: 'sudo is not used on Windows; running without elevation',
    confidence: 0.72,
    test: /^\s*sudo\s+(.+)$/i,
    build: (m) => m[1].trim(),
  },
];

/** Windows commands → the correct native Linux/macOS command. */
const POSIX_RULES: TranslateRule[] = [
  {
    label: 'set → export',
    confidence: 0.8,
    test: /^\s*set\s+([A-Za-z_]\w*)=(.*)$/i,
    build: (m) => `export ${m[1]}="${dequote(m[2])}"`,
  },
  {
    label: 'cls → clear',
    confidence: 0.9,
    test: /^\s*cls\s*$/i,
    build: () => 'clear',
  },
  {
    label: 'ver → uname -a',
    confidence: 0.85,
    test: /^\s*ver\s*$/i,
    build: () => 'uname -a',
  },
  {
    label: 'systeminfo → uname -a',
    confidence: 0.7,
    test: /^\s*systeminfo\s*$/i,
    build: () => 'uname -a',
  },
  {
    label: 'dir → ls -la',
    confidence: 0.8,
    test: /^\s*dir(?:\s+\/a(?:\/[a-z]*)*)?\s*$/i,
    build: () => 'ls -la',
  },
  {
    label: 'dir path → ls -la path',
    confidence: 0.8,
    test: /^\s*dir\s+([^/\s].*)$/i,
    build: (m) => `ls -la ${m[1].trim()}`,
  },
  {
    label: 'type → cat',
    confidence: 0.85,
    test: /^\s*type\s+(.+)$/i,
    build: (m) => `cat ${m[1].trim()}`,
  },
  {
    label: 'where → command -v',
    confidence: 0.85,
    test: /^\s*where\s+(.+)$/i,
    build: (m) => `command -v ${m[1].trim()}`,
  },
  {
    label: 'copy → cp',
    confidence: 0.85,
    test: /^\s*copy\s+(.+)$/i,
    build: (m) => `cp ${m[1].trim()}`,
  },
  {
    label: 'xcopy → cp -r',
    confidence: 0.65,
    test: /^\s*xcopy\s+(?:\/[a-z]+\s+)*(.+)$/i,
    build: (m) => `cp -r ${m[1].trim()}`,
  },
  {
    label: 'robocopy → rsync -a',
    confidence: 0.5,
    test: /^\s*robocopy\s+(\S+)\s+(\S+)\s*$/i,
    build: (m) => `rsync -a ${m[1]} ${m[2]}`,
  },
  {
    label: 'move → mv',
    confidence: 0.85,
    test: /^\s*move\s+(.+)$/i,
    build: (m) => `mv ${m[1].trim()}`,
  },
  {
    label: 'rd /s /q → rm -rf',
    confidence: 0.7,
    test: /^\s*rd\s+\/s\s+\/q\s+(.+)$/i,
    build: (m) => `rm -rf ${dequote(m[1])}`,
  },
  {
    label: 'del /f → rm -f',
    confidence: 0.7,
    test: /^\s*(?:del|erase)\s+\/f\s+(.+)$/i,
    build: (m) => `rm -f ${m[1].trim()}`,
  },
  {
    label: 'del → rm',
    confidence: 0.8,
    test: /^\s*(?:del|erase)\s+(.+)$/i,
    build: (m) => `rm ${m[1].trim()}`,
  },
  {
    label: 'rmdir → rmdir',
    confidence: 0.8,
    test: /^\s*rmdir\s+(.+)$/i,
    build: (m) => `rmdir ${m[1].trim()}`,
  },
  {
    label: 'md → mkdir',
    confidence: 0.8,
    test: /^\s*md\s+(.+)$/i,
    build: (m) => `mkdir ${m[1].trim()}`,
  },
  {
    label: 'ipconfig → ip addr / ifconfig',
    confidence: 0.85,
    test: /^\s*ipconfig\s*(\/all)?\s*$/i,
    build: (_m, ctx) => (ctx.target === 'macos' ? 'ifconfig -a' : 'ip addr'),
  },
  {
    label: 'ipconfig /flushdns → DNS cache flush',
    confidence: 0.5,
    test: /^\s*ipconfig\s+\/flushdns\s*$/i,
    build: (_m, ctx) => (ctx.target === 'macos'
      ? 'sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder'
      : 'sudo systemd-resolve --flush-caches'),
  },
  {
    label: 'route print → ip route / netstat -rn',
    confidence: 0.8,
    test: /^\s*route\s+print\s*$/i,
    build: (_m, ctx) => (ctx.target === 'macos' ? 'netstat -rn' : 'ip route'),
  },
  {
    label: 'tracert/pathping → traceroute',
    confidence: 0.85,
    test: /^\s*(?:tracert|pathping)\s+(.+)$/i,
    build: (m) => `traceroute ${m[1].trim()}`,
  },
  {
    label: 'netstat -ano → ss -tulpen / netstat -anv',
    confidence: 0.8,
    test: /^\s*netstat\s+-an[oa]?\s*$/i,
    build: (_m, ctx) => (ctx.target === 'macos' ? 'netstat -anv' : 'ss -tulpen'),
  },
  {
    label: 'tasklist → ps aux',
    confidence: 0.85,
    test: /^\s*tasklist\s*$/i,
    build: () => 'ps aux',
  },
  {
    label: 'taskkill /pid → kill',
    confidence: 0.75,
    test: /^\s*taskkill\s+\/f?\s*\/pid\s+(\d+)\s*(\/f)?\s*$/i,
    build: (m) => (m[2] ? `kill -9 ${m[1]}` : `kill ${m[1]}`),
  },
  {
    label: 'taskkill /im → pkill -f',
    confidence: 0.6,
    test: /^\s*taskkill\s+\/f?\s*\/im\s+(\S+)\s*(\/f)?\s*$/i,
    build: (m) => `pkill -f ${m[1].replace(/\.(exe|com)$/i, '')}`,
  },
  {
    label: 'echo %VAR% → echo $VAR',
    confidence: 0.7,
    test: /^\s*echo\s+%([A-Za-z_]\w*)%\s*$/i,
    build: (m) => `echo $${m[1]}`,
  },
  {
    label: 'start → xdg-open / open',
    confidence: 0.75,
    test: /^\s*start\s+(?:""|'')?\s*(.+)$/i,
    build: (m, ctx) => `${ctx.target === 'macos' ? 'open' : 'xdg-open'} ${dequote(m[1])}`,
  },
  {
    label: 'findstr → grep',
    confidence: 0.7,
    test: /^\s*findstr\s+(.+)$/i,
    build: (m, ctx) => {
      const words = m[1].trim().split(/\s+/);
      const flags: string[] = [];
      let pattern: string | null = null;
      const rest: string[] = [];
      for (const word of words) {
        if (!pattern && /^\/[a-zA-Z]+$/i.test(word)) { flags.push(word); continue; }
        if (!pattern) pattern = word;
        else rest.push(word);
      }
      if (!pattern) return null;
      const grepFlags = grepFlagsFromFindstr(flags);
      const path = rest.length ? ` ${rest.join(' ')}` : ctx.piped ? '' : ' .';
      return `grep ${grepFlags} ${dequote(pattern).replace(/^\/C:/i, '')}${path}`.replace(/\s+/g, ' ').trim();
    },
  },
  {
    label: 'winget install → apt/brew install',
    confidence: 0.55,
    test: /^\s*winget\s+install\s+(.+)$/i,
    build: (m, ctx) => (ctx.target === 'macos' ? `brew install ${m[1].trim()}` : `sudo apt-get install -y ${m[1].trim()}`),
  },
  {
    label: 'winget search → brew/apt search',
    confidence: 0.5,
    test: /^\s*winget\s+search\s+(.+)$/i,
    build: (m, ctx) => (ctx.target === 'macos' ? `brew search ${m[1].trim()}` : `apt search ${m[1].trim()}`),
  },
  {
    label: 'winget uninstall → apt/brew uninstall',
    confidence: 0.5,
    test: /^\s*winget\s+(?:uninstall|remove)\s+(.+)$/i,
    build: (m, ctx) => (ctx.target === 'macos' ? `brew uninstall ${m[1].trim()}` : `sudo apt-get remove -y ${m[1].trim()}`),
  },
  {
    label: 'winget list → apt/brew list',
    confidence: 0.5,
    test: /^\s*winget\s+list\s*$/i,
    build: (_m, ctx) => (ctx.target === 'macos' ? 'brew list' : 'apt list --installed'),
  },
  {
    label: 'taskmgr → top/htop',
    confidence: 0.5,
    test: /^\s*taskmgr\s*$/i,
    build: () => 'top',
  },
  {
    label: 'notepad → nano / open -t',
    confidence: 0.5,
    test: /^\s*notepad\s+(.+)$/i,
    build: (m, ctx) => (ctx.target === 'macos' ? `open -t ${m[1].trim()}` : `nano ${m[1].trim()}`),
  },
  {
    label: 'sc query → systemctl status',
    confidence: 0.5,
    test: /^\s*sc\s+query\s+(.+)$/i,
    build: (m) => `systemctl status ${m[1].trim()}`,
  },
  {
    label: 'net start/stop → systemctl',
    confidence: 0.5,
    test: /^\s*net\s+(start|stop)\s+(.+)$/i,
    build: (m) => `sudo systemctl ${m[1].toLowerCase()} ${m[2].trim()}`,
  },
];

function ruleSetFor(target: PlatformTarget): TranslateRule[] {
  return target === 'windows' ? WIN_RULES : POSIX_RULES;
}

interface TranslateCore {
  corrected: string;
  confidence: number;
  reason: string;
}

function applyRules(rules: TranslateRule[], line: string, ctx: RuleContext): TranslateCore | null {
  for (const rule of rules) {
    const m = rule.test.exec(line);
    if (!m) continue;
    let built: string | null = null;
    try {
      built = rule.build(m, ctx);
    } catch {
      built = null;
    }
    if (!built) return null; // matched but not translatable — do not fall through
    const trimmed = built.trim();
    if (!trimmed) return null;
    if (trimmed.toLowerCase() === line.toLowerCase()) return null;
    return { corrected: trimmed, confidence: rule.confidence, reason: rule.label };
  }
  return null;
}

/** Translate one pipe-free line; returns null when nothing should change. */
function translateLine(line: string, target: PlatformTarget, piped: boolean): TranslateCore | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  // Path-like invocations (./build.sh, C:\tools\x.exe, /usr/bin/x) are never translated.
  if (/^(\.\/|\.\\|~\/|[A-Za-z]:[\\/]|\/)/.test(trimmed)) return null;
  const hadSudo = /^\s*sudo\s+/i.test(trimmed);
  const core = trimmed.replace(/^\s*sudo\s+/i, '').trim();
  const rules = ruleSetFor(target);
  const result = applyRules(rules, core, { target, piped });
  if (!result) {
    // `sudo x` on Windows: the closest sane behavior is running x without elevation.
    if (hadSudo && target === 'windows' && !piped && core && core.toLowerCase() !== trimmed.toLowerCase()) {
      const sudoRule = WIN_RULES[WIN_RULES.length - 1];
      return { corrected: core, confidence: sudoRule.confidence, reason: sudoRule.label };
    }
    return null;
  }
  if (hadSudo) result.confidence = Math.max(0.4, result.confidence - 0.05);
  return result;
}

/**
 * Translate a (possibly piped) command line so it runs natively on `target`.
 * Returns null when the command is already native / not safely translatable.
 */
export function translateCommand(command: string, target: PlatformTarget): TranslateResult | null {
  const trimmed = command.trim();
  if (!trimmed) return null;
  // Compound statements and redirections are too risky to auto-translate.
  if (/&&|[;&<>]/.test(trimmed)) return null;

  if (trimmed.includes('|')) {
    const segments = trimmed.split('|').map((s) => s.trim());
    if (segments.some((s) => !s)) return null;
    const cores: (TranslateCore | null)[] = [];
    let changed = 0;
    for (const segment of segments) {
      const core = translateLine(segment, target, true);
      if (core) changed += 1;
      cores.push(core);
    }
    if (changed === 0) return null;
    const corrected = segments.map((s, i) => cores[i]?.corrected ?? s).join(' | ');
    const confidences = cores.filter((c): c is TranslateCore => Boolean(c)).map((c) => c.confidence);
    return {
      corrected,
      confidence: confidences.length ? Math.min(...confidences) : 0.5,
      reason: [...new Set(cores.filter((c): c is TranslateCore => Boolean(c)).map((c) => c.reason))].join('; '),
      target,
    };
  }

  const core = translateLine(trimmed, target, false);
  return core ? { ...core, target } : null;
}

/* ── First-word typo correction ────────────────────────────────────────── */

const COMMON_TYPOS: Record<string, string> = {
  gti: 'git',
  nmp: 'npm',
  npn: 'npm',
  ndm: 'npm',
  yarr: 'yarn',
  pyhton: 'python',
  pthon: 'python',
  docer: 'docker',
  dcker: 'docker',
  dockr: 'docker',
  docor: 'docker',
  kuberctl: 'kubectl',
  kubecti: 'kubectl',
  terrafrom: 'terraform',
  teraform: 'terraform',
  crul: 'curl',
  wegt: 'wget',
  gerp: 'grep',
  chomd: 'chmod',
  chwon: 'chown',
  mkae: 'make',
  fluter: 'flutter',
  eslit: 'eslint',
  donet: 'dotnet',
  dotent: 'dotnet',
  journlctl: 'journalctl',
  systemclt: 'systemctl',
  wingt: 'winget',
  composr: 'composer',
  artisian: 'artisan',
  gardle: 'gradle',
};

/** Damerau-Levenshtein distance with an early cutoff. */
export function damerauLevenshtein(a: string, b: string, cap = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const la = a.length;
  const lb = b.length;
  const d: number[][] = Array.from({ length: la + 1 }, () => new Array<number>(lb + 1).fill(0));
  for (let i = 0; i <= la; i++) d[i][0] = i;
  for (let j = 0; j <= lb; j++) d[0][j] = j;
  for (let i = 1; i <= la; i++) {
    let rowMin = d[i][0];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
      if (d[i][j] < rowMin) rowMin = d[i][j];
    }
    if (rowMin > cap) return cap + 1;
  }
  return d[la][lb] <= cap ? d[la][lb] : cap + 1;
}

/** Cmd builtins and other words that must never be offered as a typo fix. */
const SHELL_KEYWORDS = new Set([
  'if', 'for', 'help', 'set', 'call', 'rem', 'goto', 'shift', 'echo', 'pause',
  'cls', 'md', 'rd', 'ren', 'start', 'exit', 'vol', 'ver', 'assoc', 'ftype',
  'pushd', 'popd', 'path', 'prompt', 'title', 'color', 'date', 'time',
]);

/**
 * Real tools. If the typed name is one of these and it is not installed,
 * do not substitute a nearby executable. Known typos still go through COMMON_TYPOS.
 */
const KNOWN_TOOLS = new Set([
  'helm', 'kubectl', 'kubeadm', 'docker', 'podman', 'terraform', 'ansible',
  'minikube', 'k9s', 'skaffold', 'istioctl', 'argocd', 'nomad', 'consul',
  'vault', 'packer', 'pulumi', 'aws', 'gcloud', 'az', 'gradle', 'mvn',
  'cargo', 'rustc', 'git', 'gh', 'curl', 'wget', 'ssh', 'ip', 'ifconfig',
  'ss', 'netstat', 'ps', 'top', 'htop', 'journalctl', 'systemctl',
]);

const EXECUTABLE_NAME_RE = /^[A-Za-z0-9_][\w.\-+]*$/;
const NON_EXECUTABLE_EXT_RE = /\.(md|txt|json|log|ya?ml|toml|ini|cfg|pdf|png|jpe?g|gif|svg|html?|css|map|ts|tsx|js|mjs|cjs|lock|node|wasm|hpp|h|c|cpp|py|pyc|rs|go|java|dll|pdb|lib)$/i;

function isExecutableLookingName(name: string): boolean {
  if (!name || name.length < 2 || !EXECUTABLE_NAME_RE.test(name)) return false;
  if (NON_EXECUTABLE_EXT_RE.test(name)) return false;
  return true;
}

function splitProgramName(line: string): { name: string; rest: string } | null {
  const m = /^(\S+)(\s[\s\S]*)?$/.exec(line.trim());
  if (!m) return null;
  return { name: m[1], rest: m[2] || '' };
}

/**
 * Fix a typo in the first word (the program name) when that word is not
 * available on this machine but a near-identical executable is.
 */
export async function fixProgramNameTypo(
  original: string,
  cwd: string
): Promise<CommandCorrection | null> {
  const parts = splitProgramName(original);
  if (!parts) return null;
  const raw = parts.name;
  // Skip path-like invocations and quoted words.
  if (/^[./\\~"']|^[A-Za-z]:[\\/]/.test(raw)) return null;
  const stem = raw.toLowerCase().replace(/\.(exe|cmd|bat|com|ps1)$/i, '');
  if (!stem || stem.length < 2) return null;

  const available = await getAvailableCommandNames(cwd);
  if (available.has(stem)) return null;

  const candidates: string[] = [];
  const mapped = COMMON_TYPOS[stem];
  if (mapped) {
    candidates.push(mapped);
  } else if (stem.length < 5 || KNOWN_TOOLS.has(stem)) {
    return null;
  } else {
    let best: { name: string; dist: number } | null = null;
    for (const name of available) {
      if (!isExecutableLookingName(name)) continue;
      const lower = name.toLowerCase().replace(/\.(exe|cmd|bat|com|ps1)$/i, '');
      if (!lower || lower === stem || SHELL_KEYWORDS.has(lower) || Math.abs(lower.length - stem.length) > 2) continue;
      const dist = damerauLevenshtein(stem, lower, 2);
      if (dist <= 2 && (!best || dist < best.dist)) best = { name: lower, dist };
      if (best && best.dist === 1) break;
    }
    if (best) candidates.push(best.name);
  }

  for (const candidate of candidates) {
    if (!candidate || candidate === stem || SHELL_KEYWORDS.has(candidate) || !available.has(candidate)) continue;
    const dist = damerauLevenshtein(stem, candidate, 2);
    if (dist > 2) continue;
    const confidence = dist === 1 ? 0.9 : stem.length >= 5 ? 0.78 : 0.7;
    const corrected = `${candidate}${parts.rest}`;
    return {
      original,
      corrected,
      kind: 'typo',
      confidence,
      reason: `'${raw}' is not available here; nearest executable is '${candidate}' (edit distance ${dist})`,
      dangerous: isDangerousShellCommand(corrected),
    };
  }
  return null;
}

/* ── Pipeline ──────────────────────────────────────────────────────────── */

function programStem(line: string): string {
  return (line.trim().split(/\s+/)[0] || '')
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|com|ps1)$/i, '');
}

/** True when a typo or fuzzy guess would replace a real tool or a short name with a shell keyword. */
function isRejectedTypo(original: string, corrected: string): boolean {
  const from = programStem(original);
  const to = programStem(corrected);
  if (!from || !to || from === to) return false;
  if (SHELL_KEYWORDS.has(to)) return true;
  if (COMMON_TYPOS[from]) return false;
  if (from.length < 5 || KNOWN_TOOLS.has(from)) return true;
  return false;
}

function addCorrection(map: Map<string, CommandCorrection>, correction: CommandCorrection): void {
  const key = correction.corrected.trim().toLowerCase();
  const existing = map.get(key);
  if (!existing || correction.confidence > existing.confidence) map.set(key, correction);
}

/**
 * Full correction pipeline. With `output` (a real failure) the result is used
 * to auto-execute or prompt; without it (`/fix`, `/translate`) it is a dry run.
 */
export async function getCommandCorrections(
  command: string,
  options: CorrectionOptions = {}
): Promise<CommandCorrection[]> {
  const original = command.trim();
  if (!original || original.startsWith('/')) return [];
  if (/&&|[;&<>]/.test(original)) return []; // compound lines: let the agent handle those
  const cwd = options.cwd || process.cwd();
  const target = currentTarget();
  const results = new Map<string, CommandCorrection>();

  // 1. Cross-platform translation to this machine's native command.
  const translated = translateCommand(original, target);
  if (translated && translated.corrected.toLowerCase() !== original.toLowerCase()) {
    addCorrection(results, {
      original,
      corrected: translated.corrected,
      kind: 'cross-platform',
      confidence: translated.confidence,
      reason: translated.reason,
      dangerous: isDangerousShellCommand(translated.corrected),
      target,
    });
  }

  // 2. First-word typo correction. Known tools and short names are not fuzzy-matched.
  const typo = await fixProgramNameTypo(original, cwd).catch(() => null);
  if (typo && !isRejectedTypo(original, typo.corrected)) addCorrection(results, typo);

  // 3. Fuzzy database fallback when we know a failure actually happened.
  if (options.output) {
    const fuzzy = await suggestCommandFix(original, cwd).catch(() => null);
    if (fuzzy && fuzzy.command.toLowerCase() !== original.toLowerCase() && !isRejectedTypo(original, fuzzy.command)) {
      addCorrection(results, {
        original,
        corrected: fuzzy.command,
        kind: 'fuzzy',
        confidence: fuzzy.confidence,
        reason: fuzzy.reason || 'matches local command intelligence',
        dangerous: isDangerousShellCommand(fuzzy.command),
      });
    }
  }

  // 4. Verify the corrected program actually exists here; dampen otherwise.
  const available = await getAvailableCommandNames(cwd);
  const verified: CommandCorrection[] = [];
  for (const correction of results.values()) {
    const head = splitProgramName(correction.corrected)?.name.toLowerCase() || '';
    const base = head.split(/[\\/]/).pop() || head;
    const bare = base.replace(/\.(exe|cmd|bat|com|ps1)$/i, '');
    const exists = Boolean(
      base && (available.has(base) || available.has(bare)
        || available.has(`${bare}.exe`) || available.has(`${bare}.cmd`) || available.has(`${bare}.bat`))
    );
    verified.push(exists ? correction : { ...correction, confidence: Math.round(correction.confidence * 70) / 100 });
  }

  return verified.sort((a, b) => b.confidence - a.confidence || a.corrected.localeCompare(b.corrected));
}

/** True when a correction is confident and safe enough to run unattended. */
export function isAutoExecutable(correction: CommandCorrection, output: string): boolean {
  return autoFixEnabled()
    && isCommandNotFoundFailure(output)
    && correction.confidence >= AUTO_FIX_MIN_CONFIDENCE
    && !correction.dangerous;
}
