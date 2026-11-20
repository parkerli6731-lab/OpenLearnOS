export type PersonaMode = "k12" | "scholar" | "lifelong";

export type TurnRole = "user" | "assistant" | "system";

export interface CitationRef {
  readonly docId: string;
  readonly page: number;
  readonly excerpt: string;
  readonly chunkId?: string;
}

export interface TurnRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly index: number;
  readonly role: TurnRole;
  readonly content: string;
  readonly citations: readonly CitationRef[];
  readonly estimatedTokens: number;
  readonly createdAtMs: number;
}

export interface ContextWindowSlice {
  readonly sessionId: string;
  readonly totalStoredTurns: number;
  readonly includedTurns: readonly TurnRecord[];
  readonly totalTokens: number;
  readonly buildTimeMs: number;
}

export interface TurnEngineContract {
  appendTurn(
    sessionId: string,
    role: TurnRole,
    content: string,
    citations?: readonly CitationRef[]
  ): TurnRecord;
  buildContextWindow(sessionId: string, maxTokens: number): ContextWindowSlice;
  getTurnCount(sessionId: string): number;
}
