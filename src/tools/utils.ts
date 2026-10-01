import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  formatLocalToolsForPrompt,
  preferredAnalysisRunner,
  preferredJsonTool,
  preferredYamlTool,
  preferredSearchTool,
} from '../tool-detect.js';
import { killProcessTreeBestEffort } from '../process-tree-kill.js';
import {
  registerShellChildForInterrupt,
  unregisterShellChildIfMatches,
} from '../shell-abort-context.js';

export const PROJECT_ROOT = path.resolve(process.cwd());
let workspaceCwd = PROJECT_ROOT;
let previousWorkspaceCwd = PROJECT_ROOT;

export function getWorkspaceCwd(): string {
  return workspaceCwd;
}

export function getWorkspaceRelativeCwd(): string {
  const rel = path.relative(PROJECT_ROOT, workspaceCwd);
  return rel || '.';
}

export function resolveProjectPath(inputPath = '.', base = PROJECT_ROOT): string {
  return path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(base, inputPath);
}

export function isWithinProjectPath(resolvedPath: string): boolean {
  const relative = path.relative(PROJECT_ROOT, resolvedPath);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

export function ensureInsideProject(inputPath = '.', base = PROJECT_ROOT): { ok: true; path: string } | { ok: false; error: string } {
  const resolved = resolveProjectPath(inputPath, base);
  if (!isWithinProjectPath(resolved)) {
    return { ok: false, error: 'Error: Path outside project directory.' };
  }
  return { ok: true, path: resolved };
}

export function changeWorkspaceDirectory(inputPath = '.'): string {
  const requested = inputPath.trim();
  const targetPath = !requested || requested === '~'
    ? PROJECT_ROOT
    : requested === '-'
      ? previousWorkspaceCwd
      : requested;
  const target = ensureInsideProject(targetPath, workspaceCwd);
  if (!target.ok) return target.error;
  try {
    if (!fs.existsSync(target.path)) return `Error: Directory not found: ${targetPath}`;
    if (!fs.statSync(target.path).isDirectory()) return `Error: Not a directory: ${targetPath}`;
    previousWorkspaceCwd = workspaceCwd;
    workspaceCwd = target.path;
    return getWorkspaceRelativeCwd();
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function truncateOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `[Truncated]\n${text.slice(0, maxChars)}\n...${text.length - maxChars} more chars`;
}

export interface ShellSpec {
  command: string;
  args: string[];
  label: string;
}

export interface SmartShellCommand {
  shell: ShellSpec;
  command: string;
  reason: string;
}

export function getDefaultShell(): ShellSpec {
  if (process.platform === 'win32') {
    const shell = process.env.ComSpec || 'cmd.exe';
    return { command: shell, args: ['/d', '/s', '/c'], label: 'cmd' };
  }

  const shell = process.env.SHELL || (os.platform() === 'darwin' ? '/bin/zsh' : '/bin/sh');
  return { command: shell, args: ['-lc'], label: path.basename(shell) };
}

export function getShell(shellName?: string): ShellSpec {
  const normalized = shellName?.trim().toLowerCase();
  if (!normalized || normalized === 'auto' || normalized === 'default') {
    return getDefaultShell();
  }

  switch (normalized) {
    case 'cmd':
    case 'cmd.exe':
      return { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c'], label: 'cmd' };
    case 'powershell':
    case 'powershell.exe':
      return {
        command: 'powershell.exe',
        args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command'],
        label: 'powershell',
      };
    case 'pwsh':
      return { command: 'pwsh', args: ['-NoLogo', '-NoProfile', '-Command'], label: 'pwsh' };
    case 'bash':
      return { command: 'bash', args: ['-lc'], label: 'bash' };
    case 'sh':
      return { command: 'sh', args: ['-lc'], label: 'sh' };
    case 'zsh':
      return { command: 'zsh', args: ['-lc'], label: 'zsh' };
    case 'fish':
      return { command: 'fish', args: ['-lc'], label: 'fish' };
    default:
      return getDefaultShell();
  }
}

export function getSmartShell(command: string, shellName?: string): SmartShellCommand {
  const requested = shellName?.trim().toLowerCase();
  if (requested && requested !== 'auto' && requested !== 'default') {
    const shell = getShell(requested);
    return {
      shell,
      command: normalizeCommandForShell(command, shell.label),
      reason: `explicit shell: ${shell.label}`,
    };
  }

  if (looksLikePowerShell(command) && shellAvailable('pwsh')) {
    const shell = getShell('pwsh');
    return { shell, command: normalizeCommandForShell(command, shell.label), reason: 'PowerShell syntax detected and pwsh is available' };
  }

  if (process.platform !== 'win32') {
    const shell = getDefaultShell();
    return {
      shell,
      command: normalizeCommandForShell(command, shell.label),
      reason: looksLikeWindowsShell(command)
        ? `Windows-style command translated for ${shell.label}`
        : `default shell: ${shell.label}`,
    };
  }

  if (looksLikePowerShell(command)) {
    const shell = shellAvailable('pwsh') ? getShell('pwsh') : getShell('powershell');
    return { shell, command: normalizeCommandForShell(command, shell.label), reason: 'PowerShell syntax detected' };
  }

  if (isSimpleUnixInspectionForCmd(command)) {
    const shell = getShell('cmd');
    return {
      shell,
      command: normalizeCommandForShell(command, shell.label),
      reason: 'Simple Unix-style inspection translated for cmd',
    };
  }

  if (looksLikeUnixShell(command) && shellAvailable('bash')) {
    const shell = getShell('bash');
    return { shell, command, reason: 'Unix shell syntax detected and bash is available' };
  }

  const shell = getShell('cmd');
  return {
    shell,
    command: normalizeCommandForShell(command, shell.label),
    reason: looksLikeUnixShell(command)
      ? 'Unix-like command translated for cmd because bash was not detected'
      : 'Windows cmd default',
  };
}

export function getShellDiagnostics(): string {
  const localPaths = getLocalFirstPathEntries(PROJECT_ROOT);
  const analysis = preferredAnalysisRunner();
  const json = preferredJsonTool();
  const yaml = preferredYamlTool();
  const search = preferredSearchTool();
  const rows = [
    ['platform', `${process.platform} ${process.arch}`],
    ['default', getDefaultShell().label],
    ['cmd', process.platform === 'win32' ? String(shellAvailable('cmd')) : 'n/a'],
    ['powershell', process.platform === 'win32' ? String(shellAvailable('powershell')) : 'n/a'],
    ['pwsh', String(shellAvailable('pwsh'))],
    ['bash', String(shellAvailable('bash'))],
    ['sh', String(shellAvailable('sh'))],
    ['zsh', String(shellAvailable('zsh'))],
    ['fish', String(shellAvailable('fish'))],
    ['analysis', analysis ? `${analysis.name} (${analysis.path})` : 'none'],
    ['json', json ? `${json.name} (${json.path})` : 'none'],
    ['yaml', yaml ? `${yaml.name} (${yaml.path})` : 'none'],
    ['search', search ? `${search.name} (${search.path})` : 'none'],
    ['local bins', localPaths.length ? localPaths.map((p) => path.relative(PROJECT_ROOT, p) || '.').join(', ') : '(none found)'],
  ];
  const main = rows.map(([k, v]) => `${k.padEnd(12)} ${v}`).join('\n');
  return `${main}\n\nDetected local tools:\n${formatLocalToolsForPrompt()}`;
}

export function getLocalFirstPathEntries(cwd = PROJECT_ROOT): string[] {
  const candidates = [
    path.join(cwd, 'node_modules', '.bin'),
    path.join(cwd, 'vendor', 'bin'),
    path.join(cwd, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin'),
    path.join(cwd, 'venv', process.platform === 'win32' ? 'Scripts' : 'bin'),
    path.join(cwd, 'env', process.platform === 'win32' ? 'Scripts' : 'bin'),
    path.join(cwd, 'bin'),
    path.join(cwd, 'scripts'),
    path.join(cwd, '.bin'),
  ];

  const seen = new Set<string>();
  return candidates.filter((entry) => {
    const resolved = path.resolve(entry);
    if (seen.has(resolved)) return false;
    seen.add(resolved);
    try {
      return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
    } catch {
      return false;
    }
  });
}

export function buildLocalFirstEnv(cwd = PROJECT_ROOT, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  const key = getPathEnvKey(env);
  const currentPath = env[key] || '';
  const localEntries = getLocalFirstPathEntries(cwd);
  if (localEntries.length > 0) {
    env[key] = [...localEntries, currentPath].filter(Boolean).join(path.delimiter);
  }
  return env;
}

function getPathEnvKey(env: NodeJS.ProcessEnv): string {
  if (process.platform !== 'win32') return 'PATH';
  return Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'Path';
}

function normalizeCommandForShell(command: string, shellLabel: string): string {
  let out = command.trim();
  if (process.platform === 'win32' && ['cmd', 'powershell', 'pwsh'].includes(shellLabel)) {
    out = normalizePackageBinsForWindows(out);
    if (shellLabel === 'cmd') out = translateSimpleUnixInspectionForCmd(out);
  }
  if (process.platform !== 'win32' && !['powershell', 'pwsh'].includes(shellLabel)) {
    out = translateSimpleWindowsInspectionForPosix(out);
  }
  return out;
}

function normalizePackageBinsForWindows(command: string): string {
  return command.replace(/^(\s*)(npm|npx|pnpm|yarn|bun)(?=\s|$)/i, (_m, lead, bin) => {
    const lower = String(bin).toLowerCase();
    return `${lead}${lower}.cmd`;
  });
}

function translateSimpleUnixInspectionForCmd(command: string): string {
  const c = command.trim();
  if (/^pwd\s*$/i.test(c)) return 'cd';
  if (/^ls(\s+(-la|-al|-l|-a))?\s*$/i.test(c)) return 'dir';
  if (/^ls\s+([^\s|&<>]+)\s*$/i.test(c)) return `dir ${c.replace(/^ls\s+/i, '')}`;
  if (/^ll\s*$/i.test(c) || /^la\s*$/i.test(c)) return 'dir';
  if (/^cat\s+([^\s|&<>]+)\s*$/i.test(c)) return `type ${c.replace(/^cat\s+/i, '')}`;
  if (/^(command\s+-v|which)\s+([^\s|&<>]+)\s*$/i.test(c)) return `where ${c.replace(/^(command\s+-v|which)\s+/i, '')}`;
  if (/^uname(\s+-[a-z]+)?\s*$/i.test(c)) return 'ver';
  if (/^ifconfig\s*$/i.test(c)) return 'ipconfig';
  if (/^ip\s*$/i.test(c)) return 'ipconfig';
  if (/^ip\s+link\s*$/i.test(c)) return 'ipconfig';
  if (/^ip\s+addr\s*$/i.test(c)) return 'ipconfig';
  if (/^ip\s+route\s*$/i.test(c)) return 'route print';
  if (/^traceroute\b/i.test(c)) return c.replace(/^traceroute\b/i, 'tracert');
  if (/^ss\s+-[a-z]+\s*$/i.test(c)) return 'netstat -ano';
  if (/^netstat\s+-tulpen\s*$/i.test(c)) return 'netstat -ano';
  if (/^ps\s+(aux|-ef)\s*$/i.test(c)) return 'tasklist';
  if (/^head(\s+-n\s+\d+)?\s+([^\s|&<>]+)\s*$/i.test(c)) {
    const n = c.match(/\s+-n\s+(\d+)/i)?.[1] || '10';
    const file = c.replace(/^head(\s+-n\s+\d+)?\s+/i, '');
    return `powershell.exe -NoProfile -Command "Get-Content -TotalCount ${n} ${quotePowerShell(file)}"`;
  }
  if (/^tail(\s+-n\s+\d+)?\s+([^\s|&<>]+)\s*$/i.test(c)) {
    const n = c.match(/\s+-n\s+(\d+)/i)?.[1] || '10';
    const file = c.replace(/^tail(\s+-n\s+\d+)?\s+/i, '');
    return `powershell.exe -NoProfile -Command "Get-Content -Tail ${n} ${quotePowerShell(file)}"`;
  }
  if (/^mkdir\s+-p\s+([^\s|&<>]+)\s*$/i.test(c)) return `mkdir ${c.replace(/^mkdir\s+-p\s+/i, '')}`;
  if (/^touch\s+([^\s|&<>]+)(\s+[^\s|&<>]+)*\s*$/i.test(c)) {
    const files = c.replace(/^touch\s+/i, '').split(/\s+/);
    return files.map((file) => `if not exist ${file} type NUL > ${file}`).join(' && ');
  }
  if (/^rm\s+-f\s+([^\s|&<>]+)\s*$/i.test(c)) return `del /f ${c.replace(/^rm\s+-f\s+/i, '')}`;
  if (/^rm\s+([^\s|&<>]+)\s*$/i.test(c)) return `del ${c.replace(/^rm\s+/i, '')}`;
  if (/^rmdir\s+([^\s|&<>]+)\s*$/i.test(c)) return `rmdir ${c.replace(/^rmdir\s+/i, '')}`;
  if (/^cp\s+([^\s|&<>]+)\s+([^\s|&<>]+)\s*$/i.test(c)) return c.replace(/^cp\s+/i, 'copy ');
  if (/^mv\s+([^\s|&<>]+)\s+([^\s|&<>]+)\s*$/i.test(c)) return c.replace(/^mv\s+/i, 'move ');
  if (/^chmod\s+([0-7]{3,4})\s+([^\s|&<>]+)\s*$/i.test(c)) return `icacls ${c.replace(/^chmod\s+[0-7]{3,4}\s+/i, '')}`;
  if (/^clear\s*$/i.test(c)) return 'cls';
  return command;
}

function translateSimpleWindowsInspectionForPosix(command: string): string {
  const c = command.trim();
  if (/^cd\s*$/i.test(c)) return 'pwd';
  if (/^dir(\s+\/[a-z]+)?\s*$/i.test(c)) return 'ls';
  if (/^dir\s+([^\s|&<>]+)\s*$/i.test(c)) return `ls ${c.replace(/^dir\s+/i, '')}`;
  if (/^type\s+([^\s|&<>]+)\s*$/i.test(c)) return `cat ${c.replace(/^type\s+/i, '')}`;
  if (/^where\s+([^\s|&<>]+)\s*$/i.test(c)) return `command -v ${c.replace(/^where\s+/i, '')}`;
  if (/^cls\s*$/i.test(c)) return 'clear';
  if (/^ver\s*$/i.test(c)) return 'uname -a';
  if (/^systeminfo\s*$/i.test(c)) return 'uname -a';
  if (/^copy\s+([^\s|&<>]+)\s+([^\s|&<>]+)\s*$/i.test(c)) return c.replace(/^copy\s+/i, 'cp ');
  if (/^move\s+([^\s|&<>]+)\s+([^\s|&<>]+)\s*$/i.test(c)) return c.replace(/^move\s+/i, 'mv ');
  if (/^del\s+([^\s|&<>]+)\s*$/i.test(c)) return `rm ${c.replace(/^del\s+/i, '')}`;
  if (/^rmdir\s+([^\s|&<>]+)\s*$/i.test(c)) return `rmdir ${c.replace(/^rmdir\s+/i, '')}`;
  if (/^ipconfig(\s+\/all)?\s*$/i.test(c)) return 'ifconfig';
  if (/^route\s+print\s*$/i.test(c)) return 'ip route';
  if (/^tracert\b/i.test(c)) return c.replace(/^tracert\b/i, 'traceroute');
  if (/^netstat\s+-ano\s*$/i.test(c)) return 'ss -tulpen';
  if (/^pathping\b/i.test(c)) return c.replace(/^pathping\b/i, 'traceroute');
  if (/^tasklist\s*$/i.test(c)) return 'ps aux';
  return command;
}

function isSimpleUnixInspectionForCmd(command: string): boolean {
  const c = command.trim();
  return /^pwd\s*$/i.test(c)
    || /^ls(\s+(-la|-al|-l|-a))?(\s+[^\s|&<>]+)?\s*$/i.test(c)
    || /^ll\s*$/i.test(c)
    || /^la\s*$/i.test(c)
    || /^cat\s+([^\s|&<>]+)\s*$/i.test(c)
    || /^(command\s+-v|which)\s+([^\s|&<>]+)\s*$/i.test(c)
    || /^uname(\s+-[a-z]+)?\s*$/i.test(c)
    || /^ifconfig\s*$/i.test(c)
    || /^ip\s*$/i.test(c)
    || /^ip\s+link\s*$/i.test(c)
    || /^ip\s+(addr|route)\s*$/i.test(c)
    || /^traceroute\b/i.test(c)
    || /^ss\s+-[a-z]+\s*$/i.test(c)
    || /^netstat\s+-tulpen\s*$/i.test(c)
    || /^ps\s+(aux|-ef)\s*$/i.test(c)
    || /^head(\s+-n\s+\d+)?\s+([^\s|&<>]+)\s*$/i.test(c)
    || /^tail(\s+-n\s+\d+)?\s+([^\s|&<>]+)\s*$/i.test(c)
    || /^mkdir\s+-p\s+([^\s|&<>]+)\s*$/i.test(c)
    || /^touch\s+([^\s|&<>]+)(\s+[^\s|&<>]+)*\s*$/i.test(c)
    || /^clear\s*$/i.test(c);
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function looksLikePowerShell(command: string): boolean {
  return /\b(Get|Set|New|Remove|Copy|Move|Rename|Test|Start|Stop|Restart|Invoke|Select|Where|ForEach|Out|Write|Read|Clear|Import|Export|ConvertTo|ConvertFrom|Push|Pop|Join|Split|Resolve)-[A-Za-z]+\b/i.test(command)
    || /\$env:/i.test(command)
    || /\b(gci|gc|sc|ni|ri|sl|irm|iwr)\b/i.test(command)
    || /\b-(Recursive|Recurse|LiteralPath|ExecutionPolicy|NoProfile|NoLogo|Command)\b/i.test(command);
}

function looksLikeUnixShell(command: string): boolean {
  return /^\s*(export|source|sudo|chmod|chown|grep|egrep|fgrep|sed|awk|cat|ls|ll|la|pwd|touch|mkdir\s+-p|rm\s+-|cp\s+-|mv\s+-|find\s+.*\s-name|command\s+-v|which|uname|ifconfig|ip\s+(addr|route)|traceroute|ss|netstat\s+-tulpen|ps\s+(aux|-ef)|brew|apt|apt-get|dnf|yum|pacman|zypper|apk|systemctl|journalctl|open|launchctl|defaults|sw_vers|wsl)\b/i.test(command)
    || /^\s*(\.\/|~\/|bash\s+|sh\s+|zsh\s+|fish\s+|wsl\s+)/i.test(command)
    || /^\s*(env\s+)?[A-Za-z_][A-Za-z0-9_]*=.*\s+\S+/.test(command)
    || /\$\(|`[^`]+`|\${[^}]+}|\$[A-Za-z_][A-Za-z0-9_]*/.test(command)
    || /\|\s*(grep|sed|awk|xargs|tee|head|tail|sort|uniq|wc|cut|tr)\b/i.test(command)
    || /\s(&&|\|\||;)\s/.test(command)
    || /\s(2>|1>|>>|<)\s*\S+/.test(command);
}

function looksLikeWindowsShell(command: string): boolean {
  return /^\s*(dir|type|where|cls|ver|copy|move|del|ipconfig|tasklist|systeminfo|whoami|route\s+print|tracert|pathping|netstat\s+-ano|netsh)\b/i.test(command);
}

function shellAvailable(shellName: string): boolean {
  try {
    if (process.platform === 'win32') {
      const target = shellName === 'cmd' ? 'cmd.exe' : shellName === 'powershell' ? 'powershell.exe' : shellName;
      const result = spawnSync('where.exe', [target], { stdio: 'ignore', windowsHide: true });
      return result.status === 0;
    }
    const result = spawnSync('command', ['-v', shellName], { shell: true, stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

export { killProcessTreeBestEffort } from '../process-tree-kill.js';

export function runProcess(
  file: string,
  args: string[],
  options: {
    cwd?: string;
    timeoutMs?: number;
    maxChars?: number;
    env?: NodeJS.ProcessEnv;
    /** When this returns true, the process tree is killed (user stop / cooperatives cancel). */
    shouldAbort?: () => boolean;
    /** Poll interval for shouldAbort (default 120ms). */
    abortPollMs?: number;
    /** Register child so REPL Ctrl+C can kill the shell tree immediately (same scope as YamX `run_command`). */
    registerForSigint?: boolean;
  } = {}
): Promise<{ text: string; code: number | null; timedOut: boolean; cancelled?: boolean }> {
  return new Promise((resolve) => {
    const timeoutMs = options.timeoutMs ?? 120_000;
    const maxChars = options.maxChars ?? 100_000;
    let child: ChildProcess;
    try {
      const cwd = options.cwd ?? PROJECT_ROOT;
      child = spawn(file, args, {
        cwd,
        env: buildLocalFirstEnv(cwd, { ...process.env, ...options.env }),
        windowsHide: true,
      });
    } catch (err: any) {
      resolve({ text: `Spawn error: ${err.message}`, code: 1, timedOut: false });
      return;
    }

    if (options.registerForSigint) {
      registerShellChildForInterrupt(child);
    }

    let out = '';
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const append = (chunk: string) => {
      if (out.length < maxChars + 1024) out += chunk;
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTreeBestEffort(child);
    }, timeoutMs);

    let abortTimer: ReturnType<typeof setInterval> | undefined;
    if (options.shouldAbort) {
      const pollMs = Math.max(40, Math.min(options.abortPollMs ?? 120, 2_000));
      abortTimer = setInterval(() => {
        if (settled) return;
        try {
          if (options.shouldAbort!()) {
            cancelled = true;
            if (abortTimer) clearInterval(abortTimer);
            abortTimer = undefined;
            killProcessTreeBestEffort(child);
          }
        } catch {
          /* ignore */
        }
      }, pollMs);
    }

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (options.registerForSigint) unregisterShellChildIfMatches(child);
      clearTimeout(timer);
      if (abortTimer) clearInterval(abortTimer);
      resolve({ text: truncateOutput(out.trim(), maxChars), code, timedOut, cancelled: cancelled || undefined });
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (options.registerForSigint) unregisterShellChildIfMatches(child);
      clearTimeout(timer);
      if (abortTimer) clearInterval(abortTimer);
      resolve({ text: `Spawn error: ${err.message}`, code: 1, timedOut });
    });
  });
}
