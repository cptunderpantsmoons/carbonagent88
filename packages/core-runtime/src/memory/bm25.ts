/**
 * BM25 Index — Keyword-Based Retrieval
 *
 * Control Corridor:
 * - Owns: Inverted index construction, TF-IDF scoring, query processing
 * - Must NOT own: Embedding generation, database persistence
 *
 * Implements Okapi BM25 for keyword-based search, providing complementary
 * retrieval to vector similarity search in the hybrid retrieval system.
 */

// ---------------------------------------------------------------------------
// BM25 Configuration
// ---------------------------------------------------------------------------

export interface BM25Config {
  k1: number;        // Term frequency saturation (default 1.2)
  b: number;         // Length normalization (default 0.75)
  minTermLength: number;  // Minimum term length (default 2)
  maxTermLength: number;  // Maximum term length (default 50)
  stopWords: Set<string>; // Words to exclude
}

const DEFAULT_STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
  "as", "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "here", "there", "when", "where", "why", "how", "all", "each",
  "every", "both", "few", "more", "most", "other", "some", "such", "no",
  "nor", "not", "only", "own", "same", "so", "than", "too", "very",
  "just", "because", "but", "and", "or", "if", "while", "that", "this",
  "these", "those", "it", "its", "i", "me", "my", "myself", "we", "our",
  "you", "your", "he", "him", "his", "she", "her", "they", "them", "their",
]);

const DEFAULT_CONFIG: BM25Config = {
  k1: 1.2,
  b: 0.75,
  minTermLength: 2,
  maxTermLength: 50,
  stopWords: DEFAULT_STOP_WORDS,
};

// ---------------------------------------------------------------------------
// Document Representation
// ---------------------------------------------------------------------------

export interface BM25Document {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface BM25TermInfo {
  term: string;
  termFrequency: number;
  documentFrequency: number;
}

export interface BM25Result {
  documentId: string;
  score: number;
  terms: string[];
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// BM25 Index
// ---------------------------------------------------------------------------

export class BM25Index {
  private config: BM25Config;
  private documents: Map<string, BM25Document> = new Map();
  private invertedIndex: Map<string, Set<string>> = new Map();  // term -> doc IDs
  private termFrequencies: Map<string, Map<string, number>> = new Map();  // doc ID -> (term -> freq)
  private documentLengths: Map<string, number> = new Map();
  private averageDocumentLength: number = 0;
  private totalDocuments: number = 0;

