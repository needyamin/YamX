/**
 * YamX - Offline Intent Classifier
 * Three-tier classification: exact match -> keyword scoring -> fuzzy + history boost.
 * Zero API calls. Purely local.
 */

import { RouteTable, RouteDefinition } from './routes.js';
import { HistoryTracker } from '../intelligence/history.js';

export interface ClassifiedRoute {
  route: RouteDefinition;
  score: number;
}

export interface IntentClassification {
  topMatch: ClassifiedRoute;
  candidates: ClassifiedRoute[];
  method: 'exact' | 'keyword' | 'fuzzy' | 'fallback';
}

export class IntentClassifier {
  private routeTable: RouteTable;
  private history: HistoryTracker;

  constructor(routeTable: RouteTable) {
    this.routeTable = routeTable;
    this.history = new HistoryTracker();
  }

  async classify(input: string, source?: string): Promise<IntentClassification> {
    const normalized = input.toLowerCase().trim();
    const tokens = this.tokenize(normalized);
    const routes = this.routeTable.getAllRoutes().filter((r) => r.name !== 'fallback');

    // Tier 1: Exact pattern match
    const exact = this.exactMatch(normalized, tokens, routes);
    if (exact) {
      return {
        topMatch: exact,
        candidates: [exact],
        method: 'exact',
      };
    }

    // Tier 2: Keyword scoring with TF-IDF-style weights
    const keywordMatches = this.keywordScore(normalized, tokens, routes);
    if (keywordMatches.length > 0 && keywordMatches[0].score >= 0.6) {
      return {
        topMatch: keywordMatches[0],
        candidates: keywordMatches.slice(0, 5),
        method: 'keyword',
      };
    }

    // Tier 3: Fuzzy distance + history boost
    const fuzzyMatches = this.fuzzyMatch(normalized, tokens, routes);
    const historyBoosted = await this.applyHistoryBoost(fuzzyMatches);

    if (historyBoosted.length > 0 && historyBoosted[0].score >= 0.4) {
      return {
        topMatch: historyBoosted[0],
        candidates: historyBoosted.slice(0, 5),
        method: 'fuzzy',
      };
    }

    // Fallback
    const fallback = this.routeTable.getFallbackRoute();
    return {
      topMatch: { route: fallback, score: 0.0 },
      candidates: [],
      method: 'fallback',
    };
  }

  private tokenize(text: string): string[] {
    return text
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 0);
  }

  private exactMatch(
    normalized: string,
    tokens: string[],
    routes: RouteDefinition[]
  ): ClassifiedRoute | undefined {
    for (const route of routes) {
      // Direct pattern match
      for (const pattern of route.patterns) {
        const p = pattern.toLowerCase();
        if (normalized === p || normalized.startsWith(p + ' ')) {
          return { route, score: 1.0 };
        }
      }

      // First token exact match for high-priority routes
      if (tokens.length > 0) {
        for (const pattern of route.patterns) {
          if (tokens[0] === pattern.toLowerCase()) {
            return { route, score: 0.95 };
          }
        }
      }
    }
    return undefined;
  }

  private keywordScore(
    normalized: string,
    tokens: string[],
    routes: RouteDefinition[]
  ): ClassifiedRoute[] {
    const scores: ClassifiedRoute[] = [];

    for (const route of routes) {
      let score = 0;
      const keywordSet = route.keywords.map((k) => k.toLowerCase());

      // Full keyword phrase matches get high weight
      for (const kw of keywordSet) {
        if (normalized.includes(kw)) {
          score += kw.split(/\s+/).length * 0.25;
        }
      }

      // Token overlap — require whole-word match for short tokens to avoid false positives like "ip" matching "pip"
      const matchedTokens = tokens.filter((t) =>
        keywordSet.some((kw) => {
          if (t.length <= 2) {
            // Short tokens must match exactly as a whole word
            return kw === t || kw.split(/\s+/).includes(t);
          }
          // Longer tokens can use substring matching
          return kw.includes(t) || t.includes(kw);
        })
      );
      score += matchedTokens.length * 0.15;

      // Priority bonus (scaled down so it doesn't dominate)
      score += (route.priority / 100) * 0.1;

      // Normalize by token count to avoid long inputs always scoring higher
      score = score / (1 + tokens.length * 0.05);

      if (score > 0.2) {
        scores.push({ route, score: Math.min(score, 1.0) });
      }
    }

    return scores.sort((a, b) => b.score - a.score);
  }

  private fuzzyMatch(
    normalized: string,
    _tokens: string[],
    routes: RouteDefinition[]
  ): ClassifiedRoute[] {
    const scores: ClassifiedRoute[] = [];

    for (const route of routes) {
      let minDist = Infinity;
      let bestMatchLen = normalized.length;

      // Check distance against patterns
      for (const pattern of route.patterns) {
        const p = pattern.toLowerCase();
        const dist = this.levenshtein(normalized, p);
        if (dist < minDist) {
          minDist = dist;
          bestMatchLen = Math.max(normalized.length, p.length);
        }
      }

      // Check distance against keywords
      for (const kw of route.keywords) {
        const k = kw.toLowerCase();
        const dist = this.levenshtein(normalized, k);
        if (dist < minDist) {
          minDist = dist;
          bestMatchLen = Math.max(normalized.length, k.length);
        }
      }

      // Convert distance to similarity score using the ACTUAL matched string length
      const similarity = bestMatchLen === 0 ? 1 : 1 - minDist / bestMatchLen;

      if (similarity > 0.3) {
        scores.push({ route, score: similarity });
      }
    }

    return scores.sort((a, b) => b.score - a.score);
  }

  private async applyHistoryBoost(matches: ClassifiedRoute[]): Promise<ClassifiedRoute[]> {
    const historyWeights = await this.history.getWeights();

    return matches
      .map((m) => {
        const boost = historyWeights[m.route.intent] || 0;
        return {
          route: m.route,
          score: Math.min(m.score + boost * 0.15, 1.0),
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  private levenshtein(a: string, b: string): number {
    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        matrix[i][j] =
          b[i - 1] === a[j - 1]
            ? matrix[i - 1][j - 1]
            : Math.min(
                matrix[i - 1][j - 1] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j] + 1
              );
      }
    }
    return matrix[b.length][a.length];
  }
}
