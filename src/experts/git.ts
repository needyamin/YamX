/**
 * YamX - Git Expert
 * Handles git operations with workflow: detect repo → validate state → execute → summarize.
 */

import { BaseExpert, ExpertResult, ExecutionContext, WorkflowDefinition } from './base.js';
import { expertRegistry } from './registry.js';
import { gitStatus, gitDiff, gitCommit, gitLog, gitBranch, gitStash } from '../tools/git.js';

export class GitExpert extends BaseExpert {
  readonly name = 'git';
  readonly domain = 'git';
  readonly capabilities = [
    'show repository status',
    'show diffs',
    'commit changes',
    'show commit history',
    'manage branches',
    'stash and restore changes',
  ];

  async canHandle(intent: string): Promise<boolean> {
    return intent.startsWith('git_');
  }

  async execute(intent: string, params: Record<string, any>, context: ExecutionContext): Promise<ExpertResult> {
    try {
      switch (intent) {
        case 'git_status':
          return this.formatSuccess(await gitStatus.execute(params));
        case 'git_diff':
          return this.formatSuccess(await gitDiff.execute(params));
        case 'git_commit':
          return this.formatSuccess(await gitCommit.execute(params));
        case 'git_log':
          return this.formatSuccess(await gitLog.execute(params));
        case 'git_branch':
          return this.formatSuccess(await gitBranch.execute(params));
        case 'git_stash':
          return this.formatSuccess(await gitStash.execute(params));
        default:
          return this.formatError(`Unknown git intent: ${intent}`);
      }
    } catch (err: any) {
      return this.formatError(`Git error: ${err?.message || err}`);
    }
  }

  getWorkflow(): WorkflowDefinition {
    return {
      name: 'git',
      steps: [
        { name: 'detect_repo', description: 'Verify current directory is a git repository', required: true },
        { name: 'validate_state', description: 'Check for conflicts, detached HEAD, etc.', required: false },
        { name: 'execute', description: 'Run the git command', required: true },
        { name: 'summarize', description: 'Format and explain the result', required: true },
      ],
    };
  }
}

expertRegistry.register(new GitExpert());
