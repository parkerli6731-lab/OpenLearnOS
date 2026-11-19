export interface L1TraceRecord {
  readonly traceId: string;
  readonly sessionId: string;
  readonly summary: string;
  readonly timestampMs: number;
}

export interface FsrsSchedule {
  readonly stabilityDays: number;
  readonly difficulty: number;
  readonly nextReviewAtMs: number;
  readonly reps: number;
}

export interface L2ConceptNode {
  readonly conceptId: string;
  readonly topic: string;
  readonly masteryScore: number; // 0.0 - 1.0
  readonly sourceTraceIds: readonly string[]; // INVARIANT: length >= 1
  readonly fsrs: FsrsSchedule;
  readonly updatedAtMs: number;
}

export interface L3LearnerProfile {
  readonly learnerId: string;
  readonly preferredDepth: "guided" | "rigorous" | "concise";
  readonly strengths: readonly string[];
  readonly focusAreas: readonly string[];
  readonly sourceTraceIds: readonly string[]; // INVARIANT: length >= 1
  readonly updatedAtMs: number;
}

export interface AuditableMemoryContract {
  recordTrace(trace: L1TraceRecord): void;
  upsertConcept(node: L2ConceptNode): void;
  upsertProfile(profile: L3LearnerProfile): void;
  getDueConcepts(nowMs: number): readonly L2ConceptNode[];
  auditConceptProvenance(conceptId: string): readonly L1TraceRecord[];
  purgeTraceAndCascade(traceId: string): { removedConcepts: number };
}
