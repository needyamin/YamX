import { execSync } from 'node:child_process';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import fg from 'fast-glob';
import { ContextEngine } from './context.js';
import { Provider, Message, ToolCall } from './providers/base.js';
import { getTool, getToolDefinitions } from './tools/registry.js';
import { evaluateToolCall, PermissionMode } from './policy.js';
import { HookManager } from './hooks.js';
import { setRunCommandAbortCheck } from './shell-abort-context.js';
import { UI } from './ui.js';
import {
  CrewTask,
  commandRepeatKey,
  fileEditChanged,
  FILE_EDIT_TOOLS,
  scheduleCrewTasks,
} from './crew-scheduler.js';

export type BuiltinSubagent = 'explorer' | 'planner' | 'reviewer' | 'implementer' | 'debugger';

export interface CrewRuntime {
  provider: Provider;
  ui: UI;
  permissionMode?: PermissionMode;
  autoApprove?: boolean;
  allowedShellCommands?: string[];
  deniedShellPatterns?: string[];
  nonInteractiveApprovals?: 'deny' | 'allow';
  projectBrief?: string;
  maxIterations: number;
  maxParallel: number;
  enabled: boolean;
  hooksEnabled?: boolean;
  stopCheck?: () => boolean;
}

let crewRuntime: CrewRuntime | null = null;

export function setCrewRuntime(next: CrewRuntime | null): void {
  crewRuntime = next;
}

export function getCrewRuntime(): CrewRuntime | null {
  return crewRuntime;
}

interface SubagentSpec {
  name: string;
  title: string;
  prompt: string;
  maxTokens: number;
  role: string;
  path?: string;
}

const READ_TOOLS = [
  'read_file',
  'read_files',
  'list_files',
  'search_files',
  'grep_search',
  'directory_tree',
  'file_info',
  'project_intel',
  'find_references',
];

const ROLE_TOOLS: Record<string, string[]> = {
  explorer: READ_TOOLS,
  planner: READ_TOOLS,
  reviewer: [...READ_TOOLS, 'git_status', 'git_diff', 'git_log'],
  implementer: [...READ_TOOLS, 'edit_file', 'multi_edit', 'patch_file', 'write_file', 'write_files'],
  debugger: [...READ_TOOLS, 'edit_file', 'multi_edit', 'patch_file', 'write_file', 'run_command'],
};

const SPECS: Record<BuiltinSubagent, SubagentSpec> = {
  explorer: {
    name: 'explorer',
    title: 'Explorer',
    role: 'explorer',
    maxTokens: 4096,
    prompt: [
      'You are YamX Explorer, a read-only codebase analysis subagent.',
      'Answer with concrete file paths, symbols, and likely next inspection targets.',
      'Do not propose edits unless the user explicitly asks for implementation planning.',
      'Use tools to read the repo. Do not invent paths.',
    ].join('\n'),
  },
  planner: {
    name: 'planner',
    title: 'Planner',
    role: 'planner',
    maxTokens: 4096,
    prompt: [
      'You are YamX Planner, a read-only implementation planning subagent.',
      'Produce a practical ordered plan for the requested change.',
      'Include files to inspect or edit, verification commands, risks, and rollback notes.',
      'Do not write code. Do not claim implementation is complete.',
      'Read the files you name before you recommend them.',
    ].join('\n'),
  },
  reviewer: {
    name: 'reviewer',
    title: 'Reviewer',
    role: 'reviewer',
    maxTokens: 4096,
    prompt: [
      'You are YamX Reviewer, a strict code-review subagent.',
      'Prioritize bugs, regressions, security issues, missing tests, and risky behavior.',
      'Lead with findings ordered by severity. If no issues are found, say so clearly.',
      'Use git_diff, git_status, and read_file. Do not edit files.',
    ].join('\n'),
  },
  implementer: {
    name: 'implementer',
    title: 'Implementer',
    role: 'implementer',
    maxTokens: 4096,
    prompt: [
      'You are YamX Implementer. Make the smallest code change that satisfies the goal.',
      'Re-read a file before editing it. Use edit_file with exact old_text.',
      'Do not invent filenames, package managers, or test commands.',
      'The project brief tells you where to look. It is not a license to patch from memory.',
    ].join('\n'),
  },
  debugger: {
    name: 'debugger',
    title: 'Debugger',
    role: 'debugger',
    maxTokens: 4096,
    prompt: [
      'You are YamX Debugger. Reproduce the failure, apply the smallest fix, then rerun that same command.',
      'Re-read a file before editing it. Use the error output as the source of the next edit.',
      'Do not invent filenames or commands that are not in the brief or a tool result.',
      'After a file change, run the original failing command again before you stop.',
    ].join('\n'),
  },
};

