import type { Tool } from './registry.js';

export const delegateTool: Tool = {
  definition: {
    name: 'delegate',
    description: `Hand parts of a coding task to sub-agents that share the project brief.
Use explorer (read-only) in parallel to map the code, then one implementer or debugger to change files, then reviewer to read the diff.
Each task needs role (explorer, implementer, debugger, or reviewer), goal, and optional paths.
Writers run one at a time. Explorers and the reviewer can run together.
Do not repeat their edits yourself. Use the report.`,
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: 'Sub-agent tasks. Explorers first, then one writer, then a reviewer.',
          items: {
            type: 'object',
            properties: {
              role: {
                type: 'string',
                description: 'explorer, implementer, debugger, or reviewer',
              },
              goal: { type: 'string', description: 'What this sub-agent should accomplish' },
              paths: {
                type: 'array',
                items: { type: 'string' },
                description: 'Files or directories this task should stay inside',
              },
            },
            required: ['role', 'goal'],
          },
        },
      },
      required: ['tasks'],
    },
  },
  async execute(args) {
    const { runDelegatedTasks } = await import('../subagents.js');
    return runDelegatedTasks(args || {});
  },
};
