/**
 * YamX — terminal UI with rich markdown rendering
 */

import chalk from 'chalk';
import ora, { Ora } from 'ora';
import boxen from 'boxen';
import wrapAnsi from 'wrap-ansi';
import inquirer from 'inquirer';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { summarizeApiFailure } from './provider-error-format.js';
import {
  capAssistantMarkdownSource,
  DEFAULT_MAX_ASSISTANT_MARKDOWN_CHARS,
} from './assistant-output-cap.js';
import {
  BODY_LEFT_GUTTER,
  BODY_RIGHT_GUTTER,
  wrapIndentedBodyBlock,
  wrapWidthForIndentedBody,
  panelInnerWrapWidth,
} from './terminal-layout.js';
import { ttyCueAfterBulkOutput, ttyResetBeforeReplPrompt } from './tty-repl-cue.js';
import { playYamxLogo } from './pixel-logo.js';

const DIM = chalk.dim;

/** YamX-aligned terminal Markdown (streaming & static render share this preset). */
function yamxMarkedTerminal() {
  return markedTerminal({
    reflowText: false,
    width: Math.max(32, wrapWidthForIndentedBody()),
    tab: 2,
    showSectionPrefix: false,
    emoji: false,
    paragraph: chalk.reset,
    heading: chalk.bold,
    firstHeading: chalk.hex('#D97757').bold,
    hr: (line: string) => DIM(typeof line === 'string' ? line.trimEnd() : line),
    blockquote: chalk.italic,
    html: DIM,
    link: chalk.hex('#D97757'),
    href: chalk.underline,
    strong: chalk.bold,
    em: chalk.italic,
    codespan: chalk.hex('#E8B86D'),
    code: chalk.hex('#E8B86D'),
    listitem: chalk.reset,
  }) as any;
}

marked.use(yamxMarkedTerminal());

const SUCCESS = chalk.hex('#8FBC8F');
const ERROR = chalk.hex('#E07A6A');
const WARNING = chalk.hex('#E8B86D');
const ACCENT = chalk.hex('#D97757');
const FRAME = '#6B6560';

/** Composer glyph used by the REPL. */
export const REPL_PROMPT = `${ACCENT('>')} `;

function clipField(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '…';
}

/** Show large command output (e.g. ipconfig) without chopping mid-line; model still receives full text. */
const TOOL_RESULT_DISPLAY_MAX_CHARS = 48_000;
const TOOL_RESULT_MAX_LINES_NORMAL = 250;
const TOOL_RESULT_MAX_LINES_VERBOSE = 500;

/** Prefer cutting at newline so boxed panels stay readable */
function truncateToolTextAtNewline(raw: string, maxChars: number): { text: string; truncatedChars: boolean } {
  if (raw.length <= maxChars) return { text: raw, truncatedChars: false };
  let head = raw.slice(0, maxChars);
  const nl = head.lastIndexOf('\n');
  if (nl > maxChars * 0.35) head = head.slice(0, nl);
  return {
    text:
      head +
      `\n[yamx] …preview truncated (${raw.length.toLocaleString()} chars; full tool output is still sent to the agent.)`,
    truncatedChars: true,
  };
}

export type UIOptions = {
  verbose?: boolean;
  maxAssistantMarkdownChars?: number;
  /** No spinners, panels, or decorative console output (servers / web UI capture). */
  headless?: boolean;
};

export class UI {
  private spinner: Ora | null = null;
  private streamBuffer = '';
  private verbose = false;
  private headless = false;
  /** Accumulated assistant Markdown while streaming (rendered once on finalize). */
  private assistantMarkdownDraft = '';
  /** Subtle spinner while streamed tokens arrive before Markdown is painted. */
  private assistantStreamOra: Ora | null = null;
  /** Hard cap on assistant markdown source characters (terminal + session alignment). */
  private assistantMarkdownCap: number;

  constructor(opts?: UIOptions) {
    this.verbose = opts?.verbose === true;
    this.headless = opts?.headless === true;
    this.assistantMarkdownCap = Math.max(
      400,
      opts?.maxAssistantMarkdownChars ?? DEFAULT_MAX_ASSISTANT_MARKDOWN_CHARS
    );
  }