export class SubagentRunner {
  constructor(private provider: Provider, private cwd = process.cwd()) {}

  async run(name: BuiltinSubagent | string, task: string, host?: Partial<CrewRuntime>): Promise<string> {
    const spec = await this.resolveSpec(name);
    if (!spec) {
      return `Unknown subagent: ${name}. Use /agents to list available subagents.`;
    }
    const owned = !getCrewRuntime();
    if (owned) {
      setCrewRuntime({
        provider: this.provider,
        ui: host?.ui || new UI(),
        permissionMode: host?.permissionMode,
        autoApprove: host?.autoApprove,
        allowedShellCommands: host?.allowedShellCommands,
        deniedShellPatterns: host?.deniedShellPatterns,
        nonInteractiveApprovals: host?.nonInteractiveApprovals,
        projectBrief: host?.projectBrief,
        maxIterations: host?.maxIterations ?? 12,
        maxParallel: host?.maxParallel ?? 3,
        enabled: host?.enabled !== false,
        hooksEnabled: host?.hooksEnabled,
        stopCheck: host?.stopCheck,
      });
    }
    try {
      return await runWorker({
        role: spec.role,
        goal: task || this.defaultTask(spec.name),
        paths: [],
      }, spec);
    } finally {
      if (owned) setCrewRuntime(null);
    }
  }

  async describe(): Promise<string> {
    const custom = await this.loadCustomAgents();
    return [...Object.values(SPECS), ...custom]
      .map((spec) => `${spec.name}\n  ${spec.prompt.split('\n')[0]}`)
      .join('\n\n');
  }

  async loadCustomAgents(): Promise<SubagentSpec[]> {
    const roots = [
      path.join(this.cwd, '.yamx', 'agents'),
      path.join(os.homedir(), '.yamx', 'agents'),
    ];

    const agents: SubagentSpec[] = [];
    for (const root of roots) {
      const files = await fg('*.md', {
        cwd: root,
        absolute: true,
        onlyFiles: true,
        suppressErrors: true,
      });
      for (const file of files.sort()) {
        const spec = await this.readAgent(file);
        if (spec) agents.push(spec);
      }
    }

    const byName = new Map<string, SubagentSpec>();
    for (const agent of agents) byName.set(agent.name, agent);
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private async resolveSpec(name: string): Promise<SubagentSpec | null> {
    if (name in SPECS) return SPECS[name as BuiltinSubagent];
    const custom = await this.loadCustomAgents();
    return custom.find((agent) => agent.name === name) || null;
  }

  private async readAgent(file: string): Promise<SubagentSpec | null> {
    try {
      const raw = await fs.readFile(file, 'utf-8');
      const frontmatter = this.parseFrontmatter(raw);
      const body = raw.startsWith('---') ? raw.slice(raw.indexOf('\n---', 3) + 4).trim() : raw.trim();
      const name = String(frontmatter.name || path.basename(file, '.md')).trim();
      if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) return null;
      const requested = String(frontmatter.role || 'explorer').trim().toLowerCase();
      const role = requested in ROLE_TOOLS ? requested : 'explorer';
      return {
        name,
        title: String(frontmatter.title || name),
        prompt: body || String(frontmatter.prompt || 'You are a focused YamX subagent.'),
        maxTokens: Number(frontmatter.maxTokens || frontmatter.max_tokens || 4096),
        role,
        path: file,
      };
    } catch {
      return null;
    }
  }

  private parseFrontmatter(raw: string): Record<string, string> {
    if (!raw.startsWith('---')) return {};
    const end = raw.indexOf('\n---', 3);
    if (end === -1) return {};
    const body = raw.slice(3, end).trim();
    const out: Record<string, string> = {};
    for (const line of body.split(/\r?\n/)) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    }
    return out;
  }

  private defaultTask(name: string): string {
    switch (name) {
      case 'explorer':
        return 'Explore this project and summarize the most important architecture and entry points.';
      case 'planner':
        return 'Create an implementation plan for the current user goal.';
      case 'reviewer':
        return 'Review current uncommitted changes.';
      case 'implementer':
        return 'Implement the requested change with the smallest edit.';
      case 'debugger':
        return 'Reproduce the failure, fix it, and rerun the failing command.';
      default:
        return 'Complete the requested subagent task.';
    }
  }
}

