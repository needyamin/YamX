/**
 * YamX - AI Orchestrator
 * Decides whether to use AI for a given request.
 * Rules:
 *   - If no AI provider is available → skip AI, use local intelligence.
 *   - If user explicitly requests AI → use AI if available.
 *   - If task is simple (exact command match) → skip AI for speed.
 *   - If task is complex and AI is available → augment local classification with AI.
 *
 * This is the only place that knows about AI. Router and experts remain AI-agnostic.
 */

import { AiProvider } from './interface.js';
import { NullProvider } from './null-provider.js';
import { IntelligenceEngine } from '../intelligence/index.js';

export interface OrchestratorDecision {
  useAi: boolean;
  provider: AiProvider;
  reason: string;
}

export class AiOrchestrator {
  private providers: AiProvider[] = [];
  private nullProvider: NullProvider;
  private intelligence: IntelligenceEngine;

  constructor() {
    this.nullProvider = new NullProvider();
    this.intelligence = new IntelligenceEngine();
  }

  registerProvider(provider: AiProvider): void {
    this.providers.push(provider);
  }

  async decide(input: string, intentConfidence: number, forceAi = false): Promise<OrchestratorDecision> {
    // Check which providers are actually available
    const available = await Promise.all(
      this.providers.map(async (p) => ({ provider: p, available: await p.isAvailable() }))
    );
    const readyProviders = available.filter((a) => a.available).map((a) => a.provider);

    // No AI available → always offline
    if (readyProviders.length === 0) {
      return {
        useAi: false,
        provider: this.nullProvider,
        reason: 'No AI providers available (offline mode)',
      };
    }

    // User explicitly forced AI
    if (forceAi) {
      return {
        useAi: true,
        provider: readyProviders[0],
        reason: 'User explicitly requested AI assistance',
      };
    }

    // High local confidence → skip AI for speed
    if (intentConfidence >= 0.85) {
      return {
        useAi: false,
        provider: this.nullProvider,
        reason: 'Local intent confidence is high; skipping AI for speed',
      };
    }

    // Low local confidence but AI available → augment with AI
    if (intentConfidence < 0.5 && readyProviders.length > 0) {
      return {
        useAi: true,
        provider: readyProviders[0],
        reason: 'Local confidence is low; augmenting with AI',
      };
    }

    // Medium confidence → use AI only for complex queries
    const isComplex = this.isComplexQuery(input);
    if (isComplex) {
      return {
        useAi: true,
        provider: readyProviders[0],
        reason: 'Complex query detected; using AI for better reasoning',
      };
    }

    // Default: stay offline
    return {
      useAi: false,
      provider: this.nullProvider,
      reason: 'Simple query; local routing is sufficient',
    };
  }

  private isComplexQuery(input: string): boolean {
    const indicators = [
      /explain/i,
      /why\s+does/i,
      /how\s+to/i,
      /what\s+is/i,
      /compare/i,
      /analyze/i,
      /debug/i,
      /refactor/i,
      /optimize/i,
      /and\s+then/i,
      /after\s+that/i,
    ];

    return indicators.some((re) => re.test(input));
  }

  getActiveProviders(): AiProvider[] {
    return this.providers;
  }

  clearProviders(): void {
    this.providers = [];
  }
}

export const defaultOrchestrator = new AiOrchestrator();
