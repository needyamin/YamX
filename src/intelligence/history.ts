/**
 * YamX - Command History Tracker
 * Tracks command -> expert -> success/failure for routing confidence boosting.
 * Persists to ~/.ymax/intelligence-history.json
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';

export interface CommandHistory {
  timestamp: number;
  input: string;
  intent: string;
  expert: string;
  success: boolean;
  durationMs: number;
}

export interface HistoryEntry {
  count: number;
  successes: number;
  failures: number;
  lastUsed: number;
}

export class HistoryTracker {
  private dataDir: string;
  private historyPath: string;
  private memoryPath: string;
  private cache: Map<string, HistoryEntry> = new Map();
  private loaded = false;

  constructor() {
    this.dataDir = path.join(os.homedir(), '.ymax');
    this.historyPath = path.join(this.dataDir, 'intelligence-history.json');
    this.memoryPath = path.join(process.cwd(), '.ymax', 'command-memory.json');
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await this.load();
    this.loaded = true;
  }

  async load(): Promise<void> {
    // Load from ~/.ymax/intelligence-history.json
    try {
      if (await fs.pathExists(this.historyPath)) {
        const data = await fs.readJSON(this.historyPath);
        for (const [key, val] of Object.entries(data)) {
          this.cache.set(key, val as HistoryEntry);
        }
      }
    } catch {
      // ignore corrupt history
    }

    // Also load legacy .ymax/command-memory.json if present
    try {
      if (await fs.pathExists(this.memoryPath)) {
        const data = await fs.readJSON(this.memoryPath);
        if (data && typeof data === 'object') {
          for (const [key, val] of Object.entries(data)) {
            if (!this.cache.has(key)) {
              this.cache.set(key, this.normalizeEntry(val));
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  async save(): Promise<void> {
    await fs.ensureDir(this.dataDir);
    const data: Record<string, HistoryEntry> = {};
    for (const [key, val] of this.cache) {
      data[key] = val;
    }
    await fs.writeJSON(this.historyPath, data, { spaces: 2 });
  }

  async record(record: CommandHistory): Promise<void> {
    await this.ensureLoaded();
    const key = record.intent;
    const existing = this.cache.get(key) || { count: 0, successes: 0, failures: 0, lastUsed: 0 };

    existing.count += 1;
    existing.lastUsed = Date.now();
    if (record.success) existing.successes += 1;
    else existing.failures += 1;

    this.cache.set(key, existing);
    await this.save();
  }

  async getWeights(): Promise<Record<string, number>> {
    await this.ensureLoaded();
    const weights: Record<string, number> = {};

    for (const [intent, entry] of this.cache) {
      const successRate = entry.count > 0 ? entry.successes / entry.count : 0.5;
      const recency = Math.max(0, 1 - (Date.now() - entry.lastUsed) / (30 * 24 * 60 * 60 * 1000));
      weights[intent] = successRate * 0.7 + recency * 0.3;
    }

    return weights;
  }

  async getTopCommands(limit = 10): Promise<{ intent: string; count: number }[]> {
    await this.ensureLoaded();
    const sorted = Array.from(this.cache.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, limit)
      .map(([intent, entry]) => ({ intent, count: entry.count }));
    return sorted;
  }

  private normalizeEntry(val: unknown): HistoryEntry {
    if (typeof val === 'object' && val !== null) {
      const v = val as Record<string, unknown>;
      return {
        count: Number(v.count) || 0,
        successes: Number(v.successes) || 0,
        failures: Number(v.failures) || 0,
        lastUsed: Number(v.lastUsed) || 0,
      };
    }
    return { count: 0, successes: 0, failures: 0, lastUsed: 0 };
  }
}
