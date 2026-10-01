import { execSync } from 'node:child_process';
import fs from 'fs-extra';
import path from 'node:path';
import fg from 'fast-glob';
import { classifyUserIntent } from './intent.js';

interface IntelOptions {
  cwd?: string;
  goal?: string;
  maxFiles?: number;
}

interface CodebaseAnalysisOptions extends IntelOptions {
  depth?: 'quick' | 'standard' | 'deep';
}

const IMPORTANT_FILES = [
  'package.json',
  'config/tsconfig.json',
  'tsconfig.json',
  'vite.config.ts',
  'next.config.js',
  'next.config.mjs',
  'src/index.ts',
  'src/main.ts',
  'src/app.ts',
  'src/server.ts',
  'README.md',
  'Cargo.toml',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'Makefile',
  'Dockerfile',
  '.dockerignore',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'Chart.yaml',
  'values.yaml',
  'kustomization.yaml',
  'terraform.tf',
  'main.tf',
  'variables.tf',
  'outputs.tf',
  'terraform.tfvars',
  'ansible.cfg',
  'playbook.yml',
  'playbook.yaml',
  '.github/workflows',
  '.gitlab-ci.yml',
  'Jenkinsfile',
  'vercel.json',
  'netlify.toml',
  'wrangler.toml',
  'fly.toml',
  'nginx.conf',
  'Caddyfile',
  'haproxy.cfg',
  'traefik.yml',
  'traefik.yaml',
  'SECURITY.md',
  '.gitleaks.toml',
  '.semgrep.yml',
  '.semgrep.yaml',
  '.trivyignore',
  '.snyk',
  'osv-scanner.toml',
  'bandit.yml',
  'bandit.yaml',
];

const SOURCE_GLOBS = [
  'src/**/*.{ts,tsx,js,jsx,py,go,rs,java,cs,php,rb,swift,kt,vue,svelte}',
  'app/**/*.{ts,tsx,js,jsx,py}',
  'lib/**/*.{ts,tsx,js,jsx,py,go,rs}',
  'packages/**/*.{ts,tsx,js,jsx,py,go,rs}',
  '.github/workflows/*.{yml,yaml}',
  'deploy/**/*.{yml,yaml,json,toml,tf,sh,ps1}',
  'infra/**/*.{yml,yaml,json,toml,tf,sh,ps1}',
  'ops/**/*.{yml,yaml,json,toml,tf,sh,ps1}',
  'k8s/**/*.{yml,yaml,json}',
  'kubernetes/**/*.{yml,yaml,json}',
  'helm/**/*.{yml,yaml,tpl}',
  'charts/**/*.{yml,yaml,tpl}',
  'terraform/**/*.tf',
  'ansible/**/*.{yml,yaml,ini,cfg}',
  'network/**/*.{conf,cfg,yml,yaml,json,toml}',
  'nginx/**/*.{conf}',
  'caddy/**/*',
  'haproxy/**/*.{cfg}',
  'traefik/**/*.{yml,yaml,toml}',
  'security/**/*.{md,json,yml,yaml,toml,txt}',
  'audit/**/*.{md,json,yml,yaml,toml,txt}',
  'policies/**/*.{rego,yml,yaml,json}',
  'tests/**/*.{ts,tsx,js,jsx,py,go,rs}',
  'test/**/*.{ts,tsx,js,jsx,py,go,rs}',
  '*.{ts,tsx,js,jsx,py,go,rs}',
];

const DEFAULT_IGNORE = [
  'node_modules/**',
  '.git/**',
  'dist/**',
  'build/**',
  '.next/**',
  '.nuxt/**',
  'coverage/**',
  '.venv/**',
  'venv/**',
  '*.lock',
  '*.map',
  '*.min.js',
  '*.min.css',
];

