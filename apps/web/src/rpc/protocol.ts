import type {
  AgentRunResult,
  CitationRef,
  ContextWindowSlice,
  DocumentChunk,
  EvalCase,
  L1TraceRecord,
  L2ConceptNode,
  PersonaMode,
  QuizEvaluationResult,
  RetrievalEvalReport,
  RetrievalHit,
  SafetyEvaluation,
  TurnRecord,
} from "@openlearnos/contracts";

export interface MemorySnapshot {
  readonly traces: readonly L1TraceRecord[];
  readonly concepts: readonly L2ConceptNode[];
  readonly dueConcepts: readonly L2ConceptNode[];
}

export interface RawDocumentUploadPayload {
  readonly filename: string;
  readonly buffer?: Uint8Array;
  readonly textContent?: string;
  readonly dataUrl?: string;
  readonly mimeType?: string;
}

export type WorkerRequestPayload =
  | { type: "INIT_SEED" }
  | { type: "ADD_DOC_CHUNKS"; chunks: readonly DocumentChunk[] }
  | { type: "INGEST_RAW_DOCUMENTS"; documents: readonly RawDocumentUploadPayload[] }
  | {
      type: "PREPARE_TURN";
      sessionId: string;
      mode: PersonaMode;
      userPrompt: string;
      guardianRevealUnlocked: boolean;
    }
  | {
      type: "COMMIT_ASSISTANT_TURN";
      sessionId: string;
      content: string;
      citations: readonly CitationRef[];
      topicTag?: string;
    }
  | { type: "STRESS_150"; sessionId: string }
  | { type: "RUN_RAG_EVAL"; cases: readonly EvalCase[]; topK: number }
  | { type: "GET_MEMORY" }
  | { type: "PURGE_TRACE"; traceId: string }
  | { type: "MARK_REVIEWED"; conceptId: string; remembered: boolean }
  | {
      type: "RUN_AGENT_GOAL";
      sessionId: string;
      mode: PersonaMode;
      goal: string;
      guardianRevealUnlocked: boolean;
    }
  | {
      type: "SUBMIT_QUIZ";
      sessionId: string;
      quizId: string;
      selectedIndex: number;
    };

export interface AgentGoalWorkerPayload {
  readonly run: AgentRunResult;
  readonly memory: MemorySnapshot;
}

export interface QuizSubmitWorkerPayload {
  readonly evaluation: QuizEvaluationResult;
  readonly memory: MemorySnapshot;
}

export type WorkerRequest = WorkerRequestPayload & { id: number };

export type WorkerResponse =
  | { id: number; ok: true; payload: unknown }
  | { id: number; ok: false; error: string };

export interface PreparedTurnResult {
  readonly scrubbedPrompt: string;
  readonly safety: SafetyEvaluation;
  readonly userTurn: TurnRecord;
  readonly hits: readonly RetrievalHit[];
  readonly context: ContextWindowSlice;
}

export interface Stress150Result {
  readonly totalTurns: number;
  readonly maxBuildTimeMs: number;
  readonly lastSlice: ContextWindowSlice;
}
