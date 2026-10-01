#!/usr/bin/env node

/**
 * YamX CLI v1.0.0 - coding agent with persistent sessions
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import dotenv from 'dotenv';
import fs from 'fs-extra';
import readline from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import os from 'node:os';
import nodePath from 'node:path';
import { createRequire } from 'node:module';
import { stdin, stdout } from 'node:process';
import { Agent } from './agent.js';
import { Config } from './config/index.js';
import { ContextEngine } from './context.js';
import { REPL_PROMPT, UI } from './ui.js';
import { Provider, Message } from './providers/base.js';
import { createProvider, normalizeChatBaseUrl } from './providers/factory.js';
import { OfflineProvider } from './providers/offline.js';
import { runOfflineIntelligence } from './offline-repl.js';
import { execSync } from 'child_process';
import { SessionStore, type ChatSession } from './session-store.js';
import { getToolCount } from './tools/registry.js';
import { parseDirectCommand } from './direct-command.js';
import { isDirectShellFailure, isDirectShellUserCancelled, isCommandNotFoundFailure, extractMissingCommandToken } from './direct-shell-diagnose.js';
import { runCommand } from './tools/shell.js';
import { handleCommand } from './commands/index.js';
import { buildAgentInputWithProjectIntel, shouldAttachProjectIntel, isCodingTurn, buildCodingBrief, wrapCodingBrief, savePendingCodingBrief, consumePendingCodingBrief } from './project-intel.js';
import { detectOfflineProjectScanIntent, runOfflineProjectScanAndSave } from './offline-project-scan.js';
import { REPL_HISTORY_PATH, printReplHistory } from './repl-history.js';
import { DEFAULT_MAX_ASSISTANT_MARKDOWN_CHARS } from './assistant-output-cap.js';
import { ttyResetBeforeReplPrompt } from './tty-repl-cue.js';
import {
  setRunCommandAbortCheck,
  interruptShellChildForUser,
  clearShellInterruptState,
} from './shell-abort-context.js';
import { maybePromptCliUpdate } from './cli-update-check.js';
import { startYamxWebServer } from './web/server.js';
import { ensureCommandIntelligenceDatabase, suggestCommandFix, suggestCommands, type CommandSuggestion } from './command-intelligence.js';
import { getCommandCorrections, isAutoExecutable, translateCommand, currentTarget, type CommandCorrection } from './command-corrections.js';
import { PROJECT_ROOT } from './tools/utils.js';

dotenv.config({ quiet: true });

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { version?: string };
const VERSION = packageJson.version || '0.0.0';
const program = new Command();

/** Bracket glyphs: readable on legacy Windows consoles that are not UTF-8 (code page issues). */
const TERM = {
  ok: chalk.green('[+]'),
  idle: chalk.dim('[-]'),
  bad: chalk.red('[x]'),
  warn: chalk.yellow('[!]'),
} as const;

function parseWebPort(value: unknown): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('Port must be an integer between 0 and 65535.');
  }
  return port;
}

program
  .name('yamx')
  .description('YamX - agent CLI with persistent chat sessions')
  .version(VERSION)
  .option('-m, --model <model>', 'Model name for the saved endpoint')
  .option('--auto-approve', 'Auto-approve all tool actions (dangerous!)', false)
  .option('--no-stream', 'Disable streaming output')
  .option('-t, --temperature <temp>', 'Temperature (0-1)', '0.1')
  .option('--max-tokens <tokens>', 'Max output tokens', '16384')
  .option('--new-chat', 'Start a fresh conversation (new session)', false)
  .option('--clear-chat', 'Clear active session history on disk, then exit', false)
  .option('--history', 'List saved conversations, then exit', false)
  .option('--resume <id>', 'Resume a session (full UUID or unique prefix)')
  .option('--delete-chat <id>', 'Delete a session by id or prefix, then exit', '')
  .option('--onboard', 'Set base URL, API key, and model name', false)
  .option('--reset-config', 'Reset ~/.yamx/config.json to defaults, then exit', false)
  .option('--diagnose', 'Check configuration and the saved model endpoint', false);

