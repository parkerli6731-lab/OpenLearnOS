export type ChunkMediaType = "text" | "table" | "image" | "code";
export type DocumentSourceFormat =
  | "pdf"
  | "docx"
  | "xlsx"
  | "csv"
  | "txt"
  | "md"
  | "image";

export interface DocumentChunk {
  readonly chunkId: string;
  readonly docId: string;
  readonly page: number;
  readonly headingPath: readonly string[];
  readonly text: string;
  readonly embedding?: readonly number[];
  readonly mediaType?: ChunkMediaType;
  readonly sourceFormat?: DocumentSourceFormat;
  readonly dataUrl?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface RetrievalHit {
  readonly chunk: DocumentChunk;
  readonly score: number;
  readonly bm25Score: number;
  readonly vectorScore: number;
}

export interface EvalCase {
  readonly query: string;
  readonly goldDocIds: readonly string[];
}

export interface RetrievalEvalReport {
  readonly topK: number;
  readonly totalCases: number;
  readonly recallAtK: number;
  readonly precisionAtK: number;
  readonly mrr: number;
  readonly ndcgAtK: number;
}

export interface HybridRetrieverContract {
  indexChunks(chunks: readonly DocumentChunk[]): void;
  search(query: string, topK: number, queryEmbedding?: readonly number[]): readonly RetrievalHit[];
  evaluateRetrieval(cases: readonly EvalCase[], topK: number): RetrievalEvalReport;
}
