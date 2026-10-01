#!/usr/bin/env node

/**
 * YamX (ymax) - New Router-Based CLI Entry Point
 * Offline-first, centralized routing, expert modules.
 * Falls back to legacy agent mode when AI is configured and requested.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import readline from 'node:readline/promises';
import os from 'node:os';
import { createRequire } from 'node:module';
import { Config } from './config/index.js';
import { Router, RouteRequest, isDirectShellCommand, KNOWN_SHELL_COMMANDS } from './router/index.js';
import { expertRegistry } from './experts/registry.js';
import { BaseExpert, ExecutionContext } from './experts/base.js';
import { IntelligenceEngine } from './intelligence/index.js';
import { AiOrchestrator } from './ai/orchestrator.js';
import { ProviderAdapter } from './ai/adapter.js';
import { createProvider } from './providers/factory.js';

// Import all experts to trigger self-registration
import './experts/general.js';
import './experts/filesystem.js';
import './experts/shell.js';
import './experts/git.js';
import './experts/devops.js';
import './experts/security.js';
import './experts/project.js';
import './experts/web.js';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { version?: string };
const VERSION = packageJson.version || '0.0.0';

const program = new Command();

program
  .name('ymax')
  .description('YamX - Terminal-first coding and operations agent (offline-first)')
  .version(VERSION)
  .option('-p, --provider <provider>', 'AI provider (optional)')
  .option('-m, --model <model>', 'AI model (optional)')
  .option('--auto-approve', 'Auto-approve risky operations')
  .option('--no-stream', 'Disable streaming output')
  .option('--new-chat', 'Start a new chat session')
  .option('--onboard', 'Run first-time onboarding')
  .option('--diagnose', 'Run system diagnostics')
  .option('--router', 'Force router mode (default)')
  .option('--legacy', 'Use legacy agent mode')
  .argument('[input]', 'Direct command or query')
  .action(async (input: string | undefined, options: any) => {
    await main(input, options);
  });

program
  .command('config')
  .description('Interactive configuration')
  .action(async () => {
    await runDirectCommand('config', {});
  });

program
  .command('web')
  .description('Start web UI server')
  .option('--host <host>', 'Bind host', '127.0.0.1')
  .option('--port <port>', 'Port number', '8765')
  .option('--allow-dangerous', 'Allow dangerous operations from web')
  .action(async (options: any) => {
    await runDirectCommand('web', {
      host: options.host,
      port: parseInt(options.port, 10),
      allowDangerous: options.allowDangerous,
    });
  });

async function main(input?: string, options?: any) {
  const config = new Config();
  const cfg = await config.load();

  // Override config with CLI flags
  if (options?.provider) cfg.defaultProvider = options.provider;
  if (options?.model) cfg.defaultModel = options.model;

  const cwd = process.cwd();
  const router = new Router();
  const intelligence = new IntelligenceEngine();

  // Setup AI orchestrator if providers are configured
  const orchestrator = new AiOrchestrator();
  if (cfg.providers?.custom?.baseUrl) {
    orchestrator.registerProvider(new ProviderAdapter(createProvider('custom', cfg.providers.custom.model, cfg)));
  }

  // Handle --onboard, --diagnose as direct commands
  if (options?.onboard) {
    await runDirectCommand('onboard', {});
    return;
  }
  if (options?.diagnose) {
    await runDirectCommand('diagnose', {});
    return;
  }

  // If input provided as arg, route it directly
  if (input) {
    // Strip accidental self-reference from CLI args too
    const selfRef = /^(ymax|yamx)\s+/i;
    const cleanInput = selfRef.test(input) ? input.replace(selfRef, '') : input;

    const request: RouteRequest = {
      source: 'cli',
      rawInput: cleanInput,
      args: options,
      cwd,
      userConfig: cfg,
    };

    await dispatchRequest(router, request, orchestrator, intelligence);
    return;
  }

  // Start REPL
  await startRepl(router, cfg, cwd, orchestrator, intelligence);
}

async function runDirectCommand(intent: string, params: Record<string, any>) {
  const config = new Config();
  const cfg = await config.load();
  const expert = expertRegistry.get(intent === 'config' || intent === 'onboard' || intent === 'diagnose' ? 'general' : intent);

  if (!expert) {
    console.error(chalk.red(`Unknown command: ${intent}`));
    process.exit(1);
  }

  const context: ExecutionContext = {
    cwd: process.cwd(),
    userConfig: cfg,
  };

  const result = await expert.execute(intent, params, context);
  console.log(typeof result.output === 'string' ? result.output : JSON.stringify(result.output, null, 2));
  process.exit(result.success ? 0 : 1);
}

/** Simple Levenshtein distance for suggesting corrections. */
function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b[i - 1] === a[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

function suggestClosestCommand(input: string): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  for (const cmd of KNOWN_SHELL_COMMANDS) {
    const dist = levenshtein(input, cmd);
    if (dist < bestDist && dist <= 2) {
      bestDist = dist;
      best = cmd;
    }
  }
  return best;
}