export async function buildProjectIntel(options: IntelOptions = {}): Promise<string> {
  const cwd = options.cwd || process.cwd();
  const goal = options.goal?.trim() || 'general problem solving';
  const maxFiles = Math.max(10, Math.min(options.maxFiles || 40, 120));
  const packageInfo = await readPackageInfo(cwd);
  const files = await listImportantFiles(cwd, maxFiles);
  const recommended = recommendCommands(packageInfo);
  const focus = inferFocus(goal);

  return [
    `Project Intel (${path.basename(cwd)})`,
    `Goal: ${goal}`,
    '',
    'Recommended agent workflow:',
    '1. Use this intel packet to choose the smallest useful inspection path.',
    '2. For bugs/errors: search exact error text first, then read the smallest relevant file ranges.',
    '3. For features: identify entry points and nearby patterns before editing.',
    '4. Prefer targeted verification before full builds. Escalate only if the narrow check passes or is unavailable.',
    '5. Keep outputs small: cap searches, read ranges, summarize command output, avoid full-file dumps.',
    '',
    'Recommended commands:',
    ...recommended.map((cmd) => `- ${cmd}`),
    '',
    'Focus hints:',
    ...focus.map((hint) => `- ${hint}`),
    '',
    'Package scripts:',
    ...formatScripts(packageInfo.scripts),
    '',
    'Key files:',
    ...files.map((file) => `- ${file}`),
    '',
    'Dependency signals:',
    ...formatDeps(packageInfo),
  ].join('\n');
}