program
  .command('config')
  .description('Configure YamX (API keys, defaults)')
  .action(async () => {
    const config = new Config();
    await config.load();

    const { action } = await inquirer.prompt([
      {
        type: 'rawlist',
        name: 'action',
        message: 'What would you like to configure?',
        choices: [
          { name: 'Set base URL, API key, and model', value: 'wizard' },
          { name: 'Set model name for the saved endpoint', value: 'model' },
          { name: 'Set context budget (chars for auto-summarize)', value: 'budget' },
          { name: 'Set low-memory context rollover mode', value: 'contextmode' },
          { name: 'Set max tool-result history size', value: 'toolresults' },
          { name: 'Toggle Auto-Approve', value: 'autoapprove' },
          { name: 'Toggle Model Council', value: 'council' },
          { name: 'Toggle npm update check (new YamX versions)', value: 'updates' },
          { name: 'View Current Config', value: 'view' },
        ],
      },
    ]);

    if (action === 'wizard') {
      await runOnboard(config, { title: 'Connect a model' });
    } else if (action === 'model') {
      const current = config.get().providers.custom?.model || config.get().defaultModel || '';
      const { model } = await inquirer.prompt<{ model: string }>([
        {
          type: 'input',
          name: 'model',
          message: 'Model name for the saved endpoint:',
          default: current,
          validate: (value: string) => value.trim().length > 0 || 'Model name is required',
        },
      ]);
      const next = model.trim();
      config.set('defaultProvider', 'custom');
      config.set('defaultModel', next);
      config.set('providers.custom.model', next);
      await config.save();
      console.log(chalk.green(`[+] Model set to ${next}.`));
    } else if (action === 'budget') {
      const { n } = await inquirer.prompt([
        {
          type: 'input',
          name: 'n',
          message: 'Max total history size (chars) before auto-summarization:',
          default: String(config.get().settings.contextBudgetChars),
        },
      ]);
      const v = parseInt(n, 10);
      if (v > 10_000) {
        config.set('settings.contextBudgetChars', v);
        await config.save();
        console.log(chalk.green(`[+] contextBudgetChars = ${v}`));
      } else {
        console.log(chalk.yellow('Value too small; unchanged.'));
      }
    } else if (action === 'contextmode') {
      const curKeep = config.get().settings.contextKeepLastMessages ?? 16;
      const curMode = config.get().settings.contextRolloverMode ?? 'off';
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'keep',
          message: 'Keep how many newest messages when compacting history?',
          default: String(curKeep),
          validate: (value: string) => {
            const n = Number(value);
            return (Number.isFinite(n) && n >= 4 && n <= 40) || 'Use a number between 4 and 40';
          },
        },
        {
          type: 'rawlist',
          name: 'mode',
          message: 'When history grows, should YamX roll into a lightweight summary thread for next turns?',
          default: curMode,
          choices: [
            { name: 'off (default)', value: 'off' },
            { name: 'summary-next-session (best for weak hardware)', value: 'summary-next-session' },
          ],
        },
      ]);
      config.set('settings.contextKeepLastMessages', Number(answers.keep));
      config.set('settings.contextRolloverMode', answers.mode);
      await config.save();
      console.log(chalk.green(`[+] contextKeepLastMessages = ${answers.keep}, contextRolloverMode = ${answers.mode}`));
    } else if (action === 'toolresults') {
      const { n } = await inquirer.prompt([
        {
          type: 'input',
          name: 'n',
          message: 'Max tool-result chars kept in model history:',
          default: String(config.get().settings.maxToolResultChars || 24_000),
        },
      ]);
      const v = parseInt(n, 10);
      if (v >= 4000 && v <= 100_000) {
        config.set('settings.maxToolResultChars', v);
        await config.save();
        console.log(chalk.green(`[+] maxToolResultChars = ${v}`));
      } else {
        console.log(chalk.yellow('Use a value between 4000 and 100000; unchanged.'));
      }
    } else if (action === 'autoapprove') {
      const current = config.get().settings.autoApprove;
      const { approve } = await inquirer.prompt([
        { type: 'confirm', name: 'approve', message: `Enable auto-approve by default? (Currently: ${current})`, default: current },
      ]);
      config.set('settings.autoApprove', approve);
      await config.save();
      console.log(chalk.green(`[+] Auto-approve set to ${approve}.`));
    } else if (action === 'council') {
      const current = config.get().settings.modelCouncil?.enabled === true;
      const { enabled, mode } = await inquirer.prompt([
        { type: 'confirm', name: 'enabled', message: `Enable hidden model council before agent replies? (Currently: ${current})`, default: current },
        {
          type: 'rawlist',
          name: 'mode',
          message: 'Model council token mode:',
          default: config.get().settings.modelCouncil?.mode || 'adaptive',
          choices: [
            { name: 'adaptive (recommended)', value: 'adaptive' },
            { name: 'always (higher token cost)', value: 'always' },
            { name: 'off (lowest cost)', value: 'off' },
          ],
        },
      ]);
      config.set('settings.modelCouncil.enabled', enabled);
      config.set('settings.modelCouncil.mode', enabled ? mode : 'off');
      await config.save();
      console.log(chalk.green(`[+] Model council set to ${enabled ? mode : 'off'}.`));
    } else if (action === 'updates') {
      const current = config.get().settings.checkForUpdates === true;
      const { enabled } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'enabled',
          message:
            'When enabled, YamX checks npm for a newer release (at most once per 24h) and asks before running npm install -g.',
          default: current,
        },
      ]);
      config.set('settings.checkForUpdates', enabled);
      await config.save();
      console.log(chalk.green(`[+] checkForUpdates = ${enabled}`));
    } else if (action === 'view') {
      const cfg = config.get();
      const safe = JSON.parse(JSON.stringify(cfg));
      // Mask API keys for display
      for (const p of Object.values(safe.providers || {})) {
        if (p && typeof p === 'object' && 'apiKey' in p) {
          const k = (p as any).apiKey as string;
          (p as any).apiKey = k ? `${k.slice(0, 8)}...${k.slice(-4)}` : '(not set)';
        }
      }
      console.log(JSON.stringify(safe, null, 2));
    }
  });

program
  .command('web')
  .description('Start the local YamX web command UI')
  .option('-P, --port <port>', 'Port to listen on', '8765')
  .option('--host <host>', 'Host to bind', '127.0.0.1')
  .option('-m, --model <model>', 'Model for the saved endpoint')
  .option('--auth-user <username>', 'HTTP Basic auth username (or YAMX_WEB_USERNAME)')
  .option('--auth-pass <password>', 'HTTP Basic auth password (or YAMX_WEB_PASSWORD)')
  .option('--auth-realm <realm>', 'HTTP Basic auth realm (or YAMX_WEB_AUTH_REALM)', 'YamX Web')
  .option('--allow-dangerous', 'Allow destructive or sensitive commands from the web UI', false)
  .action(async (options) => {
    const port = parseWebPort(options.port);
    const host = String(options.host || '127.0.0.1').trim() || '127.0.0.1';
    const authUser = typeof options.authUser === 'string' ? options.authUser : process.env.YAMX_WEB_USERNAME;
    const authPass = typeof options.authPass === 'string' ? options.authPass : process.env.YAMX_WEB_PASSWORD;
    const authRealm =
      (typeof options.authRealm === 'string' ? options.authRealm : process.env.YAMX_WEB_AUTH_REALM) || 'YamX Web';
    const authEnabled = Boolean(String(authUser ?? '').trim() && String(authPass ?? ''));
    const app = await startYamxWebServer({
      port,
      host,
      allowDangerous: options.allowDangerous === true,
      modelName: options.model,
      authUsername: authUser,
      authPassword: authPass,
      authRealm,
    });
    console.log(chalk.green(`[+] YamX web UI: ${app.url}`));
    console.log(chalk.dim(`    cwd: ${process.cwd()}`));
    console.log(chalk.dim(`    dangerous commands: ${options.allowDangerous ? 'allowed' : 'blocked'}`));
    console.log(chalk.dim(`    auth: ${authEnabled ? `enabled (${String(authUser).trim()})` : 'disabled'}`));
    if (!authEnabled && host !== '127.0.0.1' && host !== 'localhost') {
      console.log(chalk.yellow('    warning: auth disabled while listening on a non-localhost host.'));
    }

    process.on('SIGINT', async () => {
      await app.close().catch(() => undefined);
      console.log(chalk.dim('\nStopped YamX web UI.'));
      process.exit(0);
    });
  });