  /** Reset dangling SGR before readline redraws the prompt (↑/↓ history, next question). */
  resetTTYBeforeReplPrompt(): void {
    ttyResetBeforeReplPrompt();
  }

  /** After panels / streamed output so the viewport moves forward before the REPL resumes. */
  cueTTYAfterBulkOutput(): void {
    ttyCueAfterBulkOutput();
  }

  /** Discard partial streamed assistant output (API error mid-stream). */
  cancelAssistantMarkdownStream() {
    if (this.assistantStreamOra) {
      this.assistantStreamOra.stop();
      this.assistantStreamOra = null;
    }
    this.assistantMarkdownDraft = '';
  }

  private printPanel(titleStrip: string, body: string, borderColor: string) {
    const innerW = panelInnerWrapWidth();
    const wrapped = wrapAnsi(body.trimEnd(), innerW, { trim: false, wordWrap: true });
    console.log(
      '\n' +
        boxen(wrapped, {
          title: titleStrip,
          titleAlignment: 'left',
          padding: { top: 0, bottom: 0, left: 1, right: 1 },
          margin: { top: 0, bottom: 0, left: BODY_LEFT_GUTTER, right: 3 },
          borderStyle: 'round',
          borderColor,
          dimBorder: true,
        }) +
        '\n'
    );
  }

  async banner(provider: string, model: string, session?: { title?: string; id?: string }, _toolCount = 0, version = 'dev', councilOn = false) {
    const tty = process.stdout.isTTY === true;
    if (tty) console.clear();

    const cols =
      typeof process.stdout.columns === 'number' && process.stdout.columns >= 48 ? process.stdout.columns : 80;
    if (!this.headless) {
      await playYamxLogo(cols, tty);
    }
    const cwd = clipField(process.cwd(), Math.min(56, Math.max(24, cols - 16)));
    const modelClip = clipField(model || 'local', 22);
    const provClip = clipField(provider || 'offline', 18);
    const versionLine = `v${version}${councilOn ? '  ·  council on' : ''}`;
    const sessionLine = session?.title
      ? `${clipField(session.title, 24)}${session.id ? `  ·  ${session.id.slice(0, 8)}` : ''}`
      : '';
    const statusVisible = `${modelClip}  ·  ${provClip}`;
    const width = Math.max(statusVisible.length, cwd.length, sessionLine.length, versionLine.length);

    const centerPlain = (text: string, paint: (s: string) => string) => {
      const pad = Math.max(0, width - text.length);
      const left = Math.floor(pad / 2);
      return ' '.repeat(left) + paint(text) + ' '.repeat(pad - left);
    };
    const statusPad = Math.max(0, width - statusVisible.length);
    const statusLeft = Math.floor(statusPad / 2);
    const status =
      ' '.repeat(statusLeft) +
      chalk.hex('#E8B56A').bold(modelClip) +
      DIM('  ·  ') +
      chalk.hex('#D97757')(provClip) +
      ' '.repeat(statusPad - statusLeft);

    const lines = [
      status,
      centerPlain(cwd, DIM),
      ...(sessionLine ? [centerPlain(sessionLine, chalk.hex('#8A6A55'))] : []),
      centerPlain(versionLine, chalk.hex('#8A6A55')),
    ];

    const cardWidth = width + 4;
    const cardLeft = Math.max(0, Math.floor((cols - cardWidth) / 2));
    console.log(
      boxen(lines.join('\n'), {
        padding: { top: 0, bottom: 0, left: 1, right: 1 },
        margin: { top: 0, bottom: 0, left: cardLeft, right: 0 },
        borderStyle: 'round',
        borderColor: '#8A6A55',
        dimBorder: true,
      })
    );
    const hintPlain = '/help for help  ·  /connect to switch model';
    const hint =
      ACCENT('/help') + DIM(' for help  ·  ') + ACCENT('/connect') + DIM(' to switch model');
    const hintPad = Math.max(0, Math.floor((cols - hintPlain.length) / 2));
    console.log(`\n${' '.repeat(hintPad)}${hint}\n`);
  }

  neuralStatus(stage: string, detail: string) {
    if (!this.verbose) return;
    console.log(`  ${ACCENT('●')} ${DIM(stage)}  ${DIM(detail)}`);
  }

