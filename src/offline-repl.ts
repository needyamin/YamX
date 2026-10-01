/**
 * Offline turn for the yamx REPL when no model is connected.
 * Uses the same router and domain experts as ymax.
 */

import chalk from 'chalk';
import { YamConfig } from './config/index.js';
import { expertRegistry } from './experts/registry.js';
import { Router, type RouteRequest } from './router/index.js';
import './experts/general.js';
import './experts/filesystem.js';
import './experts/shell.js';
import './experts/git.js';
import './experts/devops.js';
import './experts/security.js';
import './experts/project.js';
import './experts/web.js';

const router = new Router();

export async function runOfflineIntelligence(input: string, cfg: YamConfig): Promise<void> {
  const request: RouteRequest = {
    source: 'repl',
    rawInput: input,
    cwd: process.cwd(),
    userConfig: cfg,
  };
  const route = await router.dispatch(request);
  const expert = expertRegistry.resolve(route);
  const result = await expert.execute(route.intent, route.params, {
    cwd: process.cwd(),
    userConfig: cfg,
  });

  if (route.confidence < 1) {
    console.log(chalk.dim(`  ${expert.domain} · ${route.intent}`));
  }

  const text = typeof result.output === 'string' ? result.output : JSON.stringify(result.output, null, 2);
  if (text.trim()) console.log(text);
  if (result.followUpIntents && result.followUpIntents.length > 0) {
    console.log(chalk.dim(`\n  Suggested: ${result.followUpIntents.join(', ')}`));
  }
}