program.action(async (options) => {
  const config = new Config();
  const cfg = await config.load();
  const verboseCli = cfg.settings?.verboseCli === true;
  const councilOn = cfg.settings?.modelCouncil?.enabled === true;
  const assistantMdCap =
    cfg.settings?.maxAssistantMarkdownChars ?? DEFAULT_MAX_ASSISTANT_MARKDOWN_CHARS;
  const ui = new UI({ verbose: verboseCli, maxAssistantMarkdownChars: assistantMdCap });
  const store = new SessionStore();
  await store.init();

  if (options.resetConfig) {
    await config.resetToDefaults();
    console.log(chalk.green('Config reset. Session files in ~/.yamx/sessions/ were not deleted.'));
    process.exit(0);
  }

  if (options.onboard) {
    await runOnboard(config, { title: 'Connect a model', exitOnCancel: true });
    process.exit(0);
  }

  if (options.diagnose) {
    await runDiagnose(config, cfg);
    process.exit(0);
  }

  const delArg = options.deleteChat != null ? String(options.deleteChat).trim() : '';

  if (options.history) {
    const sessions = await store.listSessions();
    if (sessions.length === 0) {
      console.log(chalk.dim('No saved conversations yet.'));
      process.exit(0);
    }
    console.log(chalk.bold('\nSaved conversations\n'));
    for (const s of sessions) {
      const active = (await store.getActiveSessionId()) === s.id ? chalk.green('* ') : '  ';
      const msgCount = s.messages.length;
      console.log(
        `${active}${chalk.cyan(s.id.slice(0, 8))}  ${chalk.dim(s.updatedAt.slice(0, 16))}  ${chalk.dim(`${msgCount}msg`)}  ${s.title}`
      );
    }
    console.log(chalk.dim('\nResume: yamx --resume <id>\n'));
    process.exit(0);
  }

  if (delArg) {
    const r = await resolveSessionRef(store, delArg);
    if (r === 'ambiguous') {
      console.log(chalk.red('Multiple sessions match. Use a longer id: yamx --history'));
      process.exit(1);
    }
    if (!r) {
      console.log(chalk.red(`No session matching: ${delArg}`));
      process.exit(1);
    }
    await store.deleteSession(r);
    console.log(chalk.green(`Deleted session ${r}`));
    process.exit(0);
  }

  if (options.clearChat) {
    const activeId = await store.getActiveSessionId();
    if (!activeId) {
      console.log(chalk.yellow('No active session.'));
      process.exit(1);
    }
    const sess = await store.loadSession(activeId);
    if (!sess || sess.messages.length === 0) {
      console.log(chalk.yellow('Nothing to clear.'));
      process.exit(1);
    }
    const sys = sess.messages[0];
    if (sys.role !== 'system') {
      console.log(chalk.red('Invalid session file (first message must be system).'));
      process.exit(1);
    }
    sess.messages = [sys];
    await store.saveSession(sess);
    console.log(chalk.green('Active conversation cleared (system prompt kept).'));
    process.exit(0);
  }

  const modelNameFromConfig = cfg.providers?.custom?.model || cfg.defaultModel;
  let modelName = options.model || modelNameFromConfig;
  let providerName = 'custom';
  let provider: Provider;
  try {
    provider = createProvider('custom', modelName, cfg);
    providerName = provider.name;
    modelName = provider.modelId;
  } catch (error: any) {
    const setupMsg = String(error?.message || error);
    if (setupMsg.includes('API key not found') || setupMsg.includes('Custom endpoint not configured')) {
      provider = new OfflineProvider();
      providerName = provider.name;
      modelName = provider.modelId;
    } else {
      ui.error(error.message);
      process.exit(1);
    }
  }

  if (cfg.settings?.checkForUpdates === true) {
    await maybePromptCliUpdate(VERSION);
  }

  const contextEngine = new ContextEngine(PROJECT_ROOT);
  ui.startThinking('Scanning project...');
  const systemPrompt = await contextEngine.buildSystemPrompt();
  ui.stopSpinner();
  ui.info(
    provider.name === 'offline'
      ? `Offline · local routing, shell, files, and git · /connect to add a model\n`
      : `Project scanned | ${getToolCount()} tools loaded | ~/.yamx/sessions/\n`
  );

  let currentSession: ChatSession;

  if (options.newChat) {
    currentSession = await store.createSession(process.cwd(), {
      role: 'system',
      content: systemPrompt,
    });
  } else if (options.resume) {
    const r = await resolveSessionRef(store, String(options.resume).trim());
    if (r === 'ambiguous') {
      ui.error('Multiple sessions match this prefix. Use a longer id: yamx --history');
      process.exit(1);
    }
    if (!r) {
      ui.error(`No session matching "${options.resume}". Use: yamx --history`);
      process.exit(1);
    }
    const loaded = await store.loadSession(r);
    if (!loaded) {
      ui.error('Session file missing.');
      process.exit(1);
    }
    await store.setActiveSessionId(loaded.id);
    currentSession = loaded;
  } else {
    const activeId = await store.getActiveSessionId();
    if (activeId) {
      const loaded = await store.loadSession(activeId);
      if (loaded) {
        currentSession = loaded;
      } else {
        currentSession = await store.createSession(process.cwd(), {
          role: 'system',
          content: systemPrompt,
        });
      }
    } else {
      const list = await store.listSessions();
      if (list.length > 0) {
        currentSession = list[0];
        await store.setActiveSessionId(currentSession.id);
      } else {
        currentSession = await store.createSession(process.cwd(), {
          role: 'system',
          content: systemPrompt,
        });
      }
    }
  }

  const initialMessages: Message[] =
    currentSession.messages.length > 0
      ? (JSON.parse(JSON.stringify(currentSession.messages)) as Message[])
      : [{ role: 'system', content: systemPrompt }];

  const stream =
    options.stream === false ? false : cfg.settings?.streamOutput !== false;

  let agent: Agent;
  const saveToDisk = async () => {
    currentSession.messages = agent.getHistory();
    store.updateTitleFromFirstMessage(currentSession);
    await store.saveSession(currentSession);
  };

  agent = new Agent(provider, systemPrompt, {
    autoApprove: options.autoApprove || cfg.settings?.autoApprove || false,
    stream,
    maxTokens: parseInt(String(options.maxTokens), 10) || cfg.settings?.maxTokens || 16384,
    temperature: parseFloat(String(options.temperature)) || cfg.settings?.temperature || 0.1,
    initialHistory: initialMessages,
    onPersist: saveToDisk,
    contextBudgetChars: cfg.settings?.contextBudgetChars ?? 280_000,
    contextKeepLastMessages: cfg.settings?.contextKeepLastMessages ?? 16,
    contextRolloverMode: cfg.settings?.contextRolloverMode ?? 'off',
    permissionMode: cfg.settings?.permissionMode ?? 'default',
    allowedShellCommands: cfg.settings?.allowedShellCommands ?? [],
    deniedShellPatterns: cfg.settings?.deniedShellPatterns ?? [],
    hooksEnabled: cfg.settings?.hooksEnabled !== false,
    modelCouncilEnabled: councilOn,
    modelCouncilMode: cfg.settings?.modelCouncil?.mode ?? 'adaptive',
    maxToolResultChars: cfg.settings?.maxToolResultChars ?? 24_000,
    verboseCli,
    maxAssistantMarkdownChars: assistantMdCap,
    preflightRuntimeProbes: cfg.settings?.preflightRuntimeProbes !== false,
    subagentsEnabled: cfg.settings?.subagents?.enabled !== false,
    subagentMaxParallel: cfg.settings?.subagents?.maxParallel ?? 3,
    subagentMaxIterations: cfg.settings?.subagents?.maxIterations ?? 12,
  });

  await ui.banner(provider.name, provider.modelId, {
    title: currentSession.title,
    id: currentSession.id,
  }, getToolCount(), VERSION, councilOn);

  const intelligencePath = await ensureCommandIntelligenceDatabase();

  console.log(); // spacer after banner

  const inputSession = await createInputSession();
  let activeWork = false;
  /**
   * Ctrl+C while work is active:
   * 1st (logical) press — kill the shell tree immediately + cooperative stop.
   * 2nd press — exit YamX (save first).
   * One physical key can emit SIGINT twice on Windows; debounce + min gap avoid treating that as two presses.
   */
  let workSigintLastEventAt = 0;
  let workSigintBurstStart = 0;
  let workSigintBurstCount = 0;
  const SIGINT_DEBOUNCE_MS = 95;
  /** Min ms after first counted Ctrl+C before a second counts as "exit YamX" (filters Windows echo-SIGINT). */
  const FORCE_EXIT_MIN_GAP_MS = 320;
  const FORCE_EXIT_WINDOW_MS = 8000;

  const endReplActiveWork = () => {
    activeWork = false;
    workSigintLastEventAt = 0;
    workSigintBurstStart = 0;
    workSigintBurstCount = 0;
    clearShellInterruptState();
  };

  process.on('SIGINT', async () => {
    if (activeWork) {
      inputSession.clearPrompt?.();
      const now = Date.now();
      if (now - workSigintLastEventAt < SIGINT_DEBOUNCE_MS) return;
      workSigintLastEventAt = now;

      if (workSigintBurstCount === 0 || now - workSigintBurstStart > FORCE_EXIT_WINDOW_MS) {
        workSigintBurstStart = now;
        workSigintBurstCount = 0;
      }
      workSigintBurstCount += 1;

      interruptShellChildForUser();

      if (workSigintBurstCount >= 2 && now - workSigintBurstStart >= FORCE_EXIT_MIN_GAP_MS) {
        console.log(chalk.dim('\nSecond interrupt: exiting YamX…'));
        endReplActiveWork();
        await saveToDisk().catch(() => undefined);
        inputSession.close();
        process.exit(130);
      }

      const stopAlreadyPending = agent.isStopRequested();
      agent.requestStop();
      if (stopAlreadyPending) {
        agent.getUI().replForceExitHint();
      }
      return;
    }

    workSigintLastEventAt = 0;
    workSigintBurstStart = 0;
    workSigintBurstCount = 0;
    try {
      await saveToDisk();
      inputSession.close();
    } catch {
      inputSession.close();
      /* ignore */
    }
    console.log(chalk.dim('\nSaved. Bye.'));
    process.exit(0);
  });

  while (true) {
    let input: string;
    try {
      input = (await inputSession.question(REPL_PROMPT)).trim();
      if (!input) continue;
      await inputSession.save(input);
    } catch {
      inputSession.close();
      await saveToDisk();
      console.log(chalk.dim('\nGoodbye.'));
      process.exit(0);
    }

    if (input.startsWith('/')) {
      activeWork = true;
      try {
        await handleCommand(input, agent, provider, { store, session: currentSession, agent }, cfg, executeDirectCommand, {
          onConnect: async () => {
            const saved = await runOnboard(config, { title: 'Connect a model', exitOnCancel: false });
            if (!saved) return;
            Object.assign(cfg, config.get());
            providerName = 'custom';
            modelName = options.model || cfg.providers?.custom?.model || cfg.defaultModel || modelName;
            provider = createProvider('custom', modelName, cfg);
            agent.setProvider(provider);
            ui.info(`Connected · ${provider.name} · ${provider.modelId}`);
          },
        });
        agent.getUI().cueTTYAfterBulkOutput();
      } finally {
        endReplActiveWork();
      }
      continue;
    }

    const histExec = /^history(?:\s+(\d+))?\s*$/i.exec(input);
    if (histExec) {
      const cap = histExec[1] ? parseInt(histExec[1], 10) : NaN;
      await printReplHistory(Number.isFinite(cap) && cap > 0 ? cap : undefined);
      agent.getUI().cueTTYAfterBulkOutput();
      continue;
    }

    const directCommand = parseDirectCommand(input);
    if (directCommand) {
      activeWork = true;
      try {
        await executeDirectCommand(directCommand, agent, options.autoApprove || cfg.settings?.autoApprove || false, true);
      } finally {
        endReplActiveWork();
      }
      continue;
    }

    const offlineScan = detectOfflineProjectScanIntent(input);
    if (offlineScan) {
      activeWork = true;
      try {
        ui.startThinking('Offline project scan…');
        const result = await runOfflineProjectScanAndSave(PROJECT_ROOT, offlineScan);
        ui.stopSpinner();
        for (const line of result.shortLines) {
          ui.info(line);
        }
        agent.refreshSystemPrompt(await contextEngine.buildSystemPrompt());
        await saveToDisk();
      } catch (error: any) {
        ui.stopSpinner();
        ui.error(`Offline scan failed: ${error?.message || error}`);
      } finally {
        endReplActiveWork();
      }
      continue;
    }

    try {
      activeWork = true;
      if (isCodingTurn(input)) {
        const freshBrief = await buildCodingBrief(input);
        if (provider.name === 'offline') {
          savePendingCodingBrief(input, freshBrief);
          ui.info('This change needs a model. Project path and stack are saved. Use /connect, then ask again.');
          agent.getUI().cueTTYAfterBulkOutput();
        } else {
          const saved = consumePendingCodingBrief();
          const brief = saved ? `${saved.brief}\n\n${freshBrief}` : freshBrief;
          await agent.chat(wrapCodingBrief(brief, input));
        }
      } else if (provider.name === 'offline') {
        await runOfflineIntelligence(input, cfg);
        agent.getUI().cueTTYAfterBulkOutput();
      } else {
        const agentInput = shouldAttachProjectIntel(input)
          ? await buildAgentInputWithProjectIntel(input)
          : input;
        await agent.chat(agentInput);
      }
    } catch (error: any) {
      agent.getUI().error(`Fatal error: ${error.message}`);
    } finally {
      endReplActiveWork();
    }
  }
});