  constructor(config: Partial<BM25Config> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ---------------------------------------------------------------------------
  // Index Management
  // ---------------------------------------------------------------------------

  /**
   * Add a document to the index.
   */
  addDocument(doc: BM25Document): void {
    const terms = this.tokenize(doc.content);
    const termCounts = this.countTerms(terms);
    const docLength = terms.length;

    this.documents.set(doc.id, doc);
    this.documentLengths.set(doc.id, docLength);
    this.termFrequencies.set(doc.id, termCounts);

    // Update inverted index
    for (const term of termCounts.keys()) {
      if (!this.invertedIndex.has(term)) {
        this.invertedIndex.set(term, new Set());
      }
      this.invertedIndex.get(term)!.add(doc.id);
    }

    this.totalDocuments++;
    this.recalculateAverageLength();
  }

  /**
   * Remove a document from the index.
   */
  removeDocument(docId: string): boolean {
    const doc = this.documents.get(docId);
    if (!doc) return false;

    const termCounts = this.termFrequencies.get(docId);
    if (termCounts) {
      for (const term of termCounts.keys()) {
        const docIds = this.invertedIndex.get(term);
        if (docIds) {
          docIds.delete(docId);
          if (docIds.size === 0) {
            this.invertedIndex.delete(term);
          }
        }
      }
    }

    this.documents.delete(docId);
    this.documentLengths.delete(docId);
    this.termFrequencies.delete(docId);

    this.totalDocuments--;
    this.recalculateAverageLength();

    return true;
  }

  /**
   * Clear the entire index.
   */
  clear(): void {
    this.documents.clear();
    this.invertedIndex.clear();
    this.termFrequencies.clear();
    this.documentLengths.clear();
    this.averageDocumentLength = 0;
    this.totalDocuments = 0;
  }

  /**
   * Get the number of documents in the index.
   */
  size(): number {
    return this.totalDocuments;
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  /**
   * Search the index using BM25 scoring.
   */
  search(query: string, limit: number = 10): BM25Result[] {
    const queryTerms = this.tokenize(query);
    const scores = new Map<string, number>();

    for (const term of queryTerms) {
      const docIds = this.invertedIndex.get(term);
      if (!docIds) continue;

      const df = docIds.size;  // Document frequency
      const idf = this.inverseDocumentFrequency(df);

      for (const docId of docIds) {
        const tf = this.termFrequencies.get(docId)?.get(term) ?? 0;
        const docLength = this.documentLengths.get(docId) ?? 0;

        const score = idf * this.termFrequencyScore(tf, docLength);
        scores.set(docId, (scores.get(docId) ?? 0) + score);
      }
    }

    // Sort by score descending
    const results: BM25Result[] = [];
    for (const [docId, score] of scores) {
      const doc = this.documents.get(docId);
      if (doc) {
        // Collect matched terms
        const matchedTerms = queryTerms.filter(t => {
          const docIds = this.invertedIndex.get(t);
          return docIds?.has(docId);
        });

        results.push({
          documentId: docId,
          score,
          terms: matchedTerms,
          metadata: doc.metadata,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Get term statistics for a document.
   */
  getDocumentTerms(docId: string): BM25TermInfo[] {
    const termCounts = this.termFrequencies.get(docId);
    if (!termCounts) return [];

    const terms: BM25TermInfo[] = [];
    for (const [term, tf] of termCounts) {
      const df = this.invertedIndex.get(term)?.size ?? 0;
      terms.push({ term, termFrequency: tf, documentFrequency: df });
    }

    return terms.sort((a, b) => b.termFrequency - a.termFrequency);
  }

  /**
   * Get index statistics.
   */
  getStats(): {
    totalDocuments: number;
    totalTerms: number;
    averageDocumentLength: number;
    vocabularySize: number;
  } {
    return {
      totalDocuments: this.totalDocuments,
      totalTerms: this.invertedIndex.size,
      averageDocumentLength: this.averageDocumentLength,
      vocabularySize: this.invertedIndex.size,
    };
  }

  // ---------------------------------------------------------------------------
  // Scoring Functions
  // ---------------------------------------------------------------------------

  /**
   * BM25 IDF (Inverse Document Frequency).
   */
  private inverseDocumentFrequency(df: number): number {
    // IDF with smoothing to avoid division by zero
    return Math.log(1 + (this.totalDocuments - df + 0.5) / (df + 0.5));
  }

  /**
   * BM25 Term Frequency score with length normalization.
   */
  private termFrequencyScore(tf: number, docLength: number): number {
    const { k1, b } = this.config;
    const normalizedLength = docLength / this.averageDocumentLength;
    return (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * normalizedLength));
  }

  // ---------------------------------------------------------------------------
  // Text Processing
  // ---------------------------------------------------------------------------

  /**
   * Tokenize text into terms.
   */
  tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')  // Replace non-word chars with space
      .split(/\s+/)              // Split on whitespace
      .filter(term =>
        term.length >= this.config.minTermLength &&
        term.length <= this.config.maxTermLength &&
        !this.config.stopWords.has(term)
      );
  }

  /**
   * Count term frequencies in a document.
   */
  private countTerms(terms: string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const term of terms) {
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * Recalculate average document length.
   */
  private recalculateAverageLength(): void {
    if (this.totalDocuments === 0) {
      this.averageDocumentLength = 0;
      return;
    }

    let totalLength = 0;
    for (const length of this.documentLengths.values()) {
      totalLength += length;
    }
    this.averageDocumentLength = totalLength / this.totalDocuments;
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  /**
   * Export index data for persistence.
   */
  exportData(): {
    documents: BM25Document[];
    invertedIndex: Array<[string, string[]]>;
    termFrequencies: Array<[string, Array<[string, number]>]>;
    documentLengths: Array<[string, number]>;
  } {
    return {
      documents: Array.from(this.documents.values()),
      invertedIndex: Array.from(this.invertedIndex.entries()).map(([term, ids]) => [term, Array.from(ids)]),
      termFrequencies: Array.from(this.termFrequencies.entries()).map(([docId, counts]) => [docId, Array.from(counts.entries())]),
      documentLengths: Array.from(this.documentLengths.entries()),
    };
  }

  /**
   * Import index data from persistence.
   */
  importData(data: {
    documents: BM25Document[];
    invertedIndex: Array<[string, string[]]>;
    termFrequencies: Array<[string, Array<[string, number]>]>;
    documentLengths: Array<[string, number]>;
  }): void {
    this.clear();

    for (const doc of data.documents) {
      this.documents.set(doc.id, doc);
    }

    for (const [term, ids] of data.invertedIndex) {
      this.invertedIndex.set(term, new Set(ids));
    }

    for (const [docId, counts] of data.termFrequencies) {
      this.termFrequencies.set(docId, new Map(counts));
    }

    for (const [docId, length] of data.documentLengths) {
      this.documentLengths.set(docId, length);
    }

    this.totalDocuments = data.documents.length;
    this.recalculateAverageLength();
  }
}

// ---------------------------------------------------------------------------
// BM25 Index Manager (for multi-workspace support)
// ---------------------------------------------------------------------------

export class BM25IndexManager {
  private indexes: Map<string, BM25Index> = new Map();
  private defaultConfig: Partial<BM25Config>;

  constructor(config: Partial<BM25Config> = {}) {
    this.defaultConfig = config;
  }

  /**
   * Get or create an index for a workspace.
   */
  getIndex(workspaceId: string): BM25Index {
    if (!this.indexes.has(workspaceId)) {
      this.indexes.set(workspaceId, new BM25Index(this.defaultConfig));
    }
    return this.indexes.get(workspaceId)!;
  }

  /**
   * Remove an index for a workspace.
   */
  removeIndex(workspaceId: string): boolean {
    const index = this.indexes.get(workspaceId);
    if (!index) return false;
    index.clear();
    return this.indexes.delete(workspaceId);
  }

  /**
   * Clear all indexes.
   */
  clearAll(): void {
    for (const index of this.indexes.values()) {
      index.clear();
    }
    this.indexes.clear();
  }

  /**
   * Get statistics for all indexes.
   */
  getAllStats(): Map<string, ReturnType<BM25Index['getStats']>> {
    const stats = new Map();
    for (const [workspaceId, index] of this.indexes) {
      stats.set(workspaceId, index.getStats());
    }
    return stats;
  }
}
