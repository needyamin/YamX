/**
 * YamX - Project Expert
 * Handles project intelligence, codebase analysis, dependency checks.
 * Workflow: scan structure → detect framework → analyze dependencies → generate insights.
 */

import { BaseExpert, ExpertResult, ExecutionContext, WorkflowDefinition } from './base.js';
import { expertRegistry } from './registry.js';
import { projectIntel, codebaseAnalysis } from '../tools/intel.js';
import { runCommand } from '../tools/shell.js';

export class ProjectExpert extends BaseExpert {
  readonly name = 'project';
  readonly domain = 'project';
  readonly capabilities = [
    'analyze project structure and framework',
    'detect dependencies and outdated packages',
    'generate codebase intelligence reports',
    'find symbol references across files',
  ];

  async canHandle(intent: string): Promise<boolean> {
    return intent.startsWith('scan_project') || intent.startsWith('check_depend')
      || intent === 'codebase_analysis' || intent === 'project_intel';
  }

  async execute(intent: string, params: Record<string, any>, context: ExecutionContext): Promise<ExpertResult> {
    try {
      switch (intent) {
        case 'scan_project':
          return this.formatSuccess(await codebaseAnalysis.execute({
            goal: params.goal || 'General project overview',
            depth: params.depth || 'standard',
            max_files: params.max_files,
            save_to_memory: params.save_to_memory,
          }));
        case 'check_dependencies': {
          const lines: string[] = ['Dependency Check', '════════════════'];

          try {
            const outdated = await runCommand.execute({ command: 'npm outdated' });
            lines.push('\nnpm outdated:');
            lines.push(outdated || 'All packages up to date.');
          } catch {
            lines.push('\nnpm outdated: not available');
          }

          try {
            const audit = await runCommand.execute({ command: 'npm audit --audit-level=low' });
            lines.push('\nnpm audit:');
            lines.push(audit);
          } catch {
            lines.push('\nnpm audit: not available');
          }

          return this.formatSuccess(lines.join('\n'));
        }
        case 'project_intel':
          return this.formatSuccess(await projectIntel.execute({
            goal: params.goal,
            max_files: params.max_files,
          }));
        case 'codebase_analysis':
          return this.formatSuccess(await codebaseAnalysis.execute({
            goal: params.goal,
            depth: params.depth,
            max_files: params.max_files,
            save_to_memory: params.save_to_memory,
          }));
        default:
          return this.formatError(`Unknown project intent: ${intent}`);
      }
    } catch (err: any) {
      return this.formatError(`Project analysis error: ${err?.message || err}`);
    }
  }

  getWorkflow(): WorkflowDefinition {
    return {
      name: 'project',
      steps: [
        { name: 'scan_structure', description: 'Discover files, frameworks, and entry points', required: true },
        { name: 'detect_framework', description: 'Identify the tech stack and patterns', required: true },
        { name: 'analyze_dependencies', description: 'Check packages and versions', required: false },
        { name: 'generate_insights', description: 'Produce actionable intelligence', required: true },
      ],
    };
  }
}

expertRegistry.register(new ProjectExpert());
