import chalk from 'chalk';
import { execSync } from 'child_process';
import { Agent } from '../agent.js';
import { MemoryManager } from '../memory.js';
import { Provider } from '../providers/base.js';
import { SessionStore, type ChatSession } from '../session-store.js';
import { SkillManager } from '../skills.js';
import { BuiltinSubagent, SubagentRunner } from '../subagents.js';
import { printReplHistory } from '../repl-history.js';
import { getToolsByCategory } from '../tools/registry.js';
import { logInspect } from '../tools/logs.js';
import { changeWorkspaceDirectory, getWorkspaceRelativeCwd, PROJECT_ROOT } from '../tools/utils.js';
import { UI } from '../ui.js';
import { ContextEngine } from '../context.js';
import { parseScanDepthFromArgs, runOfflineProjectScanAndSave } from '../offline-project-scan.js';
import { getCommandCorrections, translateCommand, currentTarget } from '../command-corrections.js';

export type PersistCtx = { store: SessionStore; session: ChatSession; agent: Agent };

export async function handleCommand(
  input: string,
  agent: Agent,
  provider: Provider,
  persistCtx: PersistCtx | undefined,
  cfg: any,
  runShellCommand: (command: string, agent: Agent, autoApprove: boolean, diagnoseOnFailure?: boolean) => Promise<void>,
  extras?: { onConnect?: () => Promise<void> }
): Promise<void> {
  const ui = agent.getUI();
  const cmd = input.split(' ')[0].toLowerCase();

  const save = async () => {
    if (!persistCtx) return;
    persistCtx.session.messages = agent.getHistory();
    persistCtx.store.updateTitleFromFirstMessage(persistCtx.session);
    await persistCtx.store.saveSession(persistCtx.session);
  };

  switch (cmd) {
    case '/help':
      ui.help();
      break;
    case '/exit':
    case '/quit':
      await save();
      console.log(chalk.dim('\nGoodbye.'));
      process.exit(0);
    case '/clear':
      agent.clearHistory();
      break;
    case '/history': {
      const rest = input.replace(/^\s*\/history\b/i, '').trim();
      const n = rest ? parseInt(rest, 10) : NaN;
      await printReplHistory(Number.isFinite(n) && n > 0 ? n : undefined);
      break;
    }
    case '/compact':
      await agent.compact();
      break;
    case '/stop':
    case '/cancel':
      if (agent.isStopRequested()) {
        ui.warn('A stop request is already pending.');
        ui.replForceExitHint();
      } else {
        agent.requestStop();
      }
      break;
    case '/undo':
      await agent.undo();
      break;
    case '/run': {
      const command = input.slice('/run'.length).trim();
      if (!command) {
        ui.warn('Usage: /run <command>');
        break;
      }
      await runShellCommand(command, agent, cfg?.settings?.autoApprove || false, true);
      break;
    }
    case '/pwd':
      ui.info(`cwd: ${getWorkspaceRelativeCwd()}`);
      break;
    case '/fix': {
      const line = input.replace(/^\s*\/fix\b/i, '').trim();
      if (!line) {
        ui.info('Usage: /fix <command> — preview how YamX would correct a wrong command (dry run).');
        break;
      }
      const fixes = await getCommandCorrections(line).catch(() => []);
      if (fixes.length === 0) {
        ui.info(`No local correction found for: ${line}`);
        break;
      }
      ui.info(`Corrections for: ${line}`);
      fixes.slice(0, 5).forEach((fix, index) => {
        ui.info(`  [${index + 1}] ${fix.corrected}   (${fix.kind}, ${Math.round(fix.confidence * 100)}% — ${fix.reason}${fix.dangerous ? '; flagged dangerous — will not auto-run' : ''})`);
      });
      break;
    }
    case '/translate': {
      const line = input.replace(/^\s*\/translate\b/i, '').trim();
      if (!line) {
        ui.info(`Usage: /translate <command> — translate a command to this platform's native equivalent (${currentTarget()}).`);
        break;
      }
      const result = translateCommand(line, currentTarget());
      if (!result) {
        ui.info(`No translation needed/available for: ${line} (target: ${currentTarget()})`);
        break;
      }
      ui.info(`On ${result.target}: ${result.corrected}   (${Math.round(result.confidence * 100)}% — ${result.reason})`);
      break;
    }
    case '/scan': {
      const rest = input.replace(/^\s*\/scan\b/i, '').trim();
      const depth = parseScanDepthFromArgs(rest);
      ui.startThinking('Offline project scan…');
      try {
        const result = await runOfflineProjectScanAndSave(PROJECT_ROOT, {
          depth,
          goalNote: rest ? `/scan ${rest}` : '/scan',
        });
        ui.stopSpinner();
        for (const line of result.shortLines) ui.info(line);
        agent.refreshSystemPrompt(await new ContextEngine(PROJECT_ROOT).buildSystemPrompt());
        await save();
      } catch (e: any) {
        ui.stopSpinner();
        ui.error(`Offline scan failed: ${e?.message || e}`);
      }
      break;
    }
    case '/cd': {
      const target = input.slice('/cd'.length).trim();
      const rel = changeWorkspaceDirectory(target);
      if (rel.startsWith('Error:')) ui.warn(rel);
      else ui.info(`cwd: ${rel}`);
      break;
    }
    case '/init': {
      const memory = new MemoryManager();
      const created = await memory.initProjectMemory();
      if (created.length === 0) {
        ui.info('YamX memory files already exist.');
      } else {
        ui.success(`Initialized YamX memory:\n${created.map((p) => `  ${p}`).join('\n')}`);
      }
      break;
    }
    case '/memory':
      console.log(await new MemoryManager().describeMemoryFiles());
      break;
    case '/remember': {
      const rest = input.slice('/remember'.length).trim();
      if (!rest) {
        ui.warn('Usage: /remember <note> or /remember user:<note>');
        break;
      }
      const scope = rest.toLowerCase().startsWith('user:') ? 'user' : 'project';
      const text = scope === 'user' ? rest.slice('user:'.length).trim() : rest;
      const file = await new MemoryManager().remember(text, scope);
      ui.success(`Remembered in ${file}`);
      break;
    }
    case '/model':
      ui.info(`Provider: ${provider.name} | Model: ${provider.modelId}`);
      break;
    case '/connect':
      if (!extras?.onConnect) {
        ui.info('Run yamx --onboard to connect a model.');
        break;
      }
      await extras.onConnect();
      break;
    case '/cost': {
      const stats = agent.getUsageStats();
      ui.info(`Session tokens: up ${stats.totalInputTokens.toLocaleString()} down ${stats.totalOutputTokens.toLocaleString()}`);
      ui.info(`History: ${stats.historyLength} messages; ${(stats.historyChars / 1000).toFixed(0)}k chars`);
      break;
    }
    case '/diff':
      try {
        const diff = execSync('git diff', { encoding: 'utf-8', cwd: process.cwd() });
        console.log(diff || chalk.dim('  (no changes)'));
      } catch {
        ui.warn('Not a git repository or git not available.');
      }
      break;
    case '/status':
      await showStatus(agent, provider, persistCtx, ui);
      break;
    case '/logs':
    case '/log':
      await inspectLogCommand(input, cmd, ui);
      break;
    case '/tools':
      ui.toolsList(getToolsByCategory());
      break;
    case '/skills':
      console.log(await new SkillManager().describe());
      break;
    case '/agents':
      console.log(await new SubagentRunner(provider).describe());
      break;
    case '/agent':
      await runNamedSubagent(input, provider, ui, cfg);
      break;
    case '/explore':
    case '/plan':
    case '/review':
      await runBuiltinSubagent(cmd, input, provider, ui, cfg);
      break;
    default:
      ui.warn(`Unknown command: ${cmd}. Type /help for available commands.`);
  }
}