  help() {
    const sections: [string, [string, string][]][] = [
      ['Session', [
        ['/clear', 'Clear chat history'],
        ['/compact', 'Compress old context'],
        ['/stop', 'Request stop/cancel for active work'],
        ['/history [n]', 'Numbered YamX prompts (~/.yamx/history); last n lines'],
        ['/exit', 'Save and quit'],
      ]],
      ['Memory', [
        ['/init', 'Create YamX memory files'],
        ['/scan [quick|deep]', 'Offline scan → .yamx/project-summary.md (no cloud tokens)'],
        ['/memory', 'Show memory file status'],
        ['/remember', 'Save a durable note'],
      ]],
      ['Inspect', [
        ['/connect', 'Set base URL, API key, and model name'],
        ['/model', 'Provider & model'],
        ['/cost', 'Token usage & history'],
        ['/diff', 'Git diff'],
        ['/pwd', 'Show YamX shell cwd'],
        ['/cd', 'Change YamX shell cwd'],
        ['/run', 'Execute shell command'],
        ['/fix <cmd>', 'Preview smart correction for a wrong command'],
        ['/translate <cmd>', 'Translate a command to this platform native form'],
        ['/log', 'Inspect logs: /log [file] --mode latest-error'],
        ['/status', 'Runtime/session snapshot'],
        ['/tools', 'List all tools'],
        ['/skills', 'List loaded skills'],
      ]],
      ['Subagents', [
        ['/agents', 'List built-in subagents'],
        ['/agent', 'Run custom subagent'],
        ['/explore', 'Read-only codebase analysis'],
        ['/plan', 'Read-only implementation plan'],
        ['/review', 'Review current changes'],
      ]],
      ['Edit', [
        ['/undo', 'Revert last file edits'],
      ]],
    ];

    console.log(chalk.bold('\n  Commands\n'));
    for (const [category, commands] of sections) {
      console.log(`  ${ACCENT(category)}`);
      for (const [cmd, desc] of commands) {
        console.log(`    ${chalk.white(cmd.padEnd(18))} ${DIM(desc)}`);
      }
      console.log();
    }
  }

  startThinking(text = 'Thinking…') {
    if (this.headless) return;
    this.spinner = ora({
      text: DIM(text),
      color: 'gray',
      spinner: 'dots',
    }).start();
  }

  updateSpinner(text: string) {
    if (this.spinner) {
      this.spinner.text = DIM(text);
    }
  }

  stopSpinner() {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
  }

  /** Start assistant markdown stream with optional blank line above first token. */
  beginAssistantMarkdownStream(withLeadingNl: boolean) {
    this.cancelAssistantMarkdownStream(); // clears draft + stray stream spinner
    if (withLeadingNl && !this.headless) console.log('');
  }

  /** Stream one Markdown chunk — buffered until finalize (so headings/lists/code fences render). */
  appendAssistantMarkdownChunk(fragment: string) {
    const f = fragment ?? '';
    if (!f.length) return;
    this.assistantMarkdownDraft += f;

    const ttyOut = typeof process.stdout.isTTY === 'boolean' ? process.stdout.isTTY : true;
    if (!this.headless && ttyOut && !this.assistantStreamOra) {
      this.assistantStreamOra = ora({
        text: DIM('Thinking…'),
        color: 'gray',
      }).start();
    }
  }

  /** Emit any leftover text after chunks end (no trailing newline assumed). */
  finalizeAssistantMarkdownStream() {
    if (this.assistantStreamOra) {
      this.assistantStreamOra.stop();
      this.assistantStreamOra = null;
    }
    const draftRaw = this.assistantMarkdownDraft.replace(/\s+$/, '');
    this.assistantMarkdownDraft = '';
    if (!draftRaw.length) return;

    const capped = capAssistantMarkdownSource(draftRaw, this.assistantMarkdownCap);
    const draft = capped.text;
    if (capped.truncated && !this.headless) {
      console.log(
        DIM(
          `[yamx] Reply truncated (${capped.text.length}/${capped.originalLength} chars). Raise settings.maxAssistantMarkdownChars in ~/.yamx/config.json.`
        )
      );
    }

    if (this.headless) return;

    try {
      const rendered = marked.parse(draft);
      const ansi = typeof rendered === 'string' ? rendered.trimEnd() : draft;
      const block = wrapIndentedBodyBlock(ansi);
      if (block.trim().length) console.log(block + '\n');
    } catch {
      console.log(wrapIndentedBodyBlock(draft) + '\n');
    }
  }

