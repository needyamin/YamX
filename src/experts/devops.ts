/**
 * YamX - DevOps Expert
 * Handles process, network, port, DNS, container, and infrastructure diagnostics.
 * Workflow: probe environment → run targeted checks → aggregate report → remediation suggestions.
 */

import { BaseExpert, ExpertResult, ExecutionContext, WorkflowDefinition } from './base.js';
import { expertRegistry } from './registry.js';
import { runCommand, shellDiagnostics } from '../tools/shell.js';

export class DevOpsExpert extends BaseExpert {
  readonly name = 'devops';
  readonly domain = 'devops';
  readonly capabilities = [
    'check running processes',
    'run network diagnostics (ping, ports, listeners)',
    'check DNS resolution',
    'inspect container status',
    'show system resource usage',
  ];

  async canHandle(intent: string): Promise<boolean> {
    return intent.startsWith('check_process') || intent.startsWith('check_network')
      || intent.startsWith('check_container') || intent === 'system_diagnose';
  }

  async execute(intent: string, params: Record<string, any>, context: ExecutionContext): Promise<ExpertResult> {
    try {
      switch (intent) {
        case 'check_processes': {
          const cmd = process.platform === 'win32'
            ? 'Get-Process | Select-Object -First 20 Name, Id, CPU, WorkingSet'
            : 'ps aux --sort=-%cpu | head -20';
          return this.formatSuccess(await runCommand.execute({ command: cmd }));
        }
        case 'check_network': {
          const host = params.host || '127.0.0.1';
          const port = params.port;
          const lines: string[] = ['Network Diagnostics', '═══════════════════'];

          if (port) {
            const portCmd = process.platform === 'win32'
              ? `netstat -ano | findstr :${port}`
              : `ss -tlnp | grep :${port}`;
            lines.push(`\nPort ${port} listeners:`);
            lines.push(await runCommand.execute({ command: portCmd }));
          } else {
            const pingCmd = process.platform === 'win32'
              ? `ping -n 2 ${host}`
              : `ping -c 2 ${host}`;
            lines.push(`\nPing ${host}:`);
            lines.push(await runCommand.execute({ command: pingCmd }));
          }

          return this.formatSuccess(lines.join('\n'));
        }
        case 'check_containers': {
          const dockerPs = await runCommand.execute({ command: 'docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"' });
          return this.formatSuccess(`Containers\n══════════\n${dockerPs}`);
        }
        case 'system_diagnose': {
          const diag = await shellDiagnostics.execute(params);
          return this.formatSuccess(diag);
        }
        default:
          return this.formatError(`Unknown devops intent: ${intent}`);
      }
    } catch (err: any) {
      return this.formatError(`DevOps error: ${err?.message || err}`);
    }
  }

  getWorkflow(): WorkflowDefinition {
    return {
      name: 'devops',
      steps: [
        { name: 'probe_environment', description: 'Detect OS and available tooling', required: true },
        { name: 'run_checks', description: 'Execute targeted diagnostic commands', required: true },
        { name: 'aggregate', description: 'Combine results into a coherent report', required: true },
        { name: 'remediate', description: 'Suggest fixes or next steps', required: false },
      ],
    };
  }
}

expertRegistry.register(new DevOpsExpert());