export async function buildCodebaseAnalysis(options: CodebaseAnalysisOptions = {}): Promise<string> {
  const cwd = options.cwd || process.cwd();
  const goal = options.goal?.trim() || 'understand and improve this codebase';
  const depth = options.depth || 'standard';
  const maxFiles = Math.max(20, Math.min(options.maxFiles || depthDefaultMaxFiles(depth), 180));
  const packageInfo = await readPackageInfo(cwd);
  const files = await listSourceFiles(cwd, maxFiles);
  const importantFiles = await listImportantFiles(cwd, Math.min(50, maxFiles));
  const directories = summarizeDirectories(files);
  const languages = summarizeLanguages(files);
  const entryPoints = selectEntryPoints(files, importantFiles);
  const tests = files.filter((file) => /(^|\/)(tests?|__tests__|spec)\//i.test(file) || /\.(test|spec)\./i.test(file));
  const workflows = recommendAgentWorkflow(goal, packageInfo, tests);
  const risks = inferProjectRisks(files, packageInfo);

  return [
    `Codebase Analysis (${path.basename(cwd)})`,
    `Goal: ${goal}`,
    `Depth: ${depth}`,
    '',
    'Executive summary:',
    `- Project type: ${inferProjectType(packageInfo, importantFiles)}`,
    `- Package manager: ${packageInfo.manager}`,
    `- Source files sampled: ${files.length}`,
    `- Main languages: ${languages.length ? languages.join(', ') : 'unknown'}`,
    `- Test coverage signal: ${tests.length ? `${tests.length} test/spec file${tests.length === 1 ? '' : 's'} found` : 'no obvious test files found'}`,
    '',
    'Agentic operating plan:',
    ...workflows.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Primary entry points:',
    ...formatList(entryPoints, '- none detected from common patterns'),
    '',
    'Important files:',
    ...formatList(importantFiles.slice(0, 35), '- none detected'),
    '',
    'Directory focus:',
    ...formatList(directories.map(([dir, count]) => `${dir} (${count} files)`), '- no source directories detected'),
    '',
    'Package scripts:',
    ...formatScripts(packageInfo.scripts),
    '',
    'Dependency signals:',
    ...formatDeps(packageInfo),
    '',
    'Risk and verification notes:',
    ...risks.map((risk) => `- ${risk}`),
  ].join('\n');
}

export function shouldAttachProjectIntel(input: string): boolean {
  const intent = classifyUserIntent(input);
  if (intent.kind !== 'task' && intent.kind !== 'direct-command') return false;

  const text = input.trim();
  if (!text || text.startsWith('/')) return false;
  if (text.length < 12) return false;

  const lower = text.toLowerCase();
  if (/^(what|why|how|explain|tell me|describe)\b/.test(lower) && !/(repo|code|project|bug|error|fix|implement|test|build|command|agent)/.test(lower)) {
    return false;
  }

  return /\b(fix|bug|error|fail|crash|issue|problem|implement|add|create|build|refactor|improve|advance|smart|agent|tool|command|shell|cross.?platform|windows|linux|mac|bash|cmd|powershell|test|lint|typecheck|review|analy[sz]e|codebase|repo|devops|deploy|release|rollback|docker|compose|container|k8s|kubernetes|kubectl|helm|terraform|tofu|iac|ansible|ci|pipeline|cloud|aws|gcloud|azure|vercel|netlify|wrangler|network|internet|wifi|ethernet|dns|dhcp|gateway|route|routing|latency|packet|port|socket|firewall|proxy|vpn|tcp|udp|http|tls|ssl|ping|traceroute|tracert|nslookup|dig|netstat|ss|ipconfig|ifconfig|netsh|nmap|tcpdump|tshark|cyber|cybersecurity|security|infosec|ethical\s+hacking|pentest|penetration|vulnerab|cves?|cwe|exploit|hardening|threat|forensic|incident|malware|secrets?|credential|token|sast|dast|sbom|gitleaks|trivy|semgrep|bandit|pip-audit|cargo-audit|govulncheck|osv|snyk|checkov|tfsec|hadolint|kube-linter|kubescape)\b/.test(lower);
}

export async function buildAgentInputWithProjectIntel(input: string, cwd = process.cwd()): Promise<string> {
  const intel = await buildProjectIntel({ cwd, goal: input, maxFiles: 32 });
  return [
    '<yamx_auto_project_intel>',
    intel,
    '</yamx_auto_project_intel>',
    '',
    'User request:',
    input,
  ].join('\n');
}

async function readPackageInfo(cwd: string): Promise<{
  manager: string;
  scripts: Record<string, string>;
  dependencies: string[];
  devDependencies: string[];
}> {
  const pkgPath = path.join(cwd, 'package.json');
  const manager = await detectPackageManager(cwd);
  if (!await fs.pathExists(pkgPath)) {
    return { manager, scripts: {}, dependencies: [], devDependencies: [] };
  }
  try {
    const pkg = await fs.readJSON(pkgPath);
    return {
      manager,
      scripts: pkg.scripts || {},
      dependencies: Object.keys(pkg.dependencies || {}).sort(),
      devDependencies: Object.keys(pkg.devDependencies || {}).sort(),
    };
  } catch {
    return { manager, scripts: {}, dependencies: [], devDependencies: [] };
  }
}

async function detectPackageManager(cwd: string): Promise<string> {
  if (await fs.pathExists(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await fs.pathExists(path.join(cwd, 'yarn.lock'))) return 'yarn';
  if (await fs.pathExists(path.join(cwd, 'bun.lockb'))) return 'bun';
  if (await fs.pathExists(path.join(cwd, 'package-lock.json'))) return 'npm';
  return 'unknown';
}

async function listImportantFiles(cwd: string, maxFiles: number): Promise<string[]> {
  const seen = new Set<string>();
  for (const file of IMPORTANT_FILES) {
    if (await fs.pathExists(path.join(cwd, file))) seen.add(file);
  }

  const discovered = await fg([
    'src/**/*.{ts,tsx,js,jsx,py,go,rs}',
    'app/**/*.{ts,tsx,js,jsx}',
    'lib/**/*.{ts,tsx,js,jsx,py}',
    '.github/workflows/*.{yml,yaml}',
    'deploy/**/*.{yml,yaml,json,toml,tf,sh,ps1}',
    'infra/**/*.{yml,yaml,json,toml,tf,sh,ps1}',
    'ops/**/*.{yml,yaml,json,toml,tf,sh,ps1}',
    'k8s/**/*.{yml,yaml,json}',
    'kubernetes/**/*.{yml,yaml,json}',
    'helm/**/*.{yml,yaml,tpl}',
    'charts/**/*.{yml,yaml,tpl}',
    'terraform/**/*.tf',
    'ansible/**/*.{yml,yaml,ini,cfg}',
    'network/**/*.{conf,cfg,yml,yaml,json,toml}',
    'nginx/**/*.{conf}',
    'caddy/**/*',
    'haproxy/**/*.{cfg}',
    'traefik/**/*.{yml,yaml,toml}',
    'security/**/*.{md,json,yml,yaml,toml,txt}',
    'audit/**/*.{md,json,yml,yaml,toml,txt}',
    'policies/**/*.{rego,yml,yaml,json}',
    'tests/**/*.{ts,tsx,js,jsx,py}',
    'test/**/*.{ts,tsx,js,jsx,py}',
  ], {
    cwd,
    onlyFiles: true,
    suppressErrors: true,
    ignore: ['node_modules/**', 'dist/**', 'build/**', '.git/**', 'coverage/**', '*.map'],
  });

  for (const file of discovered.sort((a, b) => scoreFile(b) - scoreFile(a))) {
    seen.add(file);
    if (seen.size >= maxFiles) break;
  }
  return [...seen].slice(0, maxFiles);
}

async function listSourceFiles(cwd: string, maxFiles: number): Promise<string[]> {
  const files = await fg(SOURCE_GLOBS, {
    cwd,
    onlyFiles: true,
    suppressErrors: true,
    ignore: DEFAULT_IGNORE,
  });

  return files
    .sort((a, b) => scoreFile(b) - scoreFile(a) || a.localeCompare(b))
    .slice(0, maxFiles);
}

/** Top source paths for offline symbol outline (same ranking as codebase analysis). */
export async function listProjectSourcePaths(cwd = process.cwd(), maxFiles = 90): Promise<string[]> {
  return listSourceFiles(cwd, Math.max(20, Math.min(maxFiles, 180)));
}

function scoreFile(file: string): number {
  let score = 0;
  if (/(index|main|app|server|cli|config|route|controller|service|agent|context|registry|tool|docker|compose|deploy|workflow|terraform|k8s|kubernetes|helm|ansible|playbook|network|nginx|caddy|haproxy|traefik|dns|proxy|gateway|firewall|security|audit|gitleaks|semgrep|trivy|snyk|bandit|policy|secret)/i.test(file)) score += 4;
  if (/test|spec/i.test(file)) score += 2;
  if (file.startsWith('src/')) score += 2;
  score -= file.split('/').length * 0.1;
  return score;
}

function recommendCommands(pkg: Awaited<ReturnType<typeof readPackageInfo>>): string[] {
  const run = pkg.manager === 'npm' ? 'npm.cmd run' : pkg.manager === 'unknown' ? 'npm run' : pkg.manager;
  const scripts = pkg.scripts;
  const out: string[] = [];

  out.push('git_status');
  out.push('shell_diagnostics if command execution fails or shell syntax is uncertain');

  for (const name of ['typecheck', 'check', 'lint', 'test', 'build']) {
    if (scripts[name]) out.push(`${run} ${name}`);
  }
  for (const name of ['doctor', 'diagnose', 'deploy', 'release']) {
    if (scripts[name]) out.push(`${run} ${name}`);
  }
  out.push('docker --version / docker compose config when Docker or compose files are involved');
  out.push('kubectl version --client / helm version for Kubernetes or Helm work; never mutate clusters without explicit user approval');
  out.push('terraform validate (or tofu validate) for IaC changes before plan/apply');
  out.push('Network diagnostics: ipconfig /all or ip addr, route print or ip route, nslookup, netstat/ss; never change firewall/routes/DNS without approval');
  out.push('Security audits: gitleaks detect, npm audit, semgrep scan, trivy fs, checkov/tfsec/hadolint when relevant; keep scans scoped to authorized local assets');
  if (!scripts.test) out.push('No test script detected; use the narrowest available build/typecheck/readback verification.');
  if (!scripts.build) out.push('No build script detected; verify with targeted command or code inspection.');
  return [...new Set(out)];
}

function depthDefaultMaxFiles(depth: CodebaseAnalysisOptions['depth']): number {
  if (depth === 'quick') return 50;
  if (depth === 'deep') return 140;
  return 90;
}

function summarizeLanguages(files: string[]): string[] {
  const labels: Record<string, string> = {
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript React',
    '.js': 'JavaScript',
    '.jsx': 'JavaScript React',
    '.py': 'Python',
    '.go': 'Go',
    '.rs': 'Rust',
    '.java': 'Java',
    '.cs': 'C#',
    '.php': 'PHP',
    '.rb': 'Ruby',
    '.vue': 'Vue',
    '.svelte': 'Svelte',
  };
  const counts = new Map<string, number>();
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const label = labels[ext] || ext || 'unknown';
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, count]) => `${label} (${count})`);
}

