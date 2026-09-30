/**
 * YamX - Local Intelligence Engine
 * Orchestrates all offline reasoning: intent classification, command suggestions,
 * tool ranking, output summarization, and entity extraction.
 * Zero API calls. Purely local computation.
 */

import { ToolDefinition } from '../providers/base.js';
import { HistoryTracker, CommandHistory } from './history.js';
import { RuleBasedSummarizer } from './summarizer.js';
import { ParamExtractor, ExtractedEntity } from '../router/param-extractor.js';

export interface ProjectContext {
  cwd: string;
  projectType?: string;
  framework?: string;
  packageManager?: string;
}

export interface IntentClassification {
  intent: string;
  confidence: number;
  method: 'exact' | 'keyword' | 'fuzzy' | 'fallback';
}

export class IntelligenceEngine {
  private history: HistoryTracker;
  private summarizer: RuleBasedSummarizer;
  private paramExtractor: ParamExtractor;

  constructor() {
    this.history = new HistoryTracker();
    this.summarizer = new RuleBasedSummarizer();
    this.paramExtractor = new ParamExtractor();
  }

  // ── Intent Classification ─────────────────────────────────────────────

  classifyIntent(input: string, history: CommandHistory[]): IntentClassification {
    const normalized = input.toLowerCase().trim();

    // Fast-path exact commands
    const exact = this.matchExactCommand(normalized);
    if (exact) return exact;

    // Keyword-based classification
    const keyword = this.matchByKeywords(normalized);
    if (keyword && keyword.confidence >= 0.6) return keyword;

    // Fallback
    return {
      intent: 'fallback',
      confidence: 0.0,
      method: 'fallback',
    };
  }

  private matchExactCommand(normalized: string): IntentClassification | undefined {
    const exactPatterns: Record<string, string> = {
      'help': 'show_help',
      '/help': 'show_help',
      'config': 'manage_config',
      'settings': 'manage_config',
      'onboard': 'onboarding',
      'setup': 'onboarding',
      'diagnose': 'system_diagnose',
      'status': 'system_diagnose',
      'web': 'start_web_server',
      'server': 'start_web_server',
      'exit': 'exit',
      'quit': 'exit',
      'clear': 'clear_session',
    };

    const firstToken = normalized.split(/\s+/)[0];
    if (exactPatterns[firstToken]) {
      return {
        intent: exactPatterns[firstToken],
        confidence: 1.0,
        method: 'exact',
      };
    }
    return undefined;
  }

  private matchByKeywords(normalized: string): IntentClassification | undefined {
    const keywordMap: Record<string, string[]> = {
      'read_file': ['read', 'cat', 'show', 'view', 'open file'],
      'write_file': ['write', 'create file', 'new file', 'save file'],
      'edit_file': ['edit', 'modify', 'change', 'replace', 'update file'],
      'search_files': ['search', 'find', 'grep', 'look for'],
      'list_files': ['list', 'ls', 'dir', 'files', 'tree'],
      'delete_file': ['delete', 'remove', 'rm file', 'del'],
      'run_command': ['run', 'exec', 'execute', 'shell', 'command'],
      'shell_diagnostics': ['shell', 'env', 'path', 'diagnostics'],
      'git_status': ['git status', 'changes', 'modified'],
      'git_diff': ['git diff', 'compare'],
      'git_commit': ['git commit', 'commit changes'],
      'git_log': ['git log', 'history', 'commits'],
      'git_branch': ['git branch', 'branches'],
      'check_processes': ['process', 'ps', 'running', 'service'],
      'check_network': ['network', 'ping', 'port', 'listen'],
      'security_scan': ['security', 'scan', 'audit', 'cve'],
      'scan_project': ['scan', 'analyze', 'project', 'codebase'],
    };

    let bestIntent = '';
    let bestScore = 0;

    for (const [intent, keywords] of Object.entries(keywordMap)) {
      let score = 0;
      for (const kw of keywords) {
        if (normalized.includes(kw)) {
          score += kw.split(/\s+/).length * 0.3;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent;
      }
    }

    if (bestScore > 0.2) {
      return {
        intent: bestIntent,
        confidence: Math.min(bestScore, 1.0),
        method: 'keyword',
      };
    }
    return undefined;
  }

  // ── Command Suggestions ───────────────────────────────────────────────

  suggestCommand(partial: string, context: ProjectContext): string[] {
    const normalized = partial.toLowerCase().trim();
    const suggestions: { cmd: string; score: number }[] = [];

    const candidates = [
      'help', 'config', 'diagnose', 'web',
      'read', 'write', 'edit', 'search', 'list', 'delete',
      'run', 'shell', 'logs',
      'git status', 'git diff', 'git commit', 'git log', 'git branch',
      'scan project', 'check dependencies',
      'security scan',
    ];

    for (const cmd of candidates) {
      if (cmd.startsWith(normalized)) {
        suggestions.push({ cmd, score: 2.0 });
      } else if (cmd.includes(normalized)) {
        suggestions.push({ cmd, score: 1.0 });
      }
    }

    // Boost by project context
    if (context.packageManager === 'npm') {
      if ('run npm'.includes(normalized)) suggestions.push({ cmd: 'run npm test', score: 1.5 });
      if ('check dependencies'.includes(normalized)) suggestions.push({ cmd: 'check dependencies', score: 1.2 });
    }

    suggestions.sort((a, b) => b.score - a.score);
    return suggestions.slice(0, 8).map((s) => s.cmd);
  }

  // ── Tool Ranking ──────────────────────────────────────────────────────

  rankTools(intent: string, availableTools: ToolDefinition[]): ToolDefinition[] {
    const intentToolMap: Record<string, string[]> = {
      'read_file': ['read_file', 'read_files'],
      'write_file': ['write_file', 'write_files'],
      'edit_file': ['edit_file', 'multi_edit'],
      'search_files': ['search_files', 'grep_search'],
      'list_files': ['list_files', 'directory_tree'],
      'delete_file': ['delete_file', 'move_file'],
      'run_command': ['run_command', 'run_command_background'],
      'shell_diagnostics': ['shell_diagnostics'],
      'git_status': ['git_status'],
      'git_diff': ['git_diff'],
      'git_commit': ['git_commit'],
      'git_log': ['git_log'],
      'git_branch': ['git_branch'],
      'check_processes': ['run_command', 'shell_diagnostics'],
      'check_network': ['run_command', 'shell_diagnostics'],
      'security_scan': ['run_command', 'project_intel'],
      'scan_project': ['project_intel', 'codebase_analysis'],
    };

    const preferred = intentToolMap[intent] || [];
    const scored = availableTools.map((tool) => {
      const index = preferred.indexOf(tool.name);
      return { tool, score: index >= 0 ? preferred.length - index : 0 };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.tool);
  }

  // ── Output Summarization ──────────────────────────────────────────────

  summarizeOutput(output: string, maxChars: number): string {
    return this.summarizer.summarize(output, maxChars);
  }

  // ── Entity Extraction ─────────────────────────────────────────────────

  extractEntities(input: string): ExtractedEntity[] {
    return this.paramExtractor.extractEntities(input);
  }
}

export const defaultIntelligence = new IntelligenceEngine();
