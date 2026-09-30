/**
 * YamX - Centralized Router
 * Single entry point for all input vectors: CLI, REPL, API, Web.
 * Dispatches RouteRequest to the appropriate expert via intent classification.
 */

import { YamConfig } from '../config/index.js';
import { RouteTable, RouteDefinition } from './routes.js';
import { IntentClassifier, IntentClassification } from './intent-classifier.js';
import { ParamExtractor } from './param-extractor.js';

export type InputSource = 'cli' | 'repl' | 'api' | 'web';

/** Common shell commands that should bypass classification and execute directly.
 *  NOTE: Words that are also ymax route patterns (read, write, edit, search, list,
 *  delete, run, help, config, web, scan, security) are intentionally EXCLUDED so
 *  they route through the classifier and hit the correct expert.
 */
export const KNOWN_SHELL_COMMANDS = new Set([
  // Filesystem (exclude: read, write, edit, search, list, delete)
  'ls', 'll', 'la', 'dir', 'cd', 'pwd', 'cat', 'bat', 'less', 'more', 'head', 'tail',
  'touch', 'mkdir', 'rmdir', 'rm', 'cp', 'mv', 'ln', 'chmod', 'chown', 'stat',
  'find', 'locate', 'which', 'where', 'whereis', 'type',
  // Text processing
  'grep', 'rg', 'ag', 'ack', 'awk', 'sed', 'cut', 'sort', 'uniq', 'wc', 'tr',
  'diff', 'cmp', 'comm', 'patch', 'xargs', 'jq', 'yq',
  // Archives
  'tar', 'gzip', 'gunzip', 'zip', 'unzip', '7z', 'rar',
  // System
  'ps', 'top', 'htop', 'kill', 'pkill', 'killall', 'pgrep', 'pidof',
  'uptime', 'whoami', 'id', 'uname', 'hostname', 'env', 'printenv',
  'df', 'du', 'free', 'vmstat', 'iostat', 'mpstat', 'sar',
  'systemctl', 'service', 'journalctl', 'dmesg',
  // Network
  'ip', 'ifconfig', 'ping', 'traceroute', 'tracepath', 'mtr',
  'curl', 'wget', 'nc', 'netcat', 'nmap', 'ss', 'netstat', 'lsof',
  'dig', 'nslookup', 'host', 'whois', 'ssh', 'scp', 'sftp', 'rsync',
  'telnet', 'ftp', 'smbclient',
  // Package managers
  'npm', 'npx', 'yarn', 'pnpm', 'node', 'deno', 'bun',
  'pip', 'pip3', 'python', 'python3', 'py', 'poetry', 'uv',
  'cargo', 'rustc', 'rustup',
  'go', 'gofmt', 'golangci-lint',
  'gem', 'bundle', 'ruby', 'irb',
  'composer', 'php', 'pear',
  'mvn', 'gradle', 'java', 'javac', 'jar',
  'dotnet', 'nuget',
  'brew', 'apt', 'apt-get', 'dpkg', 'snap', 'flatpak',
  'pacman', 'yay', 'yum', 'dnf', 'rpm', 'apk',
  'choco', 'winget', 'scoop',
  // Dev tools (exclude: run — it is a ymax route pattern)
  'git', 'gh', 'git-lfs',
  'docker', 'docker-compose', 'podman', 'kubectl', 'helm', 'k9s',
  'terraform', 'pulumi', 'ansible', 'ansible-playbook',
  'aws', 'gcloud', 'az', 'firebase', 'vercel', 'netlify',
  'make', 'cmake', 'ninja', 'meson',
  'gcc', 'g++', 'clang', 'clang++', 'cc', 'c++', 'ld', 'ar', 'nm',
  'eslint', 'prettier', 'tsc', 'tsx', 'vite', 'webpack', 'rollup',
  'jest', 'vitest', 'mocha', 'cypress', 'playwright',
  'ffmpeg', 'imagemagick', 'convert',
  // Editors / viewers
  'vim', 'nvim', 'vi', 'nano', 'emacs', 'code', 'subl', 'atom',
  // Misc (exclude: help, config, exit, clear — they are ymax route patterns)
  'echo', 'printf', 'history', 'alias',
  'source', 'export', 'set', 'unset',
  'sleep', 'wait', 'nohup', 'tmux', 'screen', 'zellij',
  'base64', 'md5sum', 'sha256sum', 'openssl', 'gpg',
  'crontab', 'at', 'batch', 'timeout', 'time', 'perf',
  'tree', 'fd', 'fzf', 'z', 'zoxide', 'eza', 'exa', 'lsd',
  'tldr', 'cheat', 'man', 'info', 'apropos',
  'httrack', 'wget2', 'aria2c', 'axel',
]);

