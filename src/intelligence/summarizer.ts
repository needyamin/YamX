/**
 * YamX - Rule-Based Output Summarizer
 * Truncates and summarizes tool outputs without using any LLM.
 * Uses heuristics to find logical breakpoints and extract key lines.
 */

export class RuleBasedSummarizer {
  summarize(output: string, maxChars: number): string {
    if (!output || output.length <= maxChars) {
      return output;
    }

    // Strategy 1: If output contains errors, prioritize error lines
    const errorLines = this.extractErrorLines(output);
    if (errorLines.length > 0) {
      const errorBlock = errorLines.join('\n');
      if (errorBlock.length <= maxChars) {
        return `${errorBlock}\n\n...[${output.length - errorBlock.length} more chars]...`;
      }
    }

    // Strategy 2: Find a good truncation point near maxChars
    const truncation = this.findTruncationPoint(output, maxChars);
    return `${truncation}\n\n...[truncated ${output.length - truncation.length} chars]...`;
  }

  private extractErrorLines(output: string): string[] {
    const lines = output.split('\n');
    const errorPatterns = [
      /error[:\s]/i,
      /exception[:\s]/i,
      /failed[:\s]/i,
      /cannot\s/i,
      /unable\s/i,
      /fatal[:\s]/i,
      /traceback/i,
      /\bat\s+.+:\d+\)?/i,
    ];

    return lines.filter((line) => errorPatterns.some((p) => p.test(line)));
  }

  private findTruncationPoint(output: string, maxChars: number): string {
    // Try to break at a newline near the limit
    const searchStart = Math.max(0, maxChars - 500);
    const searchEnd = Math.min(output.length, maxChars + 100);
    const slice = output.slice(searchStart, searchEnd);

    // Find last newline before maxChars
    const lastNewline = slice.lastIndexOf('\n');
    if (lastNewline > 0) {
      return output.slice(0, searchStart + lastNewline);
    }

    // Try sentence boundary
    const sentenceEnd = slice.match(/[.!?]\s+/);
    if (sentenceEnd && sentenceEnd.index !== undefined) {
      return output.slice(0, searchStart + sentenceEnd.index + 2);
    }

    // Hard cut
    return output.slice(0, maxChars);
  }

  extractMetrics(output: string): Record<string, string> {
    const metrics: Record<string, string> = {};
    const patterns: [RegExp, string][] = [
      [/([\d,]+)\s*(?:tests?|specs?)/i, 'tests'],
      [/([\d,]+)\s*passing/i, 'passing'],
      [/([\d,]+)\s*failing/i, 'failing'],
      [/([\d,]+)\s*warnings?/i, 'warnings'],
      [/([\d,]+)\s*errors?/i, 'errors'],
      [/coverage[:\s]+([\d.]+%)/i, 'coverage'],
      [/time[:\s]+([\d.]+\s*(?:ms|s|sec))/i, 'time'],
      [/size[:\s]+([\d.]+\s*(?:B|KB|MB|GB))/i, 'size'],
    ];

    for (const [regex, key] of patterns) {
      const match = output.match(regex);
      if (match) metrics[key] = match[1];
    }

    return metrics;
  }
}
