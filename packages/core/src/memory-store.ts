import type {
  AuditableMemoryContract,
  L1TraceRecord,
  L2ConceptNode,
  L3LearnerProfile,
} from "@openlearnos/contracts";

/**
 * Auditable L1 -> L2 -> L3 Memory Store.
 * Enforces hard invariant: every L2/L3 entry MUST reference >= 1 existing L1 traceId.
 */
export class AuditableMemoryStore implements AuditableMemoryContract {
  private readonly traces = new Map<string, L1TraceRecord>();
  private readonly concepts = new Map<string, L2ConceptNode>();
  private readonly profiles = new Map<string, L3LearnerProfile>();

  recordTrace(trace: L1TraceRecord): void {
    if (!trace.traceId.trim()) {
      throw new Error("INVARIANT_VIOLATION: L1 traceId must be non-empty.");
    }
    this.traces.set(trace.traceId, Object.freeze({ ...trace }));
  }

  upsertConcept(node: L2ConceptNode): void {
    this.assertValidProvenance("L2ConceptNode", node.sourceTraceIds);
    if (node.masteryScore < 0 || node.masteryScore > 1) {
      throw new Error("INVARIANT_VIOLATION: masteryScore must be within [0, 1].");
    }
    this.concepts.set(node.conceptId, Object.freeze({ ...node }));
  }

  upsertProfile(profile: L3LearnerProfile): void {
    this.assertValidProvenance("L3LearnerProfile", profile.sourceTraceIds);
    this.profiles.set(profile.learnerId, Object.freeze({ ...profile }));
  }

  getDueConcepts(nowMs: number): readonly L2ConceptNode[] {
    const due: L2ConceptNode[] = [];
    for (const node of this.concepts.values()) {
      if (node.fsrs.nextReviewAtMs <= nowMs) {
        due.push(node);
      }
    }
    due.sort((a, b) => a.fsrs.nextReviewAtMs - b.fsrs.nextReviewAtMs);
    return Object.freeze(due);
  }

  auditConceptProvenance(conceptId: string): readonly L1TraceRecord[] {
    const concept = this.concepts.get(conceptId);
    if (!concept) return [];
    const linked: L1TraceRecord[] = [];
    for (const id of concept.sourceTraceIds) {
      const trace = this.traces.get(id);
      if (trace) linked.push(trace);
    }
    return Object.freeze(linked);
  }

  purgeTraceAndCascade(traceId: string): { removedConcepts: number } {
    this.traces.delete(traceId);
    let removedConcepts = 0;

    for (const [conceptId, node] of this.concepts.entries()) {
      if (!node.sourceTraceIds.includes(traceId)) continue;
      const remaining = node.sourceTraceIds.filter((id) => id !== traceId);
      if (remaining.length === 0) {
        this.concepts.delete(conceptId);
        removedConcepts++;
      } else {
        this.concepts.set(
          conceptId,
          Object.freeze({ ...node, sourceTraceIds: Object.freeze(remaining) })
        );
      }
    }

    return { removedConcepts };
  }

  private assertValidProvenance(entityName: string, traceIds: readonly string[]): void {
    if (traceIds.length === 0) {
      throw new Error(
        `INVARIANT_VIOLATION: ${entityName} requires at least 1 L1 sourceTraceId.`
      );
    }
    for (const id of traceIds) {
      if (!this.traces.has(id)) {
        throw new Error(
          `INVARIANT_VIOLATION: ${entityName} references unknown L1 traceId "${id}".`
        );
      }
    }
  }
}
