/**
 * YamX - Tool Registry
 * Central registry for all agent tools.
 */

import { ToolDefinition } from '../providers/base.js';
import { readFile, writeFile, editFile, listFiles, searchFiles, deleteFile, readFiles, writeFiles } from './filesystem.js';
import { runCommand, runCommandBackground, shellDiagnostics, taskList, taskTail, taskStop } from './shell.js';
import { gitStatus, gitDiff, gitCommit, gitLog, gitBranch, gitStash } from './git.js';
import { fetchUrlTool } from './web.js';
import { multiEdit, copyFile, moveFile, fileInfo, grepSearch, treeTool, patchFile, findReferences } from './advanced.js';
import { codebaseAnalysis, projectIntel } from './intel.js';
import { logInspect } from './logs.js';
import { delegateTool } from './delegate.js';

export interface Tool {
  definition: ToolDefinition;
  execute(args: any): Promise<string>;
  needsApproval?: boolean;
  isDangerous?(args: any): boolean;
}

export const allTools: Record<string, Tool> = {
  read_file: readFile,
  read_files: readFiles,
  write_file: writeFile,
  write_files: writeFiles,
  edit_file: editFile,
  list_files: listFiles,
  search_files: searchFiles,
  delete_file: deleteFile,

  multi_edit: multiEdit,
  copy_file: copyFile,
  move_file: moveFile,
  file_info: fileInfo,
  grep_search: grepSearch,
  directory_tree: treeTool,
  patch_file: patchFile,
  find_references: findReferences,

  run_command: runCommand,
  run_command_background: runCommandBackground,
  shell_diagnostics: shellDiagnostics,
  task_list: taskList,
  task_tail: taskTail,
  task_stop: taskStop,

  git_status: gitStatus,
  git_diff: gitDiff,
  git_commit: gitCommit,
  git_log: gitLog,
  git_branch: gitBranch,
  git_stash: gitStash,

  fetch_url: fetchUrlTool,
  log_inspect: logInspect,
  project_intel: projectIntel,
  codebase_analysis: codebaseAnalysis,
  delegate: delegateTool,
};

export function getToolDefinitions(): ToolDefinition[] {
  return Object.values(allTools).map((t) => t.definition);
}

export function getTool(name: string): Tool | undefined {
  return allTools[name];
}

export function getToolCount(): number {
  return Object.keys(allTools).length;
}

export function getToolsByCategory(): Record<string, string[]> {
  return {
    Files: ['read_file', 'read_files', 'write_file', 'write_files', 'edit_file', 'list_files', 'search_files', 'delete_file'],
    'Advanced Files': ['multi_edit', 'copy_file', 'move_file', 'file_info', 'grep_search', 'directory_tree', 'patch_file'],
    Shell: ['run_command', 'run_command_background', 'shell_diagnostics', 'task_list', 'task_tail', 'task_stop'],
    Git: ['git_status', 'git_diff', 'git_commit', 'git_log', 'git_branch', 'git_stash'],
    Web: ['fetch_url'],
    Intelligence: ['project_intel', 'codebase_analysis', 'log_inspect', 'find_references'],
    Crew: ['delegate'],
  };
}