  streamText(text: string) {
    this.stopSpinner();
    if (!this.headless) process.stdout.write(text);
    this.streamBuffer += text;
  }

  endStream() {
    if (this.streamBuffer) {
      if (!this.headless) console.log();
      this.streamBuffer = '';
    }
  }

  /** Render markdown content to the terminal with rich formatting */
  renderMarkdown(text: string, opts?: { bypassCap?: boolean }): string {
    try {
      let src = text;
      if (!opts?.bypassCap) {
        const c = capAssistantMarkdownSource(src, this.assistantMarkdownCap);
        src = c.text;
        if (c.truncated && !this.headless) {
          console.log(
            DIM(
              `[yamx] Output truncated (${c.text.length}/${c.originalLength} chars). Raise settings.maxAssistantMarkdownChars in ~/.yamx/config.json.`
            )
          );
        }
      }
      const rendered = marked.parse(src);
      const ansi = typeof rendered === 'string' ? rendered.trimEnd() : src;
      return wrapIndentedBodyBlock(ansi);
    } catch {
      const fallback = opts?.bypassCap ? text : capAssistantMarkdownSource(text, this.assistantMarkdownCap).text;
      return wrapIndentedBodyBlock(String(fallback).trimEnd());
    }
  }

  private crewDepth = 0;

  crewStart(role: string, goal: string) {
    this.stopSpinner();
    if (this.headless) return;
    const title = role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Subagent';
    const pad = ' '.repeat(2 + this.crewDepth * 2);
    console.log(`\n${pad}${ACCENT('●')} ${chalk.bold(title)}  ${DIM(clipField(goal, 88))}`);
  }

  pushCrew() {
    this.crewDepth += 1;
  }

  popCrew() {
    this.crewDepth = Math.max(0, this.crewDepth - 1);
  }

  toolCall(name: string, args: Record<string, unknown>) {
    this.stopSpinner();
    if (this.headless) return;

    const { label, target } = summarizeToolCall(name, args);
    const targetBit = target ? `  ${DIM(target)}` : '';
    const pad = ' '.repeat(2 + this.crewDepth * 2);
    console.log(`\n${pad}${ACCENT('●')} ${chalk.bold(label)}${targetBit}`);
    if (this.verbose) {
      for (const [k, v] of Object.entries(args)) {
        const raw = typeof v === 'string' ? v : JSON.stringify(v);
        console.log(`     ${DIM(`${k}=${clipField(raw.replace(/\s+/g, ' '), 160)}`)}`);
      }
    }

    if (name === 'run_command' && typeof args.command === 'string' && args.command.trim()) {
      const cmd = args.command.trim();
      const cols = typeof process.stdout.columns === 'number' && process.stdout.columns >= 40 ? process.stdout.columns : 80;
      const budget = Math.max(48, Math.min(96, cols - 24));
      const preview = cmd.length > budget ? `${cmd.slice(0, budget - 1)}…` : cmd;
      this.startThinking(`Running: ${preview}`);
    }
  }