async function createInputSession(): Promise<{
  question(prompt: string): Promise<string>;
  save(line: string): Promise<void>;
  clearPrompt?: () => void;
  close(): void;
}> {
  const historyPath = REPL_HISTORY_PATH;
  await fs.ensureDir(nodePath.dirname(historyPath));
  const history = await fs.readFile(historyPath, 'utf-8')
    .then((s) => s.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
    .catch(() => [] as string[]);

  async function save(line: string): Promise<void> {
    const existing = await fs.readFile(historyPath, 'utf-8')
      .then((s) => s.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))
      .catch(() => [] as string[]);
    const next = [...existing.filter((item) => item !== line), line].slice(-500);
    await fs.writeFile(historyPath, `${next.join('\n')}\n`, 'utf-8');
    history.splice(0, history.length, ...next);
  }

  if (!stdin.isTTY || !stdout.isTTY) {
    const rl = readline.createInterface({
      input: stdin,
      output: stdout,
      terminal: true,
      historySize: 500,
      removeHistoryDuplicates: true,
    });

    // readline keeps the newest entry first internally.
    (rl as any).history = [...history].reverse();

    return {
      question: async (prompt: string) => {
        ttyResetBeforeReplPrompt();
        return rl.question(prompt);
      },
      save,
      close: () => rl.close(),
    };
  }

  let closed = false;
  let renderedRows = 0;

  function clearDropdown(rows: number): void {
    if (rows <= 0) return;
    stdout.write('\r\x1b[J');
  }

  function renderPrompt(prompt: string, buffer: string, cursor: number, suggestions: CommandSuggestion[], selectedIndex: number, selectionActive: boolean): number {
    const visible = suggestions.slice(0, 7);
    stdout.write('\r\x1b[0J\x1b[2K');
    stdout.write(`${prompt}${buffer}`);
    if (visible.length === 0) {
      stdout.write(`\x1b[${stripAnsi(prompt).length + cursor + 1}G`);
      return 0;
    }

    stdout.write('\n');
    /** Entire row (indent + command + reason) uses ANSI gray — works without truecolor; rgb was often ignored on Windows. */
    visible.forEach((item, index) => {
      const source = item.source === 'memory' ? 'memory' : item.reason;
      const fullLine = `  ${item.command}  (${source})`;
      if (selectionActive && index === selectedIndex) {
        stdout.write(`${chalk.inverse(fullLine)}\n`);
      } else {
        stdout.write(`${chalk.gray(fullLine)}\n`);
      }
    });
    stdout.write(`\x1b[${visible.length + 1}A`);
    stdout.write(`\x1b[${stripAnsi(prompt).length + cursor + 1}G`);
    return visible.length + 1;
  }

  return {
    question: (prompt: string) => new Promise<string>((resolve, reject) => {
      ttyResetBeforeReplPrompt();
      emitKeypressEvents(stdin);
      stdin.setRawMode(true);

      let buffer = '';
      let cursor = 0;
      let suggestions: CommandSuggestion[] = [];
      let selectedIndex = 0;
      let selectionActive = false;
      let acceptedSuggestionPrefix = '';
      let historyIndex = history.length;
      /** While true, hide intelligence rows so ↑/↓ behaves like shell history only. */
      let suppressSuggestionsForHistory = false;
      let refreshSeq = 0;

      const cleanup = () => {
        stdin.off('keypress', onKeypress);
        stdin.setRawMode(false);
      };

      const redraw = () => {
        clearDropdown(renderedRows);
        renderedRows = renderPrompt(prompt, buffer, cursor, suggestions, selectedIndex, selectionActive);
      };

      const markEdit = () => {
        if (acceptedSuggestionPrefix && cursor <= acceptedSuggestionPrefix.length) {
          acceptedSuggestionPrefix = '';
        }
      };

      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      const refreshSuggestions = () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }

        if (suppressSuggestionsForHistory) {
          suggestions = [];
          selectedIndex = 0;
          selectionActive = false;
          redraw();
          return;
        }

        if (acceptedSuggestionPrefix && buffer.startsWith(acceptedSuggestionPrefix)) {
          suggestions = [];
          selectedIndex = 0;
          selectionActive = false;
          redraw();
          return;
        }
        if (acceptedSuggestionPrefix && !buffer.startsWith(acceptedSuggestionPrefix)) {
          acceptedSuggestionPrefix = '';
        }
        if (buffer.trim().length < 3) {
          suggestions = [];
          selectedIndex = 0;
          selectionActive = false;
          redraw();
          return;
        }

        // Debounce: wait 30ms of idle time before computing suggestions
        // This prevents redundant scoring runs during rapid typing
        // but keeps responsiveness high (scoring itself is ~2ms)
        const seq = ++refreshSeq;
        const delay = suggestions.length === 0 ? 0 : 30; // instant first appearance
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          suggestCommands(buffer, process.cwd(), 7)
            .then((next) => {
              if (seq !== refreshSeq || closed) return;
              suggestions = next;
              selectedIndex = Math.min(selectedIndex, Math.max(0, suggestions.length - 1));
              selectionActive = false;
              redraw();
            })
            .catch(() => {
              if (seq !== refreshSeq || closed) return;
              suggestions = [];
              selectedIndex = 0;
              selectionActive = false;
              redraw();
            });
        }, delay);
      };

      const finish = (value: string) => {
        clearDropdown(renderedRows);
        stdout.write('\r\x1b[2K');
        stdout.write(`${prompt}${value}\n`);
        cleanup();
        resolve(value);
      };

      const cancelSuggestDebounce = () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        refreshSeq++;
      };

      /** ~/.yamx/history — hides suggestion rows while browsing. */
      const historyStepPrev = () => {
        if (history.length === 0) return;
        cancelSuggestDebounce();
        historyIndex = Math.max(0, historyIndex - 1);
        buffer = history[historyIndex] ?? buffer;
        cursor = buffer.length;
        acceptedSuggestionPrefix = '';
        suggestions = [];
        selectedIndex = 0;
        selectionActive = false;
        suppressSuggestionsForHistory = true;
        redraw();
      };

      const historyStepNext = () => {
        if (history.length === 0) return;
        cancelSuggestDebounce();
        historyIndex = Math.min(history.length, historyIndex + 1);
        buffer = historyIndex >= history.length ? '' : (history[historyIndex] ?? '');
        cursor = buffer.length;
        acceptedSuggestionPrefix = '';
        suggestions = [];
        selectedIndex = 0;
        selectionActive = false;
        if (buffer.trim().length < 3) {
          suppressSuggestionsForHistory = false;
          refreshSuggestions();
        } else {
          suppressSuggestionsForHistory = true;
          redraw();
        }
      };

      const onKeypress = (str: string, key: any) => {
        if (key?.ctrl && key?.name === 'c') {
          cleanup();
          reject(new Error('interrupted'));
          return;
        }
        if (key?.name === 'return' || key?.name === 'enter') {
          if (selectionActive && suggestions[selectedIndex]) {
            buffer = suggestions[selectedIndex].command;
            cursor = buffer.length;
            acceptedSuggestionPrefix = buffer;
            suggestions = [];
            selectedIndex = 0;
            selectionActive = false;
            redraw();
            return;
          }
          finish(buffer);
          return;
        }
        if (key?.name === 'backspace') {
          if (cursor <= 0) return;
          suppressSuggestionsForHistory = false;
          markEdit();
          buffer = buffer.slice(0, cursor - 1) + buffer.slice(cursor);
          cursor--;
          selectionActive = false;
          historyIndex = history.length;
          refreshSuggestions();
          return;
        }
        if (key?.name === 'delete') {
          if (cursor >= buffer.length) return;
          suppressSuggestionsForHistory = false;
          markEdit();
          buffer = buffer.slice(0, cursor) + buffer.slice(cursor + 1);
          selectionActive = false;
          historyIndex = history.length;
          refreshSuggestions();
          return;
        }
        if (key?.name === 'tab') {
          if (suppressSuggestionsForHistory && buffer.trim().length >= 3) {
            suppressSuggestionsForHistory = false;
            refreshSuggestions();
            return;
          }
          if (suggestions[selectedIndex]) {
            buffer = suggestions[selectedIndex].command;
            cursor = buffer.length;
            acceptedSuggestionPrefix = buffer;
            suggestions = [];
            selectedIndex = 0;
            selectionActive = false;
            redraw();
          }
          return;
        }
        if (key?.ctrl && key?.name === 'n' && suggestions.length > 0) {
          suppressSuggestionsForHistory = false;
          selectedIndex = selectionActive ? (selectedIndex + 1) % suggestions.length : 0;
          selectionActive = true;
          redraw();
          return;
        }
        if (key?.ctrl && key?.name === 'p' && suggestions.length > 0) {
          suppressSuggestionsForHistory = false;
          selectedIndex = selectionActive
            ? (selectedIndex <= 0 ? suggestions.length - 1 : selectedIndex - 1)
            : 0;
          selectionActive = true;
          redraw();
          return;
        }

        if (key?.ctrl && key?.name === 'up') {
          historyStepPrev();
          return;
        }
        if (key?.ctrl && key?.name === 'down') {
          historyStepNext();
          return;
        }
        if (key?.name === 'up') {
          if (!suppressSuggestionsForHistory && suggestions.length > 0) {
            selectedIndex = selectionActive
              ? (selectedIndex <= 0 ? suggestions.length - 1 : selectedIndex - 1)
              : 0;
            selectionActive = true;
            redraw();
            return;
          }
          historyStepPrev();
          return;
        }
        if (key?.name === 'down') {
          if (!suppressSuggestionsForHistory && suggestions.length > 0) {
            selectedIndex = selectionActive ? (selectedIndex + 1) % suggestions.length : 0;
            selectionActive = true;
            redraw();
            return;
          }
          historyStepNext();
          return;
        }
        if (key?.name === 'left') {
          cursor = Math.max(0, cursor - 1);
          selectionActive = false;
          redraw();
          return;
        }
        if (key?.name === 'right') {
          cursor = Math.min(buffer.length, cursor + 1);
          selectionActive = false;
          redraw();
          return;
        }
        if (key?.name === 'home' || (key?.ctrl && key?.name === 'a')) {
          cursor = 0;
          selectionActive = false;
          redraw();
          return;
        }
        if (key?.name === 'end' || (key?.ctrl && key?.name === 'e')) {
          cursor = buffer.length;
          selectionActive = false;
          redraw();
          return;
        }
        if (key?.ctrl && key?.name === 'u') {
          buffer = buffer.slice(cursor);
          cursor = 0;
          acceptedSuggestionPrefix = '';
          selectionActive = false;
          suppressSuggestionsForHistory = false;
          historyIndex = history.length;
          refreshSuggestions();
          return;
        }
        if (key?.name === 'escape') {
          if (suggestions.length > 0 || selectionActive) {
            suggestions = [];
            selectedIndex = 0;
            selectionActive = false;
            suppressSuggestionsForHistory = false;
            refreshSeq++;
            if (debounceTimer) {
              clearTimeout(debounceTimer);
              debounceTimer = null;
            }
            redraw();
          }
          return;
        }
        if (typeof str === 'string' && str >= ' ' && !str.includes('\r') && !str.includes('\n')) {
          suppressSuggestionsForHistory = false;
          markEdit();
          buffer = buffer.slice(0, cursor) + str + buffer.slice(cursor);
          cursor += str.length;
          selectionActive = false;
          historyIndex = history.length;
          refreshSuggestions();
        }
      };

      stdin.on('keypress', onKeypress);
      redraw();
    }),
    save,
    close: () => {
      closed = true;
      clearDropdown(renderedRows);
      if (stdin.isTTY) stdin.setRawMode(false);
    },
    clearPrompt: () => {
      clearDropdown(renderedRows);
      stdout.write('\r\x1b[2K');
      renderedRows = 0;
    },
  };
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

