/**
 * YamX - Declarative Route Table
 * Central definition of all available routes, their patterns, keywords,
 * target experts, and intent labels. No logic — pure data + types.
 */

export type ExecutionMode = 'direct' | 'interactive' | 'async';

export interface RouteDefinition {
  name: string;
  patterns: string[];
  keywords: string[];
  expert: string;
  intent: string;
  priority: number;
  executionMode?: ExecutionMode;
  description: string;
  examples: string[];
}

export class RouteTable {
  private routes: RouteDefinition[] = [
    // System / Meta
    {
      name: 'help',
      patterns: ['help', '/help', 'h', '--help', '-h'],
      keywords: ['help', 'usage', 'commands', 'what can you do', 'capabilities', 'docs', 'documentation'],
      expert: 'general',
      intent: 'show_help',
      priority: 100,
      executionMode: 'direct',
      description: 'Show help, available commands, and capabilities',
      examples: ['help', 'what can you do', '/help'],
    },
    {
      name: 'config',
      patterns: ['config', 'settings', 'setup', 'configure'],
      keywords: ['config', 'settings', 'preference', 'setup', 'configure', 'api key', 'provider', 'model'],
      expert: 'general',
      intent: 'manage_config',
      priority: 95,
      executionMode: 'interactive',
      description: 'Interactive configuration wizard',
      examples: ['config', 'set provider to openai', 'change model'],
    },
    {
      name: 'onboard',
      patterns: ['onboard', 'setup', 'first run', 'getting started'],
      keywords: ['onboard', 'first run', 'setup', 'getting started', 'install', 'initialize'],
      expert: 'general',
      intent: 'onboarding',
      priority: 95,
      executionMode: 'interactive',
      description: 'First-time user onboarding flow',
      examples: ['onboard', 'getting started'],
    },
    {
      name: 'diagnose',
      patterns: ['diagnose', 'doctor', 'health', 'check', 'status'],
      keywords: ['diagnose', 'health', 'check', 'status', 'doctor', 'ready', 'working', 'test'],
      expert: 'general',
      intent: 'system_diagnose',
      priority: 90,
      executionMode: 'direct',
      description: 'Run system diagnostics and readiness checks',
      examples: ['diagnose', 'health check', 'status'],
    },

    // Web server
    {
      name: 'web_start',
      patterns: ['web', 'server', 'ui', 'gui', 'start web'],
      keywords: ['web', 'server', 'ui', 'gui', 'browser', 'http', 'start server', 'launch web'],
      expert: 'web',
      intent: 'start_web_server',
      priority: 90,
      executionMode: 'async',
      description: 'Start the built-in web UI server',
      examples: ['web', 'start web server', 'launch ui'],
    },
    {
      name: 'web_stop',
      patterns: ['stop web', 'kill server', 'shutdown web'],
      keywords: ['stop web', 'kill server', 'shutdown', 'stop ui', 'close server'],
      expert: 'web',
      intent: 'stop_web_server',
      priority: 90,
      executionMode: 'direct',
      description: 'Stop the running web UI server',
      examples: ['stop web', 'shutdown server'],
    },

    // Filesystem
    {
      name: 'file_read',
      patterns: ['read', 'cat', 'show', 'view', 'open'],
      keywords: ['read', 'file', 'show', 'view', 'content', 'open', 'display', 'print'],
      expert: 'filesystem',
      intent: 'read_file',
      priority: 85,
      executionMode: 'direct',
      description: 'Read file contents',
      examples: ['read src/index.ts', 'show package.json', 'cat README.md'],
    },
    {
      name: 'file_write',
      patterns: ['write', 'create', 'new file'],
      keywords: ['write', 'create', 'new file', 'save', 'generate file', 'make file'],
      expert: 'filesystem',
      intent: 'write_file',
      priority: 85,
      executionMode: 'interactive',
      description: 'Write or create a file',
      examples: ['write hello.txt with "Hello"', 'create file src/utils.ts'],
    },
    {
      name: 'file_edit',
      patterns: ['edit', 'modify', 'change', 'update', 'patch'],
      keywords: ['edit', 'modify', 'change', 'update', 'patch', 'replace', 'fix file'],
      expert: 'filesystem',
      intent: 'edit_file',
      priority: 85,
      executionMode: 'interactive',
      description: 'Surgically edit part of a file',
      examples: ['edit src/index.ts replace foo with bar', 'update line 10'],
    },
    {
      name: 'file_search',
      patterns: ['search', 'find', 'grep', 'locate', 'look for'],
      keywords: ['search', 'find', 'grep', 'locate', 'pattern', 'look for', 'contains'],
      expert: 'filesystem',
      intent: 'search_files',
      priority: 85,
      executionMode: 'direct',
      description: 'Search for text patterns across files',
      examples: ['search for "TODO"', 'find function foo', 'grep console.log'],
    },
    {
      name: 'file_list',
      patterns: ['list', 'ls', 'dir', 'files', 'tree'],
      keywords: ['list', 'files', 'directory', 'ls', 'dir', 'tree', 'show files', 'contents'],
      expert: 'filesystem',
      intent: 'list_files',
      priority: 85,
      executionMode: 'direct',
      description: 'List files and directories',
      examples: ['list src/', 'ls', 'tree docs'],
    },
    {
      name: 'file_delete',
      patterns: ['delete', 'remove', 'rm', 'del'],
      keywords: ['delete', 'remove', 'rm', 'del', 'destroy', 'erase'],
      expert: 'filesystem',
      intent: 'delete_file',
      priority: 80,
      executionMode: 'interactive',
      description: 'Delete a file or directory',
      examples: ['delete temp.txt', 'remove old/'],
    },
    {
      name: 'file_move',
      patterns: ['move', 'mv', 'rename'],
      keywords: ['move', 'mv', 'rename', 'relocate'],
      expert: 'filesystem',
      intent: 'move_file',
      priority: 80,
      executionMode: 'interactive',
      description: 'Move or rename a file',
      examples: ['move a.txt to b.txt', 'rename old.ts new.ts'],
    },

    // Shell
    {
      name: 'shell_run',
      patterns: ['run', 'exec', 'execute', 'shell', 'cmd', 'command'],
      keywords: ['run', 'execute', 'shell', 'command', 'cmd', 'bash', 'sh', 'npm', 'node', 'python'],
      expert: 'shell',
      intent: 'run_command',
      priority: 85,
      executionMode: 'interactive',
      description: 'Execute a shell command',
      examples: ['run npm test', 'execute ls -la', 'shell python script.py'],
    },
    {
      name: 'shell_diagnostics',
      patterns: ['shell diag', 'env', 'path', 'which'],
      keywords: ['shell', 'environment', 'path', 'diagnostics', 'which', 'env', 'variable'],
      expert: 'shell',
      intent: 'shell_diagnostics',
      priority: 75,
      executionMode: 'direct',
      description: 'Show shell environment diagnostics',
      examples: ['shell diagnostics', 'env check'],
    },
    {
      name: 'log_inspect',
      patterns: ['logs', 'log', 'tail', 'journal'],
      keywords: ['log', 'logs', 'tail', 'journal', 'syslog', 'error log', 'output', 'trace'],
      expert: 'shell',
      intent: 'inspect_logs',
      priority: 80,
      executionMode: 'direct',
      description: 'Inspect log files',
      examples: ['show logs', 'tail app.log', 'inspect error log'],
    },

    // Git
    {
      name: 'git_status',
      patterns: ['git status', 'status', 'changes'],
      keywords: ['git status', 'changes', 'modified', 'untracked', 'working tree'],
      expert: 'git',
      intent: 'git_status',
      priority: 85,
      executionMode: 'direct',
      description: 'Show git repository status',
      examples: ['git status', 'what changed', 'show changes'],
    },
    {
      name: 'git_diff',
      patterns: ['git diff', 'diff', 'compare'],
      keywords: ['git diff', 'diff', 'compare', 'changes', 'patch'],
      expert: 'git',
      intent: 'git_diff',
      priority: 85,
      executionMode: 'direct',
      description: 'Show git diff',
      examples: ['git diff', 'diff src/index.ts', 'compare'],
    },
    {
      name: 'git_commit',
      patterns: ['git commit', 'commit', 'save changes'],
      keywords: ['git commit', 'commit', 'save', 'check in', 'stage'],
      expert: 'git',
      intent: 'git_commit',
      priority: 85,
      executionMode: 'interactive',
      description: 'Commit git changes',
      examples: ['git commit', 'commit changes', 'save to git'],
    },
    {
      name: 'git_log',
      patterns: ['git log', 'history', 'commits'],
      keywords: ['git log', 'history', 'commits', 'previous', 'changelog'],
      expert: 'git',
      intent: 'git_log',
      priority: 80,
      executionMode: 'direct',
      description: 'Show git commit history',
      examples: ['git log', 'show history', 'recent commits'],
    },
    {
      name: 'git_branch',
      patterns: ['git branch', 'branch', 'branches'],
      keywords: ['git branch', 'branch', 'checkout', 'switch', 'merge'],
      expert: 'git',
      intent: 'git_branch',
      priority: 80,
      executionMode: 'direct',
      description: 'List or manage git branches',
      examples: ['git branch', 'list branches', 'switch branch'],
    },

    // DevOps / Infrastructure
    {
      name: 'process_check',
      patterns: ['process', 'ps', 'running', 'pid', 'service'],
      keywords: ['process', 'running', 'pid', 'service', 'daemon', 'ps', 'top', 'htop'],
      expert: 'devops',
      intent: 'check_processes',
      priority: 75,
      executionMode: 'direct',
      description: 'Check running processes and services',
      examples: ['show processes', 'check services', 'ps'],
    },
    {
      name: 'network_check',
      patterns: ['network', 'ping', 'port', 'listen', 'netstat', 'ss'],
      keywords: ['network', 'ping', 'port', 'listen', 'connection', 'netstat', 'ss', 'route', 'dns', 'ip', 'ip addr', 'ifconfig', 'interface', 'traceroute', 'curl', 'wget'],
      expert: 'devops',
      intent: 'check_network',
      priority: 75,
      executionMode: 'direct',
      description: 'Run network diagnostics',
      examples: ['ping google.com', 'check ports', 'network status'],
    },
    {
      name: 'container_check',
      patterns: ['docker', 'container', 'podman', 'compose'],
      keywords: ['docker', 'container', 'podman', 'compose', 'image', 'volume'],
      expert: 'devops',
      intent: 'check_containers',
      priority: 70,
      executionMode: 'direct',
      description: 'Check container status',
      examples: ['docker ps', 'show containers', 'check docker'],
    },

    // Security
    {
      name: 'security_scan',
      patterns: ['security', 'scan', 'cve', 'vulnerability', 'audit'],
      keywords: ['security', 'scan', 'cve', 'vulnerability', 'audit', 'secrets', 'posture', 'harden'],
      expert: 'security',
      intent: 'security_scan',
      priority: 75,
      executionMode: 'direct',
      description: 'Run defensive security checks',
      examples: ['security scan', 'audit repo', 'check for secrets'],
    },

    // Project Intelligence
    {
      name: 'project_scan',
      patterns: ['scan', 'analyze', 'project', 'codebase', 'intel'],
      keywords: ['scan', 'analyze', 'project', 'codebase', 'structure', 'intel', 'overview', 'map'],
      expert: 'project',
      intent: 'scan_project',
      priority: 80,
      executionMode: 'direct',
      description: 'Analyze project structure and dependencies',
      examples: ['scan project', 'analyze codebase', 'project intel'],
    },
    {
      name: 'dependency_check',
      patterns: ['dependencies', 'deps', 'packages', 'outdated', 'vulnerabilities'],
      keywords: ['dependencies', 'deps', 'packages', 'outdated', 'npm', 'pip', 'cargo', 'update'],
      expert: 'project',
      intent: 'check_dependencies',
      priority: 75,
      executionMode: 'direct',
      description: 'Analyze project dependencies',
      examples: ['check dependencies', 'outdated packages', 'npm audit'],
    },

    // General / Fallback
    {
      name: 'chat',
      patterns: ['chat', 'talk', 'hello', 'hi', 'hey'],
      keywords: ['hello', 'hi', 'hey', 'chat', 'talk', 'question', 'how are you'],
      expert: 'general',
      intent: 'general_chat',
      priority: 50,
      executionMode: 'interactive',
      description: 'General conversation and questions',
      examples: ['hello', 'how are you', 'what is this'],
    },
    {
      name: 'fallback',
      patterns: [],
      keywords: [],
      expert: 'general',
      intent: 'fallback',
      priority: 0,
      executionMode: 'interactive',
      description: 'Fallback for unrecognized input',
      examples: [],
    },
  ];

  getAllRoutes(): RouteDefinition[] {
    return this.routes;
  }

  getRouteByName(name: string): RouteDefinition | undefined {
    return this.routes.find((r) => r.name === name);
  }

  getRoutesForExpert(expertName: string): RouteDefinition[] {
    return this.routes.filter((r) => r.expert === expertName);
  }

  getFallbackRoute(): RouteDefinition {
    return this.routes.find((r) => r.name === 'fallback')!;
  }
}