  toolResult(name: string, result: string, duration: number) {
    this.stopSpinner();
    if (this.headless) return;
    const normalized = String(result ?? '').replace(/\r\n/g, '\n').replace(/\s+$/, '');
    const shell = name === 'run_command' || name === 'run_command_background';
    const maxLines = shell
      ? (this.verbose ? TOOL_RESULT_MAX_LINES_VERBOSE : TOOL_RESULT_MAX_LINES_NORMAL)
      : (this.verbose ? 24 : 8);
    const maxChars = shell ? TOOL_RESULT_DISPLAY_MAX_CHARS : 2_400;

    if (!normalized.trim()) {
      const timing = this.verbose ? DIM(`  ${duration}ms`) : '';
      const pad = ' '.repeat(2 + this.crewDepth * 2);
      console.log(`${pad}${DIM('⎿')}  ${DIM('(empty)')}${timing}`);
      return;
    }

    const { text: capped, truncatedChars } = truncateToolTextAtNewline(normalized, maxChars);
    const lines = capped.split('\n');
    let hidden = 0;
    let displayLines = lines;
    if (lines.length > maxLines) {
      const kept = Math.max(4, maxLines - 1);
      hidden = lines.length - kept;
      displayLines = lines.slice(0, kept);
    }

    const pad = ' '.repeat(2 + this.crewDepth * 2);
    displayLines.forEach((ln, i) => {
      const prefix = i === 0 ? `${DIM('⎿')}  ` : '     ';
      console.log(`${pad}${prefix}${DIM(ln)}`);
    });
    if (truncatedChars || hidden > 0) {
      const bits: string[] = [];
      if (hidden > 0) bits.push(`${hidden} more lines`);
      if (truncatedChars) bits.push('preview truncated');
      if (this.verbose) bits.push(`${duration}ms`);
      console.log(`${pad}   ${DIM(`… ${bits.join(' · ')} (full output is still sent to the agent)`)}`);
    } else if (this.verbose) {
      console.log(`${pad}   ${DIM(`${duration}ms`)}`);
    }
  }

  approvalNeeded(toolName: string, args: Record<string, unknown>, dangerous = false): string {
    if (this.headless) return '';
    const { label, target } = summarizeToolCall(toolName, args);
    const detailLines = Object.entries(args).slice(0, 8).map(([k, v]) => {
      const raw = typeof v === 'string' ? v : JSON.stringify(v);
      return `${DIM(k)}  ${clipField(String(raw).replace(/\s+/g, ' '), 180)}`;
    });
    const body = [
      dangerous ? ERROR.bold(label) : chalk.bold(label),
      target ? DIM(target) : '',
      ...detailLines,
    ].filter(Boolean).join('\n');
    console.log(
      '\n' +
        boxen(body, {
          title: dangerous ? 'Dangerous action' : 'Allow this action?',
          titleAlignment: 'left',
          padding: { top: 0, bottom: 0, left: 1, right: 1 },
          margin: { top: 0, bottom: 0, left: BODY_LEFT_GUTTER, right: 2 },
          borderStyle: 'round',
          borderColor: dangerous ? '#E07A6A' : FRAME,
          dimBorder: true,
        }) +
        '\n'
    );
    return '';
  }

  /** Numbered yes/no. Permission rules stay with the caller; this is only the prompt. */
  async confirmAction(message = 'Do you want to proceed?', defaultYes = true): Promise<boolean> {
    if (this.headless) return false;
    const { choice } = await inquirer.prompt<{ choice: string }>([
      {
        type: 'rawlist',
        name: 'choice',
        message,
        default: defaultYes ? 'yes' : 'no',
        choices: [
          { name: 'Yes', value: 'yes' },
          { name: 'No', value: 'no' },
        ],
      },
    ]);
    return choice === 'yes';
  }

  usage(input: number, output: number, totalInput: number, totalOutput: number) {
    if (this.headless) return;
    console.log(
      DIM(`\n  Tokens ↑${input} ↓${output} · Session ↑${totalInput} ↓${totalOutput}`)
    );
  }

  error(msg: string) {
    this.stopSpinner();
    const w = wrapWidthForIndentedBody();
    const head = `${ERROR('✗')} ${ERROR(msg)}`;
    const folded = wrapAnsi(head, w, { trim: false, wordWrap: true });
    const text = `\n${folded
      .split('\n')
      .map((l) => `${' '.repeat(BODY_LEFT_GUTTER)}${l}`)
      .join('\n')}\n`;
    console.log(text);
  }

  /**
   * Boxed provider / stream failures (parses embedded JSON bodies instead of dumping one long line).
   */
  apiFailure(kind: 'stream' | 'complete', err: unknown) {
    this.stopSpinner();
    const view = summarizeApiFailure(err);
    const title = kind === 'stream' ? ' Stream failed ' : ' API request failed ';
    const lines: string[] = [`${ERROR.bold(view.headline)}`];
    for (const d of view.detailLines) lines.push('');
    lines.push(...view.detailLines.map((d) => DIM(d)));
    if (view.hints.length) {
      lines.push('', DIM('What to try:'));
      lines.push(...view.hints.map((h) => `  ${WARNING('-')} ${DIM(h)}`));
    }
    if (view.technical) {
      lines.push('', DIM(view.technical));
    }
    const wrapW = panelInnerWrapWidth();
    const inner = wrapAnsi(lines.join('\n').trimEnd(), wrapW, { trim: false, wordWrap: true });
    console.log(
      '\n' +
        boxen(inner, {
          padding: { top: 0, bottom: 0, left: 1, right: 1 },
          margin: { top: 0, bottom: 1, left: 2, right: 3 },
          borderStyle: 'round',
          borderColor: '#E07A6A',
          dimBorder: true,
          title: ERROR.bold(title.trim()),
          titleAlignment: 'left',
        }) +
        '\n'
    );
  }

