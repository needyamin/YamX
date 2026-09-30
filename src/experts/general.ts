/**
 * YamX - General Expert
 * Fallback expert for ambiguous input, help, config, onboarding, and chat.
 * Works entirely offline using templates and keyword rules.
 */

import { BaseExpert, ExpertResult, ExecutionContext, WorkflowDefinition } from './base.js';
import { expertRegistry } from './registry.js';
import { RouteTable } from '../router/routes.js';

export class GeneralExpert extends BaseExpert {
  readonly name = 'general';
  readonly domain = 'meta';
  readonly capabilities = [
    'show help and available commands',
    'interactive configuration',
    'first-time onboarding',
    'system diagnostics',
    'general conversation',
    'route suggestions',
  ];

  private routeTable = new RouteTable();

  async canHandle(intent: string): Promise<boolean> {
    return true; // General expert is the fallback
  }

  async execute(intent: string, params: Record<string, any>, context: ExecutionContext): Promise<ExpertResult> {
    switch (intent) {
      case 'show_help':
        return this.handleHelp(params);
      case 'manage_config':
        return this.handleConfig(params, context);
      case 'onboarding':
        return this.handleOnboarding(params, context);
      case 'system_diagnose':
        return this.handleDiagnose(params, context);
      case 'general_chat':
        return this.handleChat(params);
      case 'empty_input':
        return this.handleEmpty(params);
      case 'fallback':
      default:
        return this.handleFallback(params);
    }
  }

  getWorkflow(): WorkflowDefinition {
    return {
      name: 'general',
      steps: [
        { name: 'identify_intent', description: 'Determine what the user wants', required: true },
        { name: 'select_response', description: 'Choose appropriate template or action', required: true },
        { name: 'render_output', description: 'Format and return the response', required: true },
      ],
    };
  }

  private handleHelp(params: Record<string, any>): ExpertResult {
    const routes = this.routeTable.getAllRoutes().filter((r) => r.name !== 'fallback');
    const byExpert = new Map<string, typeof routes>();

    for (const route of routes) {
      if (!byExpert.has(route.expert)) byExpert.set(route.expert, []);
      byExpert.get(route.expert)!.push(route);
    }

    const lines: string[] = [
      'YamX Offline Command Reference',
      '═════════════════════════════',
      '',
      'Usage: ymax <command> [options]',
      '',
    ];

    for (const [expert, expertRoutes] of byExpert) {
      lines.push(`${expert.toUpperCase()}`);
      for (const route of expertRoutes.slice(0, 6)) {
        lines.push(`  ${route.patterns[0] || route.name} — ${route.description}`);
      }
      if (expertRoutes.length > 6) {
        lines.push(`  ... and ${expertRoutes.length - 6} more`);
      }
      lines.push('');
    }

    lines.push('Type "help <topic>" for details on a specific area.');

    return this.formatSuccess(lines.join('\n'));
  }

  private handleConfig(_params: Record<string, any>, context: ExecutionContext): ExpertResult {
    const cfg = context.userConfig;
    const lines = [
      'Current Configuration',
      '═════════════════════',
      `Default Provider: ${cfg.defaultProvider}`,
      `Default Model:    ${cfg.defaultModel}`,
      `Permission Mode:  ${cfg.settings.permissionMode}`,
      `Auto Approve:     ${cfg.settings.autoApprove}`,
      `Stream Output:    ${cfg.settings.streamOutput}`,
      '',
      'To change: ymax config',
      'To reset:  ymax --reset-config',
    ];
    return this.formatSuccess(lines.join('\n'));
  }

  private handleOnboarding(_params: Record<string, any>, context: ExecutionContext): ExpertResult {
    const lines = [
      'Welcome to YamX (ymax)!',
      '═══════════════════════',
      '',
      'YamX is a terminal-first coding and operations agent.',
      'It works entirely offline — no AI APIs required.',
      '',
      'Quick start:',
      '  ymax diagnose        — Check system readiness',
      '  ymax help            — Show all commands',
      '  ymax scan project    — Analyze current directory',
      '',
      'Config file: ~/.ymax/config.json',
      'Sessions:    ~/.ymax/sessions/',
      '',
      'For AI augmentation (optional), set API keys in config.',
    ];
    return this.formatSuccess(lines.join('\n'));
  }

  private async handleDiagnose(_params: Record<string, any>, context: ExecutionContext): Promise<ExpertResult> {
    const os = await import('os');
    const lines = [
      'System Diagnostics',
      '══════════════════',
      `Platform:  ${os.platform()} ${os.arch()}`,
      `Node.js:   ${process.version}`,
      `CWD:       ${context.cwd}`,
      `Home:      ${os.homedir()}`,
      `CPUs:      ${os.cpus().length}`,
      `Memory:    ${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB total`,
      '',
      'Experts loaded:',
      ...expertRegistry.listNames().map((n) => `  ✓ ${n}`),
      '',
      'Status: Ready (offline mode)',
    ];
    return this.formatSuccess(lines.join('\n'));
  }

  private handleChat(params: Record<string, any>): ExpertResult {
    const input = String(params['_rawInput'] || '').toLowerCase();

    if (input.includes('hello') || input.includes('hi') || input.includes('hey')) {
      return this.formatSuccess('Hello! I\'m YamX, your offline terminal assistant. Type "help" to see what I can do.');
    }
    if (input.includes('thank')) {
      return this.formatSuccess('You\'re welcome! Let me know if you need anything else.');
    }
    if (input.includes('who are you') || input.includes('what are you')) {
      return this.formatSuccess('I\'m YamX (ymax) — a terminal-first coding and operations agent that works entirely offline. I can help with files, shell commands, git, DevOps diagnostics, security checks, and project analysis.');
    }

    return this.formatSuccess(
      'I\'m not sure I understood that. Try "help" for available commands, or rephrase your request.'
    );
  }

  private handleEmpty(_params: Record<string, any>): ExpertResult {
    return this.formatSuccess('Ready. Type a command or "help" for options.');
  }

  private handleFallback(params: Record<string, any>): ExpertResult {
    const input = String(params['_rawInput'] || params['rawInput'] || '');
    const suggestions = this.suggestRoutes(input);

    const lines = [
      `I didn't recognize: "${input}"`,
      '',
      'Did you mean:',
      ...suggestions.map((s) => `  • ${s.patterns[0] || s.name} — ${s.description}`),
      '',
      'Type "help" for the full command list.',
    ];

    return this.formatSuccess(lines.join('\n'));
  }

  private suggestRoutes(input: string): import('../router/routes.js').RouteDefinition[] {
    const routes = this.routeTable.getAllRoutes().filter((r) => r.name !== 'fallback');
    const scored = routes.map((r) => {
      let score = 0;
      const normalized = input.toLowerCase();
      for (const kw of r.keywords) {
        if (normalized.includes(kw.toLowerCase())) score += 1;
      }
      for (const pat of r.patterns) {
        if (normalized.includes(pat.toLowerCase())) score += 2;
      }
      return { route: r, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 3).map((s) => s.route);
  }
}

// Self-register
expertRegistry.register(new GeneralExpert());
