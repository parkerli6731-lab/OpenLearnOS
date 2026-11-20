import type {
  CitationRef,
  ContextWindowSlice,
  DocumentChunk,
  EvalCase,
  PersonaMode,
  RetrievalEvalReport,
  TurnRecord,
} from "@openlearnos/contracts";
import type {
  AgentGoalWorkerPayload,
  MemorySnapshot,
  PreparedTurnResult,
  QuizSubmitWorkerPayload,
  RawDocumentUploadPayload,
  Stress150Result,
  WorkerRequestPayload,
  WorkerResponse,
} from "./protocol.ts";

/**
 * Typed RPC Bridge to the physically isolated Core Web Worker.
 * UI components call this bridge ONLY — never importing @openlearnos/core directly.
 */
export class CoreWorkerClient {
  private readonly worker: Worker;
  private reqSeq = 1;
  private readonly pending = new Map<
    number,
    { resolve: (val: unknown) => void; reject: (err: Error) => void }
  >();

  constructor() {
    this.worker = new Worker(new URL("../worker/core.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.ok) entry.resolve(msg.payload);
      else entry.reject(new Error(msg.error));
    };
  }

  private call<T>(req: WorkerRequestPayload): Promise<T> {
    const id = this.reqSeq++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      this.worker.postMessage({ ...req, id });
    });
  }

  initSeed(): Promise<{ chunks: readonly DocumentChunk[]; memory: MemorySnapshot }> {
    return this.call({ type: "INIT_SEED" });
  }

  addDocChunks(chunks: readonly DocumentChunk[]): Promise<{ totalChunks: number; chunks: readonly DocumentChunk[] }> {
    return this.call({ type: "ADD_DOC_CHUNKS", chunks });
  }

  ingestRawDocuments(documents: readonly RawDocumentUploadPayload[]): Promise<{
    totalChunks: number;
    chunks: readonly DocumentChunk[];
    newChunks: readonly DocumentChunk[];
  }> {
    return this.call({ type: "INGEST_RAW_DOCUMENTS", documents });
  }

  resetAllChunks(chunks: readonly DocumentChunk[]): Promise<{ totalChunks: number; chunks: readonly DocumentChunk[] }> {
    return this.call({ type: "RESET_ALL_CHUNKS", chunks });
  }

  deleteDocument(docId: string): Promise<{ totalChunks: number; chunks: readonly DocumentChunk[] }> {
    return this.call({ type: "DELETE_DOCUMENT", docId });
  }

  deleteChunk(chunkId: string): Promise<{ totalChunks: number; chunks: readonly DocumentChunk[] }> {
    return this.call({ type: "DELETE_CHUNK", chunkId });
  }

  clearAllDocuments(): Promise<{ totalChunks: number; chunks: readonly DocumentChunk[] }> {
    return this.call({ type: "CLEAR_ALL_DOCUMENTS" });
  }

  prepareTurn(
    sessionId: string,
    mode: PersonaMode,
    userPrompt: string,
    guardianRevealUnlocked: boolean,
    docIdFilter?: string
  ): Promise<PreparedTurnResult> {
    return this.call({
      type: "PREPARE_TURN",
      sessionId,
      mode,
      userPrompt,
      guardianRevealUnlocked,
      ...(docIdFilter ? { docIdFilter } : {}),
    });
  }

  commitAssistantTurn(
    sessionId: string,
    content: string,
    citations: readonly CitationRef[],
    topicTag?: string
  ): Promise<{ assistantTurn: TurnRecord; context: ContextWindowSlice; memory: MemorySnapshot }> {
    return this.call(
      topicTag !== undefined
        ? { type: "COMMIT_ASSISTANT_TURN", sessionId, content, citations, topicTag }
        : { type: "COMMIT_ASSISTANT_TURN", sessionId, content, citations }
    );
  }

  runStress150(sessionId: string): Promise<Stress150Result> {
    return this.call({ type: "STRESS_150", sessionId });
  }

  runRagEval(cases: readonly EvalCase[], topK: number): Promise<RetrievalEvalReport> {
    return this.call({ type: "RUN_RAG_EVAL", cases, topK });
  }

  getMemory(): Promise<MemorySnapshot> {
    return this.call({ type: "GET_MEMORY" });
  }

  purgeTrace(traceId: string): Promise<{ removedConcepts: number; memory: MemorySnapshot }> {
    return this.call({ type: "PURGE_TRACE", traceId });
  }

  markReviewed(conceptId: string, remembered: boolean): Promise<MemorySnapshot> {
    return this.call({ type: "MARK_REVIEWED", conceptId, remembered });
  }

  runAgentGoal(
    sessionId: string,
    mode: PersonaMode,
    goal: string,
    guardianRevealUnlocked: boolean,
    docIdFilter?: string
  ): Promise<AgentGoalWorkerPayload> {
    return this.call({
      type: "RUN_AGENT_GOAL",
      sessionId,
      mode,
      goal,
      guardianRevealUnlocked,
      ...(docIdFilter ? { docIdFilter } : {}),
    });
  }

  submitQuiz(
    sessionId: string,
    quizId: string,
    selectedIndex: number
  ): Promise<QuizSubmitWorkerPayload> {
    return this.call({
      type: "SUBMIT_QUIZ",
      sessionId,
      quizId,
      selectedIndex,
    });
  }
}