async function executeDirectCommand(
  command: string,
  agent: Agent,
  autoApprove: boolean,
  diagnoseOnFailure = true
): Promise<void> {
  const ui = agent.getUI();
  const translated = translateCommand(command, currentTarget());
  const native = translated && translated.corrected.trim().toLowerCase() !== command.trim().toLowerCase()
    ? translated.corrected
    : command;
  if (native !== command) {
    ui.info(`${command.trim()} → ${native}`);
  }
  const args = { command: native };
  const isDangerous = runCommand.isDangerous?.(args) ?? false;
  if (isDangerous && !autoApprove) {
    ui.approvalNeeded('run_command', args, true);
    const approved = await ui.confirmAction('Do you want to proceed?', false);
    if (!approved) {
      ui.warn('Command denied.');
      ui.cueTTYAfterBulkOutput();
      return;
    }
  }

  ui.toolCall('run_command', args);
  const started = Date.now();
  setRunCommandAbortCheck(() => agent.isStopRequested());
  let result: string;
  try {
    result = await runCommand.execute(args);
  } finally {
    setRunCommandAbortCheck(null);
  }
  ui.toolResult('run_command', result, Date.now() - started);
  ui.cueTTYAfterBulkOutput();

  if (diagnoseOnFailure && isDirectShellFailure(result)) {
    const handled = await runSmartCommandCorrection(agent, native, result);
    if (handled) return;

    await askAgentToRecoverFromDirectShellFailure(agent, native, result);
  }
}