  success(msg: string) {
    if (this.headless) return;
    console.log(`\n  ${SUCCESS('✓')} ${msg}`);
  }

  info(msg: string) {
    if (this.headless) return;
    const w = wrapWidthForIndentedBody();
    const line = `${ACCENT('●')} ${DIM(msg)}`;
    console.log(
      wrapAnsi(line, w, { trim: false, wordWrap: true })
        .split('\n')
        .map((l) => `${' '.repeat(BODY_LEFT_GUTTER)}${l}`)
        .join('\n')
    );
  }

  warn(msg: string) {
    if (this.headless) return;
    const w = wrapWidthForIndentedBody();
    const line = `${WARNING('⚠')} ${WARNING(msg)}`;
    console.log(
      wrapAnsi(line, w, { trim: false, wordWrap: true })
        .split('\n')
        .map((l) => `${' '.repeat(BODY_LEFT_GUTTER)}${l}`)
        .join('\n')
    );
  }

  /** After cooperative stop: second Ctrl+C exits YamX while work is active. */
  replForceExitHint(): void {
    if (this.headless) return;
    console.log(`${' '.repeat(BODY_LEFT_GUTTER)}${chalk.dim('Press Ctrl+C again to exit YamX.')}`);
  }

  separator() {
    if (this.headless) return;
    console.log(DIM('  ─'.repeat(28)));
  }

  /** Print a tools list grouped by category */
  toolsList(categories: Record<string, string[]>) {
    console.log(chalk.bold('\n  Tools\n'));
    for (const [cat, tools] of Object.entries(categories)) {
      console.log(`  ${ACCENT(cat)}`);
      for (const t of tools) {
        console.log(`    ${chalk.white(t)}`);
      }
      console.log();
    }
  }
}

const TOOL_LABELS: Record<string, string> = {
  read_file: 'Read',
  read_files: 'Read',
  write_file: 'Write',
  write_files: 'Write',
  edit_file: 'Edit',
  multi_edit: 'Edit',
  patch_file: 'Patch',
  delete_file: 'Delete',
  copy_file: 'Copy',
  move_file: 'Move',
  list_files: 'List',
  search_files: 'Search',
  grep_search: 'Grep',
  file_info: 'File info',
  directory_tree: 'Tree',
  find_references: 'References',
  run_command: 'Bash',
  run_command_background: 'Bash',
  shell_diagnostics: 'Shell',
  fetch_url: 'Fetch',
  git_status: 'Git status',
  git_diff: 'Git diff',
  git_commit: 'Git commit',
  git_log: 'Git log',
  git_branch: 'Git branch',
  git_stash: 'Git stash',
  log_inspect: 'Logs',
  project_intel: 'Project',
  codebase_analysis: 'Codebase',
  delegate: 'Delegate',
  task_list: 'Tasks',
  task_tail: 'Task output',
  task_stop: 'Stop task',
};

function summarizeToolCall(name: string, args: Record<string, unknown>): { label: string; target: string } {
  const label = TOOL_LABELS[name] || name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const keys = ['path', 'file', 'command', 'pattern', 'query', 'url', 'source', 'destination', 'message'];
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) {
      return { label, target: clipField(value.trim().replace(/\s+/g, ' '), 96) };
    }
  }
  if (Array.isArray(args.paths) && args.paths.length) {
    return { label, target: clipField(args.paths.map((p) => String(p)).join(', '), 96) };
  }
  if (Array.isArray(args.writes) && args.writes.length) {
    return { label, target: clipField(`${args.writes.length} files`, 96) };
  }
  return { label, target: '' };
}