async function dispatchRequest(
  router: Router,
  request: RouteRequest,
  orchestrator: AiOrchestrator,
  intelligence: IntelligenceEngine
): Promise<void> {
  const routeResult = await router.dispatch(request);

  // Decide whether to augment with AI
  const decision = await orchestrator.decide(
    request.rawInput,
    routeResult.confidence,
    request.args?.legacy || false
  );

  if (decision.useAi) {
    console.log(chalk.dim('[AI augmentation active]'));
  }

  const expert = expertRegistry.resolve(routeResult);
  const context: ExecutionContext = {
    cwd: request.cwd,
    sessionId: request.sessionId,
    userConfig: request.userConfig,
  };

  // Suppress domain/confidence banner for direct shell commands to keep output clean
  if (routeResult.confidence < 1.0) {
    console.log(chalk.dim(`[${expert.domain}] ${routeResult.intent} (confidence: ${(routeResult.confidence * 100).toFixed(0)}%)`));
  }

  const result = await expert.execute(routeResult.intent, routeResult.params, context);

  if (typeof result.output === 'string') {
    console.log(result.output);
  } else {
    console.log(JSON.stringify(result.output, null, 2));
  }

  // Detect shell command failures from output text (ShellExpert always returns success=true)
  const outputText = typeof result.output === 'string' ? result.output : '';
  const shellFailed = isDirectShellCommand(request.rawInput) &&
    /\(exit\s+[1-9]\d*\)|not recognized|command not found|is not recognized|No such file|cannot find|was not found/i.test(outputText);

  if (shellFailed) {
    const firstToken = request.rawInput.trim().split(/\s+/)[0].toLowerCase();

    // Platform-specific command suggestions
    if (process.platform === 'win32') {
      const winAlternatives: Record<string, string> = {
        ip: 'ipconfig',
        ifconfig: 'ipconfig',
        ps: 'tasklist',
        top: 'tasklist',
        htop: 'tasklist',
        netstat: 'netstat -an',
        ss: 'netstat -an',
        cat: 'type',
        ls: 'dir',
        rm: 'del',
        cp: 'copy',
        mv: 'move',
        touch: 'type NUL >',
        grep: 'findstr',
        diff: 'fc',
        nano: 'notepad',
        vim: 'notepad',
      };
      if (winAlternatives[firstToken]) {
        console.log(chalk.yellow(`\nOn Windows, try: ${winAlternatives[firstToken]}`));
      }
    } else {
      const unixAlternatives: Record<string, string> = {
        ipconfig: 'ip addr',
        tasklist: 'ps aux',
        dir: 'ls',
        del: 'rm',
        copy: 'cp',
        move: 'mv',
        type: 'cat',
        findstr: 'grep',
        fc: 'diff',
      };
      if (unixAlternatives[firstToken]) {
        console.log(chalk.yellow(`\nOn Linux/macOS, try: ${unixAlternatives[firstToken]}`));
      }
    }

    const suggestion = suggestClosestCommand(firstToken);
    if (suggestion && suggestion !== firstToken) {
      console.log(chalk.yellow(`Did you mean: ${suggestion}?`));
    }
  }

  if (result.followUpIntents && result.followUpIntents.length > 0) {
    console.log(chalk.dim(`\nSuggested: ${result.followUpIntents.join(', ')}`));
  }
}

async function startRepl(
  router: Router,
  cfg: import('./config/index.js').YamConfig,
  cwd: string,
  orchestrator: AiOrchestrator,
  intelligence: IntelligenceEngine
): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('ymax> '),
  });

  console.log(chalk.bold(`YamX v${VERSION} — Offline Terminal Agent`));
  console.log(chalk.dim('Type "help" for commands, "exit" to quit.\n'));

  rl.prompt();

  rl.on('line', async (line) => {
    let input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    if (input === 'exit' || input === 'quit') {
      console.log(chalk.dim('Goodbye.'));
      rl.close();
      return;
    }

    // Strip accidental self-reference: "ymax ip addr" -> "ip addr"
    const selfRef = /^(ymax|yamx)\s+/i;
    if (selfRef.test(input)) {
      input = input.replace(selfRef, '');
    }

    // For direct shell commands, show a brief running indicator
    const isShell = isDirectShellCommand(input);
    if (isShell) {
      console.log(chalk.dim('Running...'));
    }

    const request: RouteRequest = {
      source: 'repl',
      rawInput: input,
      cwd,
      userConfig: cfg,
    };

    try {
      await dispatchRequest(router, request, orchestrator, intelligence);
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err?.message || err}`));
    }

    console.log('');
    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

// Run if executed directly
import { pathToFileURL } from 'node:url';
const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  program.parse();
}