/** Run a corrected command through the same direct-shell execution path. */
async function runCorrectedDirectCommand(agent: Agent, correction: CommandCorrection): Promise<string> {
  const ui = agent.getUI();
  ui.toolCall('run_command', { command: correction.corrected });
  const fixStarted = Date.now();
  setRunCommandAbortCheck(() => agent.isStopRequested());
  let fixedResult: string;
  try {
    fixedResult = await runCommand.execute({ command: correction.corrected });
  } finally {
    setRunCommandAbortCheck(null);
  }
  ui.toolResult(
    "run_command",
    fixedResult,
    Date.now() - fixStarted
  );
  ui.cueTTYAfterBulkOutput();
  return fixedResult;
}

/**
 * Smart correction for a failed direct shell line:
 *  1. cross-platform translation (Windows <-> Linux/macOS native equivalents),
 *  2. first-word typo repair against executables actually on this machine,
 *  3. the offline command-intelligence database as a fuzzy fallback.
 * Confident, safe corrections are auto-executed when the failure clearly was
 * "command not found"; otherwise an interactive "Did you mean?" list is shown.
 * Returns true when a correction was attempted.
 */
async function runSmartCommandCorrection(agent: Agent, command: string, result: string): Promise<boolean> {
  const ui = agent.getUI();
  const corrections = (await getCommandCorrections(command, { output: result }).catch(() => []))
    .filter((item) => !item.dangerous && item.corrected.trim() !== command.trim());
  if (corrections.length === 0) return false;

  const best = corrections[0];
  if (isAutoExecutable(best, result)) {
    ui.info(`Auto-fix (${best.kind}, ${Math.round(best.confidence * 100)}%): ${best.corrected} — ${best.reason}`);
    const fixedResult = await runCorrectedDirectCommand(agent, best);
    if (isDirectShellUserCancelled(fixedResult)) return true;
    if (!isDirectShellFailure(fixedResult)) {
      ui.info("Auto-corrected command succeeded.");
      return true;
    }
    await askAgentToRecoverFromDirectShellFailure(agent, command, result, best.corrected, fixedResult);
    return true;
  }

  // Confidence too low, or the failure was not "command not found" — offer choices.
  if (!process.stdout.isTTY) return false;
  const missing = extractMissingCommandToken(result);
  ui.info(
    missing
      ? `YamX command intelligence: "${missing}" is not available here — did you mean:`
      : "YamX command intelligence — did you mean:"
  );
  corrections.slice(0, 4).forEach((item, index) => {
    ui.info(`  [${index + 1}] ${item.corrected}   (${item.kind}, ${Math.round(item.confidence * 100)}% — ${item.reason})`);
  });
  const { picked } = await inquirer.prompt<{ picked: CommandCorrection | null }>([
    {
      type: "list",
      name: "picked",
      message: "Run a correction?",
      choices: [
        ...corrections.slice(0, 4).map((item) => ({ name: item.corrected, value: item })),
        { name: "No — ask the agent to diagnose instead", value: null },
      ],
    },
  ]);
  if (!picked) return false;
  const fixedResult = await runCorrectedDirectCommand(agent, picked);
  if (isDirectShellUserCancelled(fixedResult)) return true;
  if (!isDirectShellFailure(fixedResult)) return true;
  await askAgentToRecoverFromDirectShellFailure(agent, command, result, picked.corrected, fixedResult);
  return true;
}