export async function runDelegatedTasks(args: { tasks?: CrewTask[] }): Promise<string> {
  const runtime = getCrewRuntime();
  if (!runtime) return 'Error: delegate is only available during an agent turn.';
  if (!runtime.enabled) return 'Subagents are disabled in config.';
  const tasks = Array.isArray(args?.tasks) ? args.tasks.filter((task) => task && task.role && task.goal) : [];
  if (tasks.length === 0) return 'Error: delegate requires tasks with role and goal.';
  const reports = await scheduleCrewTasks(tasks, runtime.maxParallel, (task) => runWorker(task));
  return reports.join('\n\n---\n\n');
}

async function runWorker(task: CrewTask, specOverride?: SubagentSpec): Promise<string> {
  const runtime = getCrewRuntime();
  if (!runtime) return 'Error: no crew runtime.';
  const role = (task.role || 'explorer').toLowerCase();
  const spec = specOverride || SPECS[role as BuiltinSubagent] || {
    ...SPECS.explorer,
    role: role in ROLE_TOOLS ? role : 'explorer',
    name: role,
    title: role,
  };
  const toolNames = new Set(ROLE_TOOLS[spec.role] || ROLE_TOOLS.explorer);
  const tools = getToolDefinitions().filter((tool) => toolNames.has(tool.name));
  const filesChanged: string[] = [];
  const commands: string[] = [];
  let firstError = '';
  let verify: 'passed' | 'failed' | 'not-run' = 'not-run';
  let editGeneration = 0;
  let commandAfterEdit = false;
  const counts = new Map<string, number>();
  const ui = runtime.ui;
  ui.crewStart(spec.role, task.goal);
  ui.pushCrew();

  const brief = runtime.projectBrief?.trim();
  const history: Message[] = [
    {
      role: 'system',
      content: [
        spec.prompt,
        '',
        'Treat the project brief as the source of paths and stack.',
        'Do not invent filenames, package managers, or test commands that are not in the brief or a tool result.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        brief ? `Project brief:\n${brief}` : 'No project brief was attached. Read files before you name paths.',
        `Role: ${spec.role}`,
        `Goal: ${task.goal}`,
        task.paths?.length ? `Paths: ${task.paths.join(', ')}` : '',
        role === 'reviewer' ? thisGitDiff(runtime) : '',
      ].filter(Boolean).join('\n'),
    },
  ];

  let summary = '';
  try {
    if (runtime.provider.name === 'offline') {
      summary = 'A model is required for this subagent. Use /connect.';
      firstError = firstError || 'offline';
    } else {
      const hooks = runtime.hooksEnabled === false ? null : new HookManager();
      for (let iteration = 0; iteration < runtime.maxIterations; iteration++) {
        if (runtime.stopCheck?.()) break;
        const result = await runtime.provider.complete({
          messages: history,
          tools,
          maxTokens: spec.maxTokens,
          temperature: 0.1,
        });
        history.push({
          role: 'assistant',
          content: result.content,
          tool_calls: result.tool_calls,
        });
        if (result.content?.trim()) summary = result.content.trim();
        if (!result.tool_calls?.length) break;
        for (const call of result.tool_calls) {
          if (runtime.stopCheck?.()) break;
          const outcome = await executeChildTool(call, runtime, toolNames, counts, editGeneration, hooks);
          if (outcome.editApplied) {
            editGeneration += 1;
            commandAfterEdit = false;
            const edited = outcome.path;
            if (edited && !filesChanged.includes(edited)) filesChanged.push(edited);
          }
          if (outcome.command) {
            commands.push(outcome.command);
            if (editGeneration > 0) {
              commandAfterEdit = true;
              verify = outcome.failed ? 'failed' : 'passed';
            }
          }
          if (outcome.failed && !firstError) firstError = outcome.errorLine || 'tool failed';
          history.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.function.name,
            content: outcome.content,
          });
        }
      }
    }
  } catch (error: any) {
    firstError = firstError || String(error?.message || error);
    summary = summary || firstError;
  } finally {
    ui.popCrew();
  }

  if (spec.role === 'debugger' && editGeneration > 0 && !commandAfterEdit) {
    verify = 'not-run';
    if (!firstError) firstError = 'edited files without rerunning the failing command';
  }

  return [
    `role: ${spec.role}`,
    `goal: ${task.goal}`,
    `files_changed: ${filesChanged.join(', ') || 'none'}`,
    `commands: ${commands.join(' | ') || 'none'}`,
    `first_error: ${clip(firstError) || 'none'}`,
    `verify: ${verify}`,
    `summary: ${clip(summary) || 'no summary'}`,
  ].join('\n');
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 500 ? `${flat.slice(0, 499)}…` : flat;
}