function summarizeDirectories(files: string[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const file of files) {
    const parts = file.split(/[\\/]/);
    const dir = parts.length > 1 ? parts.slice(0, Math.min(2, parts.length - 1)).join('/') : '.';
    counts.set(dir, (counts.get(dir) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12);
}

function selectEntryPoints(files: string[], importantFiles: string[]): string[] {
  const candidates = [...importantFiles, ...files];
  const seen = new Set<string>();
  return candidates
    .filter((file) => {
      if (seen.has(file)) return false;
      seen.add(file);
      return /(^|\/)(index|main|app|server|cli|agent|context|registry|routes?|controller|service)\.(ts|tsx|js|jsx|py|go|rs)$/i.test(file)
        || /^(package\.json|README\.md|Cargo\.toml|pyproject\.toml|go\.mod)$/i.test(file);
    })
    .slice(0, 20);
}

function recommendAgentWorkflow(
  goal: string,
  pkg: Awaited<ReturnType<typeof readPackageInfo>>,
  tests: string[]
): string[] {
  const lower = goal.toLowerCase();
  const steps = [
    'Map the nearest owning files first: entry points, registry/config, and tests before editing.',
    'Use grep_search for exact symbols, errors, and command names; read only the focused ranges that explain behavior.',
  ];

  if (/analy[sz]e|summari[sz]e|understand|codebase|architecture|review/.test(lower)) {
    steps.push('Produce an architecture summary from observed files, scripts, dependencies, and test signals; separate facts from recommendations.');
  }
  if (/fix|bug|error|fail|crash|broken/.test(lower)) {
    steps.push('Reproduce or inspect the failure, patch the root cause, then rerun the narrow failing check.');
  }
  if (/add|implement|feature|make|create|improve|power|smart|agent/.test(lower)) {
    steps.push('Follow existing local patterns, add the smallest useful capability, and avoid broad rewrites unless tests force it.');
  }

  const commandNames = Object.keys(pkg.scripts);
  const verification = ['typecheck', 'check', 'lint', 'test', 'build'].filter((name) => commandNames.includes(name));
  if (verification.length > 0) {
    steps.push(`Verify from cheapest to strongest with existing scripts: ${verification.map((name) => `${pkg.manager === 'npm' ? 'npm.cmd run' : 'npm run'} ${name}`).join(' -> ')}.`);
  } else if (tests.length > 0) {
    steps.push('No obvious package verification script was found; inspect test runner setup before claiming runtime confidence.');
  } else {
    steps.push('No obvious tests were found; use build/typecheck/readback inspection and report the verification gap clearly.');
  }

  return [...new Set(steps)].slice(0, 7);
}

function inferProjectType(pkg: Awaited<ReturnType<typeof readPackageInfo>>, importantFiles: string[]): string {
  const deps = new Set([...pkg.dependencies, ...pkg.devDependencies]);
  if (deps.has('next')) return 'Next.js app';
  if (deps.has('react')) return 'React app/library';
  if (deps.has('vue')) return 'Vue app';
  if (deps.has('express') || deps.has('fastify') || deps.has('@nestjs/core')) return 'Node.js backend';
  if (importantFiles.includes('package.json')) return 'Node.js/TypeScript project';
  if (importantFiles.includes('pyproject.toml') || importantFiles.includes('requirements.txt')) return 'Python project';
  if (importantFiles.includes('Cargo.toml')) return 'Rust project';
  if (importantFiles.includes('go.mod')) return 'Go project';
  return 'unknown';
}

function inferProjectRisks(files: string[], pkg: Awaited<ReturnType<typeof readPackageInfo>>): string[] {
  const risks: string[] = [];
  const scripts = Object.keys(pkg.scripts);
  if (!scripts.some((name) => /^(test|lint|typecheck|check|build)$/.test(name))) {
    risks.push('No standard verification script detected; confidence should come from targeted commands and code inspection.');
  }
  if (files.some((file) => /\.(test|spec)\./i.test(file)) && !scripts.includes('test')) {
    risks.push('Test files exist but no test script is exposed in package.json; verify runner wiring before relying on tests.');
  }
  if (pkg.dependencies.length + pkg.devDependencies.length > 35) {
    risks.push('Large dependency surface; prefer existing libraries and avoid adding new packages unless they remove real risk.');
  }
  if (files.some((file) => /(^|\/)(agent|tools?|registry|policy|shell)\./i.test(file))) {
    risks.push('Agent/tooling code can affect filesystem, shell, or git behavior; verify safety policy and happy-path execution after changes.');
  }
  if (risks.length === 0) {
    risks.push('No major structural risks detected from static project metadata; still verify edited behavior before declaring success.');
  }
  return risks;
}

function formatList(items: string[], empty: string): string[] {
  if (items.length === 0) return [empty];
  return items.map((item) => `- ${item}`);
}

function inferFocus(goal: string): string[] {
  const lower = goal.toLowerCase();
  const hints: string[] = [];
  if (/bug|error|fail|fix|crash|exception|stack|trace/.test(lower)) {
    hints.push('Bug path: search exact error text, inspect callers/callees, reproduce with narrow command, then patch.');
  }
  if (/command|shell|cross.?platform|windows|linux|mac|bash|cmd|powershell/.test(lower)) {
    hints.push('Command path: inspect shell utilities, command parser, policy/risk, and tests around platform syntax.');
  }
  if (/test|build|lint|type|verify|check/.test(lower)) {
    hints.push('Verification path: run the smallest named script first; avoid full test suites until needed.');
  }
  if (/devops|deploy|release|rollback|docker|compose|container|k8s|kubernetes|kubectl|helm|terraform|tofu|iac|ansible|ci|pipeline|cloud|aws|gcloud|azure|vercel|netlify|wrangler/.test(lower)) {
    hints.push('DevOps path: inspect manifests and local CLI versions first; prefer validate/config/dry-run/client-version commands before any apply/deploy/push.');
  }
  if (/network|internet|wifi|ethernet|dns|dhcp|gateway|route|routing|latency|packet|port|socket|firewall|proxy|vpn|tcp|udp|http|tls|ssl|ping|traceroute|tracert|nslookup|dig|netstat|ss|ipconfig|ifconfig|netsh|nmap|tcpdump|tshark/.test(lower)) {
    hints.push('Network path: inspect interfaces, routes, DNS, listening sockets, and targeted reachability first; avoid firewall/route/DNS changes without explicit approval.');
  }
  if (/cyber|cybersecurity|security|infosec|ethical\s+hacking|pentest|penetration|vulnerab|cves?|cwe|exploit|hardening|threat|forensic|incident|malware|secrets?|credential|token|sast|dast|sbom|gitleaks|trivy|semgrep|bandit|pip-audit|cargo-audit|govulncheck|osv|snyk|checkov|tfsec|hadolint|kube-linter|kubescape/.test(lower)) {
    hints.push('Security path: confirm authorized scope, inspect local code/config/deps/secrets safely, run scoped audit tools, then propose remediation without exploit/persistence steps.');
  }
  if (/feature|add|implement|make|create/.test(lower)) {
    hints.push('Feature path: find existing pattern, edit the closest owning module, add focused tests.');
  }
  if (hints.length === 0) hints.push('General path: map entry points, search relevant identifiers, read focused ranges, then decide.');
  return hints;
}

function formatScripts(scripts: Record<string, string>): string[] {
  const entries = Object.entries(scripts);
  if (entries.length === 0) return ['- none detected'];
  return entries.map(([name, script]) => `- ${name}: ${script}`);
}

function formatDeps(pkg: Awaited<ReturnType<typeof readPackageInfo>>): string[] {
  const deps = [...pkg.dependencies, ...pkg.devDependencies];
  if (deps.length === 0) return ['- none detected'];
  return deps.slice(0, 30).map((dep) => `- ${dep}`);
}

const CODING_TURN = /\b(write|edit|add|fix|debug|implement|create|patch|refactor|change|bug|error|fail(?:ing|ure|ed)?)\b/i;

/** Write, edit, fix, or debug asks. Greetings and bare shell lines are not coding turns. */
export function isCodingTurn(input: string): boolean {
  const text = input.trim();
  if (!text || text.startsWith('/')) return false;
  const intent = classifyUserIntent(text);
  if (intent.kind === 'conversation' || intent.kind === 'clarification' || intent.kind === 'empty' || intent.kind === 'direct-command') {
    return false;
  }
  if (/\bexplain\b/i.test(text) && /\b(fail|error|bug|exception|stack)\b/i.test(text)) return true;
  return CODING_TURN.test(text);
}

export function wrapCodingBrief(brief: string, request: string): string {
  return [
    '<yamx_auto_project_intel>',
    brief.trim(),
    '</yamx_auto_project_intel>',
    '',
    'User request:',
    request,
  ].join('\n');
}

export function extractCodingBrief(input: string): string | undefined {
  const match = input.match(/<yamx_auto_project_intel>([\s\S]*?)<\/yamx_auto_project_intel>/);
  const brief = match?.[1]?.trim();
  return brief || undefined;
}

let pendingCodingBrief: { request: string; brief: string } | null = null;

export function savePendingCodingBrief(request: string, brief: string): void {
  pendingCodingBrief = { request, brief };
}

export function consumePendingCodingBrief(): { request: string; brief: string } | null {
  const saved = pendingCodingBrief;
  pendingCodingBrief = null;
  return saved;
}

function gitSnapshot(cwd: string): { branch: string; dirty: string } {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const status = execSync('git status --short', {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return { branch: branch || 'unknown', dirty: status ? 'dirty' : 'clean' };
  } catch {
    return { branch: 'not a git repo', dirty: 'unknown' };
  }
}

function scriptLines(scripts: Record<string, string>): string[] {
  const wanted = Object.entries(scripts).filter(([name]) => /test|lint|build|typecheck|check/i.test(name));
  if (wanted.length === 0) return ['- none detected'];
  return wanted.slice(0, 12).map(([name, script]) => `- ${name}: ${script}`);
}

function filesNamedInText(text: string): string[] {
  const found = text.match(/[A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|json|md)/g) || [];
  return [...new Set(found.map((file) => file.replace(/\\/g, '/')))].slice(0, 12);
}

/** Local facts for a coding turn. No model call. */
export async function buildCodingBrief(input: string, cwd = process.cwd()): Promise<string> {
  const root = path.resolve(cwd);
  const packageInfo = await readPackageInfo(root);
  const hasManifest = await fs.pathExists(path.join(root, 'package.json'));
  const files = await listImportantFiles(root, 24);
  const git = gitSnapshot(root);
  const mentioned = filesNamedInText(input);
  const errorClip = input.trim().slice(0, 1500);
  return [
    `Project path: ${root}`,
    `Working directory: ${root}`,
    `OS: ${process.platform}`,
    `Shell: ${process.env.SHELL || process.env.ComSpec || 'unknown'}`,
    `Package manager: ${packageInfo.manager}`,
    `Manifest: ${hasManifest ? 'package.json' : 'none'}`,
    `Git branch: ${git.branch}`,
    `Git tree: ${git.dirty}`,
    'Test, lint, and build scripts:',
    ...scriptLines(packageInfo.scripts),
    'Entry and key files:',
    ...(files.length ? files.map((file) => `- ${file}`) : ['- none detected']),
    'Files named in the request:',
    ...(mentioned.length ? mentioned.map((file) => `- ${file}`) : ['- none']),
    'Request text:',
    errorClip || '- empty',
  ].join('\n');
}
