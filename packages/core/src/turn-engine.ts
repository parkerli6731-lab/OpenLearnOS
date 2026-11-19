import type {
  CitationRef,
  ContextWindowSlice,
  TurnEngineContract,
  TurnRecord,
  TurnRole,
} from "@openlearnos/contracts";

function estimateTokens(text: string): number {
  // Fast deterministic approximation handling both CJK (~1.2 chars/token) and Latin (~4 chars/token)
  let cjk = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x4e00 && code <= 0x9fff) cjk++;
    else other++;
  }
  return Math.max(1, Math.ceil(cjk * 0.85 + other * 0.25));
}

/**
 * Append-only, zero-deep-copy TurnEngine.
 * Avoids JSON serialize/deserialize loops that freeze event loops on 100+ turn sessions.
 */
export class InMemoryTurnEngine implements TurnEngineContract {
  private readonly sessions = new Map<string, TurnRecord[]>();

  appendTurn(
    sessionId: string,
    role: TurnRole,
    content: string,
    citations: readonly CitationRef[] = []
  ): TurnRecord {
    let list = this.sessions.get(sessionId);
    if (!list) {
      list = [];
      this.sessions.set(sessionId, list);
    }

    const record: TurnRecord = Object.freeze({
      id: `${sessionId}#${list.length}`,
      sessionId,
      index: list.length,
      role,
      content,
      citations: Object.freeze([...citations]),
      estimatedTokens: estimateTokens(content),
      createdAtMs: Date.now(),
    });

    list.push(record);
    return record;
  }

  buildContextWindow(sessionId: string, maxTokens: number): ContextWindowSlice {
    const start = performance.now();
    const list = this.sessions.get(sessionId) ?? [];
    const selected: TurnRecord[] = [];
    let totalTokens = 0;

    // Walk backwards in O(k) without copying or re-serializing historical payloads
    for (let i = list.length - 1; i >= 0; i--) {
      const turn = list[i];
      if (!turn) continue;
      if (totalTokens + turn.estimatedTokens > maxTokens && selected.length > 0) {
        break;
      }
      selected.push(turn);
      totalTokens += turn.estimatedTokens;
    }

    selected.reverse();
    const buildTimeMs = performance.now() - start;

    return Object.freeze({
      sessionId,
      totalStoredTurns: list.length,
      includedTurns: Object.freeze(selected),
      totalTokens,
      buildTimeMs,
    });
  }

  getTurnCount(sessionId: string): number {
    return this.sessions.get(sessionId)?.length ?? 0;
  }
}
