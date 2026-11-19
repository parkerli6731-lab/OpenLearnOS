import type {
  DocumentChunk,
  EvalCase,
  HybridRetrieverContract,
  RetrievalEvalReport,
  RetrievalHit,
} from "@openlearnos/contracts";

function tokenizeBilingual(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens: string[] = [];
  const latinMatches = lower.match(/[a-z0-9_]+/g);
  if (latinMatches) tokens.push(...latinMatches);

  // Add CJK unigrams & bigrams so Chinese academic queries match without heavy external segmenters
  const cjkChars = Array.from(lower).filter((ch) => {
    const code = ch.charCodeAt(0);
    return code >= 0x4e00 && code <= 0x9fff;
  });
  for (let i = 0; i < cjkChars.length; i++) {
    const cur = cjkChars[i];
    if (cur) tokens.push(cur);
    const next = cjkChars[i + 1];
    if (cur && next) tokens.push(cur + next);
  }
  return tokens;
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Clean-room local Hybrid Retriever (BM25 + optional Dense Cosine + Heading Boost)
 * with built-in Recall@k / Precision@k / MRR / nDCG@k evaluation.
 */
export class LocalHybridRetriever implements HybridRetrieverContract {
  private chunks: DocumentChunk[] = [];
  private termFreqs: Map<string, number>[] = [];
  private docFreq = new Map<string, number>();
  private avgDocLen = 1;

  indexChunks(chunks: readonly DocumentChunk[]): void {
    this.chunks = [...chunks];
    this.termFreqs = [];
    this.docFreq.clear();

    let totalLen = 0;
    for (const chunk of this.chunks) {
      const fullText = `${chunk.headingPath.join(" ")} ${chunk.text}`;
      const tokens = tokenizeBilingual(fullText);
      totalLen += tokens.length;
      const tf = new Map<string, number>();
      for (const tok of tokens) {
        tf.set(tok, (tf.get(tok) ?? 0) + 1);
      }
      this.termFreqs.push(tf);
      for (const tok of tf.keys()) {
        this.docFreq.set(tok, (this.docFreq.get(tok) ?? 0) + 1);
      }
    }
    this.avgDocLen = this.chunks.length > 0 ? Math.max(1, totalLen / this.chunks.length) : 1;
  }

  search(
    query: string,
    topK: number,
    queryEmbedding?: readonly number[]
  ): readonly RetrievalHit[] {
    const qTokens = tokenizeBilingual(query);
    const N = this.chunks.length;
    if (N === 0 || topK <= 0) return [];

    const k1 = 1.5;
    const b = 0.75;
    const hits: RetrievalHit[] = [];

    for (let i = 0; i < N; i++) {
      const chunk = this.chunks[i];
      const tfMap = this.termFreqs[i];
      if (!chunk || !tfMap) continue;

      let docLen = 0;
      for (const count of tfMap.values()) docLen += count;

      let bm25 = 0;
      for (const tok of qTokens) {
        const tf = tfMap.get(tok) ?? 0;
        if (tf === 0) continue;
        const df = this.docFreq.get(tok) ?? 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        bm25 += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / this.avgDocLen))));
      }

      const vecScore =
        queryEmbedding && chunk.embedding
          ? Math.max(0, cosineSimilarity(queryEmbedding, chunk.embedding))
          : 0;

      const combined = queryEmbedding && chunk.embedding ? bm25 * 0.65 + vecScore * 3.5 : bm25;
      if (combined > 0) {
        hits.push({ chunk, score: combined, bm25Score: bm25, vectorScore: vecScore });
      }
    }

    hits.sort((a, b) => b.score - a.score);
    return Object.freeze(hits.slice(0, topK));
  }

  evaluateRetrieval(cases: readonly EvalCase[], topK: number): RetrievalEvalReport {
    if (cases.length === 0) {
      return { topK, totalCases: 0, recallAtK: 0, precisionAtK: 0, mrr: 0, ndcgAtK: 0 };
    }

    let sumRecall = 0;
    let sumPrecision = 0;
    let sumMrr = 0;
    let sumNdcg = 0;

    for (const c of cases) {
      const gold = new Set(c.goldDocIds);
      const hits = this.search(c.query, topK);
      const seenDocs: string[] = [];
      for (const h of hits) {
        if (!seenDocs.includes(h.chunk.docId)) seenDocs.push(h.chunk.docId);
      }

      let matched = 0;
      let firstRank = 0;
      let dcg = 0;

      seenDocs.forEach((docId, idx) => {
        if (gold.has(docId)) {
          matched++;
          if (firstRank === 0) firstRank = idx + 1;
          dcg += 1 / Math.log2(idx + 2);
        }
      });

      const idealHits = Math.min(gold.size, topK);
      let idcg = 0;
      for (let i = 0; i < idealHits; i++) {
        idcg += 1 / Math.log2(i + 2);
      }

      sumRecall += gold.size > 0 ? matched / gold.size : 0;
      sumPrecision += seenDocs.length > 0 ? matched / seenDocs.length : 0;
      sumMrr += firstRank > 0 ? 1 / firstRank : 0;
      sumNdcg += idcg > 0 ? dcg / idcg : 0;
    }

    const n = cases.length;
    return Object.freeze({
      topK,
      totalCases: n,
      recallAtK: Number((sumRecall / n).toFixed(4)),
      precisionAtK: Number((sumPrecision / n).toFixed(4)),
      mrr: Number((sumMrr / n).toFixed(4)),
      ndcgAtK: Number((sumNdcg / n).toFixed(4)),
    });
  }
}