async function askAgentToRecoverFromDirectShellFailure(
  agent: Agent,
  command: string,
  result: string,
  offlineFixCommand?: string,
  offlineFixResult?: string
): Promise<void> {
  if (isDirectShellUserCancelled(result) || (offlineFixResult && isDirectShellUserCancelled(offlineFixResult))) {
    return;
  }
  const ui = agent.getUI();
  if (agent.getProviderName() === 'offline') {
    const failedOutput = offlineFixResult && isCommandNotFoundFailure(offlineFixResult) ? offlineFixResult : result;
    if (isCommandNotFoundFailure(failedOutput)) {
      const missing = extractMissingCommandToken(failedOutput) || command.trim().split(/\s+/)[0];
      ui.info(`${missing} is not installed.`);
    }
    return;
  }
  ui.neuralStatus('recover', offlineFixCommand
    ? 'offline correction also failed; asking agent to diagnose and continue'
    : 'direct shell command failed; asking agent to diagnose and continue');
    await agent.chat([
      '<yamx_direct_shell_failure>',
      `command=${command}`,
      `cwd=${process.cwd()}`,
      'The user ran this as a direct YamX shell command. It failed.',
      offlineFixCommand
        ? `YamX already tried the best offline command-intelligence correction: ${offlineFixCommand}`
        : 'YamX did not find a confident offline correction.',
      'Diagnose the failure from the output, then take the smallest useful next action inside YamX.',
      'Prefer project-local commands, package scripts, and existing local command intelligence. If the needed command is not present locally, propose or run the correct new command according to policy.',
      'If a fix is safe and local, apply it and rerun the narrow verification. If the next action is destructive, privileged, or network/install related, respect tool approval policy.',
      '',
      'Original output:',
      result.slice(0, 24_000),
      ...(offlineFixCommand && offlineFixResult
        ? [
            '',
            'Offline correction output:',
            offlineFixResult.slice(0, 24_000),
          ]
        : []),
      '</yamx_direct_shell_failure>',
    ].join('\n'));
}

async function resolveSessionRef(
  store: SessionStore,
  arg: string
): Promise<string | 'ambiguous' | null> {
  const t = arg.trim();
  if (!t) return null;
  const direct = await store.loadSession(t);
  if (direct) return direct.id;
  const list = await store.listSessions();
  const matches = list.filter((s) => s.id === t || s.id.startsWith(t));
  if (matches.length === 1) return matches[0].id;
  if (matches.length > 1) return 'ambiguous';
  return null;
}

// --- Onboard ---

async function configureRuntimeSettings(config: Config, firstRun: boolean): Promise<void> {
  const { tune } = await inquirer.prompt<{ tune: boolean }>([
    {
      type: 'confirm',
      name: 'tune',
      message: 'Configure runtime behavior now?',
      default: firstRun,
    },
  ]);
  if (!tune) return;

  const current = config.get().settings;
  const answers = await inquirer.prompt<{
    autoApprove: boolean;
    streamOut: boolean;
    modelCouncil: boolean;
    councilMode: 'adaptive' | 'always' | 'off';
    contextBudgetChars: string;
    contextKeepLastMessages: string;
    contextRolloverMode: 'off' | 'summary-next-session';
    maxToolResultChars: string;
    checkForUpdates: boolean;
  }>([
    {
      type: 'confirm',
      name: 'autoApprove',
      message: 'Auto-approve tool runs by default? (unsafe)',
      default: current.autoApprove,
    },
    {
      type: 'confirm',
      name: 'streamOut',
      message: 'Stream model output?',
      default: current.streamOutput,
    },
    {
      type: 'confirm',
      name: 'modelCouncil',
      message: 'Enable hidden model council before agent replies?',
      default: current.modelCouncil?.enabled === true,
    },
    {
      type: 'rawlist',
      name: 'councilMode',
      message: 'Model council token mode:',
      default: current.modelCouncil?.mode || 'adaptive',
      choices: [
        { name: 'adaptive (recommended: use council only for complex work)', value: 'adaptive' },
        { name: 'always (best planning, higher token cost)', value: 'always' },
        { name: 'off (lowest cost)', value: 'off' },
      ],
    },
    {
      type: 'input',
      name: 'contextBudgetChars',
      message: 'Context budget before auto-summarize (chars):',
      default: String(current.contextBudgetChars || 280_000),
      validate: (value: string) => {
        const n = Number(value);
        return (Number.isFinite(n) && n >= 10_000 && n <= 2_000_000) || 'Use a number between 10000 and 2000000';
      },
    },
    {
      type: 'input',
      name: 'contextKeepLastMessages',
      message: 'Keep newest messages when compacting:',
      default: String(current.contextKeepLastMessages || 16),
      validate: (value: string) => {
        const n = Number(value);
        return (Number.isFinite(n) && n >= 4 && n <= 40) || 'Use a number between 4 and 40';
      },
    },
    {
      type: 'rawlist',
      name: 'contextRolloverMode',
      message: 'Low-memory rollover mode:',
      default: current.contextRolloverMode || 'off',
      choices: [
        { name: 'off (default)', value: 'off' },
        { name: 'summary-next-session (aggressive RAM saver)', value: 'summary-next-session' },
      ],
    },
    {
      type: 'input',
      name: 'maxToolResultChars',
      message: 'Max tool-result chars kept in model history:',
      default: String(current.maxToolResultChars || 24_000),
      validate: (value: string) => {
        const n = Number(value);
        return (Number.isFinite(n) && n >= 4000 && n <= 100000) || 'Use a number between 4000 and 100000';
      },
    },
    {
      type: 'confirm',
      name: 'checkForUpdates',
      message:
        'Prompt to upgrade when a newer YamX is on npm? (checks at most once per 24h; uses npm install -g if you agree)',
      default: current.checkForUpdates === true,
    },
  ]);

  config.set('settings.autoApprove', answers.autoApprove);
  config.set('settings.streamOutput', answers.streamOut);
  config.set('settings.modelCouncil.enabled', answers.modelCouncil);
  config.set('settings.modelCouncil.mode', answers.councilMode);
  config.set('settings.contextBudgetChars', Number(answers.contextBudgetChars));
  config.set('settings.contextKeepLastMessages', Number(answers.contextKeepLastMessages));
  config.set('settings.contextRolloverMode', answers.contextRolloverMode);
  config.set('settings.maxToolResultChars', Number(answers.maxToolResultChars));
  config.set('settings.checkForUpdates', answers.checkForUpdates);
}