export function isDirectShellCommand(input: string): boolean {
  const firstToken = input.trim().split(/\s+/)[0].toLowerCase();
  if (!firstToken) return false;

  // Explicit shell markers always count
  if (/^[$>!]/.test(firstToken)) return true;

  // Known command
  if (KNOWN_SHELL_COMMANDS.has(firstToken)) return true;

  // Script invocation (./file, ~/file, C:\path, path with extension)
  if (/^(\.\/|\.\\|\~\/|[A-Za-z]:\\|.*\.(sh|bat|cmd|ps1|py|js|ts|rb|pl|exe)$)/.test(firstToken)) {
    return true;
  }

  // Compound command indicators
  if (/[|&;<>]/.test(input)) return true;

  return false;
}

export interface RouteRequest {
  source: InputSource;
  rawInput: string;
  args?: Record<string, any>;
  sessionId?: string;
  cwd: string;
  userConfig: YamConfig;
}

export interface RouteResult {
  expert: string;
  intent: string;
  confidence: number;
  params: Record<string, any>;
  executionMode: 'direct' | 'interactive' | 'async';
  classification: IntentClassification;
}

export class Router {
  private routeTable: RouteTable;
  private classifier: IntentClassifier;
  private paramExtractor: ParamExtractor;

  constructor() {
    this.routeTable = new RouteTable();
    this.classifier = new IntentClassifier(this.routeTable);
    this.paramExtractor = new ParamExtractor();
  }

  async dispatch(request: RouteRequest): Promise<RouteResult> {
    const rawInput = request.rawInput.trim();

    // Empty input -> general expert interactive
    if (!rawInput) {
      return this.buildResult('general', 'empty_input', 1.0, {}, 'interactive', {
        topMatch: { route: this.routeTable.getFallbackRoute(), score: 1.0 },
        candidates: [],
        method: 'exact',
      });
    }

    // Fast-path: direct shell commands bypass classification entirely
    if (isDirectShellCommand(rawInput)) {
      return this.buildResult(
        'shell',
        'run_command',
        1.0,
        { command: rawInput },
        'direct',
        {
          topMatch: { route: this.routeTable.getRouteByName('shell_run') || this.routeTable.getFallbackRoute(), score: 1.0 },
          candidates: [],
          method: 'exact',
        }
      );
    }

    // 1. Classify intent offline
    const classification = await this.classifier.classify(rawInput, request.source);

    // 2. Extract structured parameters
    const params = this.paramExtractor.extract(rawInput, classification.topMatch.route);
    // Merge any CLI/API args
    if (request.args) {
      Object.assign(params, request.args);
    }

    // 3. Determine execution mode
    const executionMode = this.resolveExecutionMode(classification.topMatch.route, params, request.source);

    // 4. Build result
    return this.buildResult(
      classification.topMatch.route.expert,
      classification.topMatch.route.intent,
      classification.topMatch.score,
      params,
      executionMode,
      classification
    );
  }

  private resolveExecutionMode(
    route: RouteDefinition,
    params: Record<string, any>,
    source: InputSource
  ): 'direct' | 'interactive' | 'async' {
    if (route.executionMode) return route.executionMode;
    if (source === 'cli' && params['autoApprove']) return 'direct';
    if (route.expert === 'web' && params['background']) return 'async';
    return 'interactive';
  }

  private buildResult(
    expert: string,
    intent: string,
    confidence: number,
    params: Record<string, any>,
    executionMode: 'direct' | 'interactive' | 'async',
    classification: IntentClassification
  ): RouteResult {
    return {
      expert,
      intent,
      confidence: Math.min(Math.max(confidence, 0), 1),
      params,
      executionMode,
      classification,
    };
  }

  getAvailableRoutes(): RouteDefinition[] {
    return this.routeTable.getAllRoutes();
  }

  getRouteByName(name: string): RouteDefinition | undefined {
    return this.routeTable.getRouteByName(name);
  }
}

export const defaultRouter = new Router();
