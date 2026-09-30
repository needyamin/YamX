/**
 * YamX - Security Expert
 * Handles defensive security tasks: secrets scanning, CVE triage, posture checks.
 * Workflow: scope validation → read-only detection → report generation → hardening guidance.
 */

import { BaseExpert, ExpertResult, ExecutionContext, WorkflowDefinition } from './base.js';
import { expertRegistry } from './registry.js';
import { searchFiles } from '../tools/filesystem.js';
import { grepSearch } from '../tools/advanced.js';
import { runCommand } from '../tools/shell.js';

export class SecurityExpert extends BaseExpert {
  readonly name = 'security';
  readonly domain = 'security';
  readonly capabilities = [
    'scan for secrets and credentials in code',
    'check for known CVEs in dependencies',
    'audit file permissions',
    'provide defensive hardening guidance',
  ];

  async canHandle(intent: string): Promise<boolean> {
    return intent.startsWith('security_');
  }

  async execute(intent: string, params: Record<string, any>, context: ExecutionContext): Promise<ExpertResult> {
    try {
      switch (intent) {
        case 'security_scan': {
          const lines: string[] = ['Security Scan Results', '═════════════════════'];

          // Secrets patterns
          const secretPatterns = [
            /['"]([A-Za-z0-9_/+=]{40,})['"]/g, // AWS-like keys
            /api[_-]?key['"]?\s*[:=]\s*['"]([^'"]{8,})['"]/gi,
            /password['"]?\s*[:=]\s*['"]([^'"]{4,})['"]/gi,
            /token['"]?\s*[:=]\s*['"]([^'"]{8,})['"]/gi,
            /BEGIN\s+(RSA|EC|DSA|OPENSSH)\s+PRIVATE\s+KEY/g,
          ];

          const grepResult = await grepSearch.execute({
            pattern: 'api_key|password|token|secret|private_key',
            path: '.',
            max_results: 20,
          });

          lines.push('\nPotential secrets/credentials:');
          lines.push(grepResult || '(none found in quick scan)');

          // Dependency audit if package.json exists
          try {
            const audit = await runCommand.execute({ command: 'npm audit --audit-level=moderate' });
            lines.push('\nDependency audit:');
            lines.push(audit);
          } catch {
            lines.push('\nDependency audit: npm audit not available or no package.json');
          }

          lines.push('\nRecommendation: Review findings manually. This is a defensive, read-only scan.');
          return this.formatSuccess(lines.join('\n'));
        }
        default:
          return this.formatError(`Unknown security intent: ${intent}`);
      }
    } catch (err: any) {
      return this.formatError(`Security scan error: ${err?.message || err}`);
    }
  }

  getWorkflow(): WorkflowDefinition {
    return {
      name: 'security',
      steps: [
        { name: 'scope_validation', description: 'Confirm scan is authorized and defensive-only', required: true },
        { name: 'read_only_detection', description: 'Scan without modifying anything', required: true },
        { name: 'report', description: 'Generate findings report', required: true },
        { name: 'harden', description: 'Provide remediation guidance', required: false },
      ],
    };
  }
}

expertRegistry.register(new SecurityExpert());
