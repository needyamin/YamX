/**
 * YamX - Parameter Extractor
 * Regex-based extraction of common entities from user input.
 * Converts raw strings into structured params for experts.
 */

import { RouteDefinition } from './routes.js';

export interface ExtractedEntity {
  type: 'file_path' | 'url' | 'port' | 'ip' | 'git_ref' | 'package_name' | 'command' | 'number' | 'boolean';
  value: string | number | boolean;
  raw: string;
}

export class ParamExtractor {
  private patterns: Record<string, RegExp[]> = {
    file_path: [
      /(?:file|path|in|at|to|from)\s+['"]?([\w\-./\\]+\.[\w]+)['"]?/gi,
      /['"]?([\w\-./\\]+\.(?:ts|js|json|md|txt|py|rs|go|yml|yaml|xml|html|css|sh))['"]?/gi,
      /\b([\w\-./\\]+\/[\w\-./\\]+)\b/g,
    ],
    url: [
      /(https?:\/\/[^\s"]+)/gi,
      /(ftp:\/\/[^\s"]+)/gi,
    ],
    port: [
      /(?:port|on)\s+(\d{2,5})/gi,
      /:(\d{2,5})\b/g,
    ],
    ip: [
      /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g,
    ],
    git_ref: [
      /(?:branch|tag|commit)\s+['"]?([\w\-./]+)['"]?/gi,
    ],
    package_name: [
      /(?:package|install|npm install|pip install)\s+['"]?(@?[\w\-@/]+)['"]?/gi,
    ],
    number: [
      /\b(\d+)\b/g,
    ],
  };

  extract(input: string, route: RouteDefinition): Record<string, any> {
    const params: Record<string, any> = {};
    const normalized = input.trim();

    // Route-specific extraction
    switch (route.expert) {
      case 'filesystem':
        this.extractFilesystemParams(normalized, params);
        break;
      case 'shell':
        this.extractShellParams(normalized, params);
        break;
      case 'git':
        this.extractGitParams(normalized, params);
        break;
      case 'web':
        this.extractWebParams(normalized, params);
        break;
      case 'devops':
        this.extractDevopsParams(normalized, params);
        break;
      case 'project':
        this.extractProjectParams(normalized, params);
        break;
      default:
        break;
    }

    // Generic entity extraction
    const entities = this.extractEntities(normalized);
    if (entities.length > 0) {
      params['_entities'] = entities;
    }

    return params;
  }

  private extractFilesystemParams(input: string, params: Record<string, any>): void {
    // Try to find a file path
    const fileMatch = input.match(/['"]?([\w\-./\\]+\.[\w]+)['"]?/);
    if (fileMatch) {
      params['path'] = fileMatch[1];
    }

    // Detect recursive flag
    if (/\b(recursive|recursively|all|deep)\b/i.test(input)) {
      params['recursive'] = true;
    }

    // Detect dry run
    if (/\b(dry.run|dry-run|preview|pretend|simulate)\b/i.test(input)) {
      params['dry_run'] = true;
    }

    // Detect search pattern
    const patternMatch = input.match(/(?:for|pattern|matching|like)\s+['"]?([^'"\s]+)['"]?/i);
    if (patternMatch) {
      params['pattern'] = patternMatch[1];
    }

    // Detect old_text / new_text for edits
    const replaceMatch = input.match(/(?:replace|change)\s+['"]?(.+?)['"]?\s+(?:with|to)\s+['"]?(.+?)['"]?/i);
    if (replaceMatch) {
      params['old_text'] = replaceMatch[1];
      params['new_text'] = replaceMatch[2];
    }
  }

  private extractShellParams(input: string, params: Record<string, any>): void {
    // Extract command after "run", "exec", "shell"
    const cmdMatch = input.match(/^(?:run|exec|execute|shell|cmd)\s+(.+)$/i);
    if (cmdMatch) {
      params['command'] = cmdMatch[1].trim();
    } else {
      params['command'] = input.trim();
    }

    // Background flag
    if (/\b(background|bg|async|detached)\b/i.test(input)) {
      params['background'] = true;
    }

    // Timeout
    const timeoutMatch = input.match(/(?:timeout|for)\s+(\d+)\s*(?:s|sec|seconds)?/i);
    if (timeoutMatch) {
      params['timeout'] = parseInt(timeoutMatch[1], 10) * 1000;
    }
  }

  private extractGitParams(input: string, params: Record<string, any>): void {
    // Branch name
    const branchMatch = input.match(/(?:branch|checkout|switch)\s+['"]?([\w\-./]+)['"]?/i);
    if (branchMatch) {
      params['branch'] = branchMatch[1];
    }

    // Commit message
    const msgMatch = input.match(/(?:commit|message)\s+['"](.+)['"]/i);
    if (msgMatch) {
      params['message'] = msgMatch[1];
    }

    // File path for git diff
    const fileMatch = input.match(/(?:diff|status|add)\s+['"]?([\w\-./\\]+\.[\w]+)['"]?/i);
    if (fileMatch) {
      params['path'] = fileMatch[1];
    }
  }

  private extractWebParams(input: string, params: Record<string, any>): void {
    const portMatch = input.match(/(?:port|:)\s*(\d{2,5})/);
    if (portMatch) {
      params['port'] = parseInt(portMatch[1], 10);
    }

    const hostMatch = input.match(/(?:host|bind|address)\s+['"]?([\d.]+)['"]?/i);
    if (hostMatch) {
      params['host'] = hostMatch[1];
    }

    if (/\b(dangerous|unsafe|all-interfaces)\b/i.test(input)) {
      params['allowDangerous'] = true;
    }
  }

  private extractDevopsParams(input: string, params: Record<string, any>): void {
    const portMatch = input.match(/(?:port|:)\s*(\d{2,5})/);
    if (portMatch) {
      params['port'] = parseInt(portMatch[1], 10);
    }

    const hostMatch = input.match(/(?:host|server|target)\s+['"]?([\w.\-]+)['"]?/i);
    if (hostMatch) {
      params['host'] = hostMatch[1];
    }

    // Service name
    const serviceMatch = input.match(/(?:service|process)\s+['"]?([\w\-]+)['"]?/i);
    if (serviceMatch) {
      params['service'] = serviceMatch[1];
    }
  }

  private extractProjectParams(input: string, params: Record<string, any>): void {
    const pathMatch = input.match(/(?:in|at|path|dir)\s+['"]?([\w\-./\\]+)['"]?/i);
    if (pathMatch) {
      params['path'] = pathMatch[1];
    }
  }

  extractEntities(input: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];
    const seen = new Set<string>();

    for (const [type, regexes] of Object.entries(this.patterns)) {
      for (const regex of regexes) {
        const matches = input.matchAll(regex);
        for (const match of matches) {
          const raw = match[0];
          const value = match[1] ?? raw;
          const key = `${type}:${value}`;
          if (seen.has(key)) continue;
          seen.add(key);

          let parsedValue: string | number | boolean = value;
          if (type === 'port' || type === 'number') {
            const n = parseInt(value, 10);
            if (!Number.isNaN(n)) parsedValue = n;
          }

          entities.push({
            type: type as ExtractedEntity['type'],
            value: parsedValue,
            raw,
          });
        }
      }
    }

    return entities;
  }
}
