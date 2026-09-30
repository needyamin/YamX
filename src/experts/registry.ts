/**
 * YamX - Expert Registry
 * Central registry for all expert modules. Self-registration pattern.
 */

import { BaseExpert } from './base.js';
import { RouteResult } from '../router/index.js';

export class ExpertRegistry {
  private static instance: ExpertRegistry;
  private experts: Map<string, BaseExpert> = new Map();

  static getInstance(): ExpertRegistry {
    if (!ExpertRegistry.instance) {
      ExpertRegistry.instance = new ExpertRegistry();
    }
    return ExpertRegistry.instance;
  }

  register(expert: BaseExpert): void {
    if (this.experts.has(expert.name)) {
      console.warn(`Expert "${expert.name}" is already registered. Overwriting.`);
    }
    this.experts.set(expert.name, expert);
  }

  unregister(name: string): boolean {
    return this.experts.delete(name);
  }

  resolve(routeResult: RouteResult): BaseExpert {
    const expert = this.experts.get(routeResult.expert);
    if (!expert) {
      throw new Error(`Unknown expert: "${routeResult.expert}". Available: ${this.listNames().join(', ')}`);
    }
    return expert;
  }

  get(name: string): BaseExpert | undefined {
    return this.experts.get(name);
  }

  listNames(): string[] {
    return Array.from(this.experts.keys());
  }

  listAll(): BaseExpert[] {
    return Array.from(this.experts.values());
  }

  getCapabilities(): Record<string, string[]> {
    const caps: Record<string, string[]> = {};
    for (const expert of this.experts.values()) {
      caps[expert.name] = expert.capabilities;
    }
    return caps;
  }
}

export const expertRegistry = ExpertRegistry.getInstance();