function parseHeaderList(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(/[\n,]/)) {
    const row = part.trim();
    if (!row) continue;
    const idx = row.indexOf(':');
    if (idx <= 0) continue;
    const name = row.slice(0, idx).trim();
    const value = row.slice(idx + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}

/** Ask for base URL, API key, and any model name. Returns the model id. */
async function promptCustomModel(config: Config): Promise<string> {
  const current = config.get().providers.custom;
  const answers = await inquirer.prompt<{
    baseUrl: string;
    apiKey: string;
    model: string;
    headers: string;
  }>([
    {
      type: 'input',
      name: 'baseUrl',
      message: 'Base URL',
      default: current?.baseUrl || 'https://api.example.com/v1',
      validate: (value: string) =>
        normalizeChatBaseUrl(value) ? true : 'Use an http(s) URL such as https://api.example.com/v1',
    },
    {
      type: 'password',
      name: 'apiKey',
      message: current?.apiKey
        ? 'API key (leave blank to keep the saved key)'
        : 'API key (optional for a local server)',
      mask: '*',
    },
    {
      type: 'input',
      name: 'model',
      message: 'Model name',
      default: current?.model || config.get().defaultModel || '',
      validate: (value: string) => value.trim().length > 0 || 'Model name is required',
    },
    {
      type: 'input',
      name: 'headers',
      message: 'Extra headers (Name: value, comma-separated, blank keeps saved headers)',
      default: '',
    },
  ]);

  const baseUrl = normalizeChatBaseUrl(answers.baseUrl)!;
  const model = answers.model.trim();
  const incomingKey = answers.apiKey.trim();
  const apiKey = incomingKey || current?.apiKey;
  const typedHeaders = answers.headers.trim();
  const extraHeaders = typedHeaders ? parseHeaderList(typedHeaders) : current?.extraHeaders;
  config.set('providers.custom', {
    baseUrl,
    model,
    ...(apiKey ? { apiKey } : {}),
    ...(extraHeaders && Object.keys(extraHeaders).length ? { extraHeaders } : {}),
  });
  return model;
}

async function runOnboard(config: Config, options: { title?: string; firstRun?: boolean; exitOnCancel?: boolean } = {}): Promise<boolean> {
  await config.load();

  const title = options.title || 'Model settings';
  const firstRun = options.firstRun ?? false;
  console.log(chalk.hex('#D97757').bold(`\n  ${title}\n`));
  console.log(chalk.dim('  Any OpenAI-compatible model. Set the base URL, API key, and model name.\n'));

  const savedCustom = config.get().providers.custom?.baseUrl;
  const savedModel = config.get().providers.custom?.model;
  const choices: Array<{ name: string; value: string }> = [
    { name: 'Set base URL, API key, and model', value: 'edit' },
  ];
  if (savedCustom) {
    choices.push({
      name: `Keep saved model (${savedModel || 'model'} · ${savedCustom})`,
      value: 'saved',
    });
  }
  choices.push({ name: 'Cancel', value: 'cancel' });

  const { mode } = await inquirer.prompt<{ mode: string }>([
    {
      type: 'rawlist',
      name: 'mode',
      message: 'Model settings',
      choices,
    },
  ]);

  if (mode === 'cancel') {
    if (options.exitOnCancel) {
      console.log(chalk.dim('\n  Goodbye.\n'));
      process.exit(0);
    }
    console.log(chalk.dim('\n  Kept the current model.\n'));
    return false;
  }

  let model: string;
  if (mode === 'edit') {
    model = await promptCustomModel(config);
  } else {
    model = config.get().providers.custom?.model || config.get().defaultModel || '';
    if (!model) {
      const { customModel } = await inquirer.prompt<{ customModel: string }>([
        {
          type: 'input',
          name: 'customModel',
          message: 'Model name:',
          validate: (value: string) => value.trim().length > 0 || 'Model name is required',
        },
      ]);
      model = customModel.trim();
    }
  }

  await configureRuntimeSettings(config, firstRun);

  config.set('defaultProvider', 'custom');
  config.set('defaultModel', model);
  config.set('providers.custom.model', model);
  await config.save();

  console.log(chalk.hex('#8FBC8F')('\n  Configuration saved to ~/.yamx/config.json'));
  console.log(chalk.dim(`  Base URL: ${config.get().providers.custom?.baseUrl || savedCustom || ''}`));
  console.log(chalk.dim(`  Model: ${model}`));
  console.log(chalk.dim(`  Tools: ${getToolCount()} · Streaming: ${config.get().settings.streamOutput}`));
  console.log(chalk.dim('\n  Run `yamx` to start.\n'));
  return true;
}

// --- Diagnose ---

async function runDiagnose(config: Config, cfg: any) {
  console.log(chalk.bold('\n  YamX Diagnostic Report\n'));

  // Node version
  console.log(`  ${chalk.cyan('Node.js')}    ${process.version}`);
  console.log(`  ${chalk.cyan('Platform')}   ${process.platform} ${process.arch}`);
  console.log(`  ${chalk.cyan('YamX')}       v${VERSION}`);
  console.log(`  ${chalk.cyan('Tools')}      ${getToolCount()}`);
  console.log();

  // Config file
  const fs = await import('fs-extra');
  const path = await import('path');
  const os = await import('os');
  const configPath = path.default.join(os.default.homedir(), '.yamx', 'config.json');
  const configExists = await fs.default.pathExists(configPath);
  console.log(`  ${configExists ? TERM.ok : TERM.bad} Config file ${configExists ? 'exists' : 'missing'}: ${configPath}`);

  const customUrl = String(cfg.providers?.custom?.baseUrl || '').trim();
  const customModel = String(cfg.providers?.custom?.model || cfg.defaultModel || '').trim();
  console.log(
    `  ${customUrl ? TERM.ok : TERM.idle} model        ${customUrl ? `${customUrl}${customModel ? ' · ' + customModel : ''}` : chalk.dim('not configured — set one with yamx --onboard')}`
  );

  // Git
  try {
    const gitVer = execSync('git --version', { encoding: 'utf-8' }).trim();
    console.log(`  ${TERM.ok} git          ${gitVer}`);
  } catch {
    console.log(`  ${TERM.bad} git          not found`);
  }

  // Sessions
  const sessDir = path.default.join(os.default.homedir(), '.yamx', 'sessions');
  const sessionFiles = await fs.default.readdir(sessDir).catch(() => []);
  console.log(`  ${chalk.cyan('Sessions')}   ${sessionFiles.length} saved`);

  console.log(chalk.dim('\n  Model: ') + chalk.white(customModel || chalk.dim('none')));
  console.log();
}

program.parse();