async function showStatus(agent: Agent, provider: Provider, persistCtx: PersistCtx | undefined, ui: UI): Promise<void> {
  const stats = agent.getUsageStats();
  const session = persistCtx?.session;
  ui.neuralStatus('status', 'runtime snapshot');
  console.log([
    `Provider: ${provider.name}`,
    `Model: ${provider.modelId}`,
    `cwd: ${getWorkspaceRelativeCwd()}`,
    `Session: ${session ? `${session.title} (${session.id.slice(0, 8)}...)` : 'not persisted'}`,
    `Messages: ${stats.historyLength}`,
    `History: ${(stats.historyChars / 1000).toFixed(0)}k chars`,
    `Tokens: ↑${stats.totalInputTokens.toLocaleString()} ↓${stats.totalOutputTokens.toLocaleString()}`,
  ].map((line) => `  ${chalk.dim(line)}`).join('\n'));
}

async function inspectLogCommand(input: string, cmd: string, ui: UI): Promise<void> {
  const rest = input.slice(cmd.length).trim();
  const { path, mode, lines, pattern } = parseLogArgs(rest);
  ui.neuralStatus('logs', path ? `inspecting ${path}` : 'discovering log files');
  const result = await logInspect.execute({ path, mode, lines, pattern });
  console.log('\n' + ui.renderMarkdown(`\`\`\`text\n${result}\n\`\`\``, { bypassCap: true }));
}

function parseLogArgs(input: string): {
  path?: string;
  mode?: 'tail' | 'head' | 'full' | 'errors' | 'summary' | 'latest-error';
  lines?: number;
  pattern?: string;
} {
  const tokens = input.match(/"[^"]+"|'[^']+'|\S+/g)?.map((token) => token.replace(/^["']|["']$/g, '')) || [];
  const out: ReturnType<typeof parseLogArgs> = {};
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '--mode' || token === '-m') {
      out.mode = tokens[++i] as any;
    } else if (token === '--lines' || token === '-n') {
      out.lines = Number(tokens[++i]);
    } else if (token === '--pattern' || token === '-p') {
      out.pattern = tokens[++i];
    } else if (!out.path) {
      out.path = token;
    }
  }
  return out;
}

async function runNamedSubagent(input: string, provider: Provider, ui: UI, cfg: any): Promise<void> {
  if (cfg?.settings?.subagents?.enabled === false) {
    ui.warn('Subagents are disabled in config.');
    return;
  }
  const rest = input.slice('/agent'.length).trim();
  const [name, ...taskParts] = rest.split(/\s+/);
  if (!name) {
    ui.warn('Usage: /agent <name> <task>');
    return;
  }
  await runSubagent(name, taskParts.join(' '), provider, ui);
}

async function runBuiltinSubagent(cmd: string, input: string, provider: Provider, ui: UI, cfg: any): Promise<void> {
  if (cfg?.settings?.subagents?.enabled === false) {
    ui.warn('Subagents are disabled in config.');
    return;
  }
  const name = cmd === '/explore' ? 'explorer' : cmd === '/plan' ? 'planner' : 'reviewer';
  const task = input.slice(cmd.length).trim();
  await runSubagent(name as BuiltinSubagent, task, provider, ui);
}

async function runSubagent(name: string, task: string, provider: Provider, ui: UI): Promise<void> {
  ui.startThinking(`Running ${name} subagent...`);
  try {
    const result = await new SubagentRunner(provider).run(name, task, { ui });
    ui.stopSpinner();
    console.log('\n' + ui.renderMarkdown(result, { bypassCap: true }));
  } catch (error: any) {
    ui.stopSpinner();
    ui.error(`Subagent failed: ${error.message}`);
  }
}
