/**
 * YamX - Shell Expert
 * Handles shell execution, background tasks, diagnostics, and log inspection.
 * Workflow: classify risk → policy check → execute → capture → suggest next steps.
 */

import { BaseExpert, ExpertResult, ExecutionContext, WorkflowDefinition } from './base.js';
import { expertRegistry } from './registry.js';
import { runCommand, runCommandBackground, shellDiagnostics, taskList, taskTail, taskStop } from '../tools/shell.js';
import { logInspect } from '../tools/logs.js';

export class ShellExpert extends BaseExpert {
  readonly name = 'shell';
  readonly domain = 'shell';
  readonly capabilities = [
    'execute shell commands',
    'run background tasks',
    'show shell environment diagnostics',
    'list and manage background tasks',
    'inspect log files',
  ];

  async canHandle(intent: string): Promise<boolean> {
    return intent.startsWith('run_command') || intent.startsWith('shell_')
      || intent.startsWith('task_') || intent === 'inspect_logs';
  }

  async execute(intent: string, params: Record<string, any>, context: ExecutionContext): Promise<ExpertResult> {
    try {
      switch (intent) {
        case 'run_command':
          return this.formatSuccess(await runCommand.execute(params));
        case 'run_command_background':
          return this.formatSuccess(await runCommandBackground.execute(params));
        case 'shell_diagnostics':
          return this.formatSuccess(await shellDiagnostics.execute(params));
        case 'task_list':
          return this.formatSuccess(await taskList.execute(params));
        case 'task_tail':
          return this.formatSuccess(await taskTail.execute(params));
        case 'task_stop':
          return this.formatSuccess(await taskStop.execute(params));
        case 'inspect_logs':
          return this.formatSuccess(await logInspect.execute(params));
        default:
          return this.formatError(`Unknown shell intent: ${intent}`);
      }
    } catch (err: any) {
      return this.formatError(`Shell error: ${err?.message || err}`);
    }
  }

  getWorkflow(): WorkflowDefinition {
    return {
      name: 'shell',
      steps: [
        { name: 'classify_risk', description: 'Determine if command is dangerous', required: true },
        { name: 'policy_check', description: 'Check against allowed/denied patterns', required: true },
        { name: 'execute', description: 'Run the command', required: true },
        { name: 'capture_output', description: 'Collect stdout, stderr, and exit code', required: true },
        { name: 'suggest_next', description: 'Recommend follow-up actions', required: false },
      ],
    };
  }
}

expertRegistry.register(new ShellExpert());
