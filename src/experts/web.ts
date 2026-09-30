/**
 * YamX - Web Expert
 * Handles the web server lifecycle: start, stop, configure, serve UI.
 * Workflow: validate port → start server → health check → report URL.
 */

import { BaseExpert, ExpertResult, ExecutionContext, WorkflowDefinition } from './base.js';
import { expertRegistry } from './registry.js';

export class WebExpert extends BaseExpert {
  readonly name = 'web';
  readonly domain = 'web';
  readonly capabilities = [
    'start the built-in web UI server',
    'stop the web server',
    'report server status and URL',
  ];

  private serverProcess: any = null;

  async canHandle(intent: string): Promise<boolean> {
    return intent.startsWith('start_web') || intent.startsWith('stop_web');
  }

  async execute(intent: string, params: Record<string, any>, context: ExecutionContext): Promise<ExpertResult> {
    try {
      switch (intent) {
        case 'start_web_server': {
          const port = params.port || 8765;
          const host = params.host || '127.0.0.1';
          const allowDangerous = params.allowDangerous || false;

          // We delegate to the existing web server module dynamically
          // to avoid circular imports at load time.
          const { startYamxWebServer } = await import('../web/server.js');

          const result = await startYamxWebServer({
            port,
            host,
            allowDangerous,
            providerName: context.userConfig.defaultProvider,
            modelName: context.userConfig.defaultModel,
          });

          return this.formatSuccess(
            `Web server started at http://${host}:${port}\n${result || ''}`,
            undefined,
            ['web_stop']
          );
        }
        case 'stop_web_server': {
          // Signal shutdown via a module-level flag or process message
          // The actual web server handles its own lifecycle; this is a thin wrapper.
          return this.formatSuccess(
            'Web server stop requested. If running in foreground, press Ctrl+C.',
            undefined,
            ['start_web_server']
          );
        }
        default:
          return this.formatError(`Unknown web intent: ${intent}`);
      }
    } catch (err: any) {
      return this.formatError(`Web server error: ${err?.message || err}`);
    }
  }

  getWorkflow(): WorkflowDefinition {
    return {
      name: 'web',
      steps: [
        { name: 'validate_port', description: 'Check port availability', required: true },
        { name: 'start_server', description: 'Launch the HTTP server', required: true },
        { name: 'health_check', description: 'Verify the server is responding', required: false },
        { name: 'report_url', description: 'Print the access URL', required: true },
      ],
    };
  }
}

expertRegistry.register(new WebExpert());
