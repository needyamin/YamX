/**
 * YamX - Local Embedding Engine
 * Lightweight text similarity using TF-IDF vectors.
 * Future: can be upgraded to ONNX embeddings without changing the interface.
 */

export interface VectorEmbedding {
  values: number[];
  magnitude: number;
}

export class EmbeddingEngine {
  private idfCache: Map<string, number> = new Map();
  private documentCount = 0;

  /**
   * Compute TF-IDF vectors for a set of documents.
   * Returns a function that can vectorize new queries against the same IDF space.
   */
  fitTransform(documents: string[]): (text: string) => VectorEmbedding {
    this.documentCount = documents.length;
    const tokenizedDocs = documents.map((d) => this.tokenize(d));

    // Compute IDF for each term
    const docFreq = new Map<string, number>();
    for (const tokens of tokenizedDocs) {
      const unique = new Set(tokens);
      for (const term of unique) {
        docFreq.set(term, (docFreq.get(term) || 0) + 1);
      }
    }

    this.idfCache.clear();
    for (const [term, df] of docFreq) {
      const idf = Math.log((1 + this.documentCount) / (1 + df)) + 1;
      this.idfCache.set(term, idf);
    }

    // Return vectorizer function
    return (text: string) => this.vectorize(text);
  }

  vectorize(text: string): VectorEmbedding {
    const tokens = this.tokenize(text);
    const tf = this.computeTF(tokens);
    const values: number[] = [];
    const terms = Array.from(this.idfCache.keys()).sort();

    for (const term of terms) {
      const idf = this.idfCache.get(term) || 1;
      values.push((tf.get(term) || 0) * idf);
    }

    const magnitude = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
    return { values, magnitude };
  }

  cosineSimilarity(a: VectorEmbedding, b: VectorEmbedding): number {
    if (a.magnitude === 0 || b.magnitude === 0) return 0;

    let dot = 0;
    const len = Math.min(a.values.length, b.values.length);
    for (let i = 0; i < len; i++) {
      dot += a.values[i] * b.values[i];
    }

    return dot / (a.magnitude * b.magnitude);
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }

  private computeTF(tokens: string[]): Map<string, number> {
    const freq = new Map<string, number>();
    for (const token of tokens) {
      freq.set(token, (freq.get(token) || 0) + 1);
    }

    const maxFreq = Math.max(...freq.values(), 1);
    const tf = new Map<string, number>();
    for (const [term, count] of freq) {
      tf.set(term, count / maxFreq);
    }
    return tf;
  }
}

export const defaultEmbedding = new EmbeddingEngine();