function thisGitDiff(runtime: CrewRuntime): string {
  try {
    const cwd = process.cwd();
    const status = execSync('git status --short', { cwd, encoding: 'utf-8', timeout: 8000 }).trim();
    const diff = execSync('git diff --stat', { cwd, encoding: 'utf-8', timeout: 8000 }).trim();
    return `Git status:\n${status || '(clean)'}\n\nGit diff stat:\n${diff || '(no diff)'}`;
  } catch (error: any) {
    void runtime;
    return `Could not read git diff: ${error.message}`;
  }
}

interface ChildToolOutcome {
  content: string;
  failed: boolean;
  errorLine: string;
  editApplied: boolean;
  path?: string;
  command?: string;
}

async function executeChildTool(
  call: ToolCall,
  runtime: CrewRuntime,
  allowed: Set<string>,
  counts: Map<string, number>,
  editGeneration: number,
  hooks: HookManager | null,
): Promise<ChildToolOutcome> {
  const name = call.function.name;
  const fail = (content: string): ChildToolOutcome => ({
    content,
    failed: true,
    errorLine: clip(content),
    editApplied: false,
  });
  if (!allowed.has(name)) return fail(`Error: ${name} is not available to this role.`);
  const tool = getTool(name);
  if (!tool) return fail(`Error: Unknown tool ${name}.`);

  let args: any = {};
  try {
    args = JSON.parse(call.function.arguments || '{}');
  } catch {
    args = {};
  }

  const key = commandRepeatKey(name, args, editGeneration);
  const seen = (counts.get(key) || 0) + 1;
  counts.set(key, seen);
  const limit = name === 'run_command' ? 1 : 3;
  if (seen > limit) {
    return fail(`Skipped repeated ${name}. Change the command or edit a file before retrying.`);
  }

  const policy = evaluateToolCall(name, args, {
    permissionMode: runtime.permissionMode,
    autoApprove: runtime.autoApprove,
    allowedShellCommands: runtime.allowedShellCommands,
    deniedShellPatterns: runtime.deniedShellPatterns,
  });
  if (policy.blocked) return fail(`Policy blocked ${name}: ${policy.reason}`);

  if (hooks) {
    const hook = await hooks.run('PreToolUse', { tool_name: name, tool_args: args }, name);
    if (hook.blocked) return fail(`PreToolUse hook blocked ${name}: ${hook.errors.join('\n') || hook.output}`);
  }

  if (tool.needsApproval && policy.needsApproval && runtime.nonInteractiveApprovals !== 'allow') {
    if (runtime.nonInteractiveApprovals === 'deny') {
      return fail(`Action requires approval and was blocked: ${policy.reason}`);
    }
    const dangerous = policy.risk === 'destructive' || (tool.isDangerous?.(args) ?? false);
    runtime.ui.approvalNeeded(name, args, dangerous);
    const approved = await runtime.ui.confirmAction('Do you want to proceed?', !dangerous);
    if (!approved) return fail('Action was DENIED by the user.');
  }

  runtime.ui.toolCall(name, args);
  const started = Date.now();
  if (name === 'run_command') setRunCommandAbortCheck(() => runtime.stopCheck?.() === true);
  try {
    const result = await tool.execute(args);
    runtime.ui.toolResult(name, result, Date.now() - started);
    const failed = /^error:/i.test(result.trim()) || /exit code [^0]/i.test(result);
    const editApplied = FILE_EDIT_TOOLS.has(name) && fileEditChanged(result);
    return {
      content: result,
      failed,
      errorLine: failed ? clip(result) : '',
      editApplied,
      path: typeof args.path === 'string' ? args.path : undefined,
      command: name === 'run_command' && typeof args.command === 'string' ? args.command : undefined,
    };
  } catch (error: any) {
    const message = `Error executing ${name}: ${error?.message || error}`;
    runtime.ui.toolResult(name, message, Date.now() - started);
    return fail(message);
  } finally {
    if (name === 'run_command') setRunCommandAbortCheck(null);
  }
}
