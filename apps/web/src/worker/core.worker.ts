/// <reference lib="webworker" />

import type {
  DocumentChunk,
  L1TraceRecord,
  L2ConceptNode,
} from "@openlearnos/contracts";
import {
  AuditableMemoryStore,
  InMemoryTurnEngine,
  LearningAgentOrchestrator,
  LocalHybridRetriever,
  MultiFormatDocumentParser,
  SocraticSafetyGate,
} from "@openlearnos/core";
import type {
  AgentGoalWorkerPayload,
  MemorySnapshot,
  PreparedTurnResult,
  QuizSubmitWorkerPayload,
  Stress150Result,
  WorkerRequest,
  WorkerResponse,
} from "../rpc/protocol.ts";

const turnEngine = new InMemoryTurnEngine();
const memoryStore = new AuditableMemoryStore();
const retriever = new LocalHybridRetriever();
const safetyGate = new SocraticSafetyGate();
const agentOrchestrator = new LearningAgentOrchestrator(memoryStore, retriever, safetyGate);
const docParser = new MultiFormatDocumentParser();

const allChunks: DocumentChunk[] = [];
const traceIndex: L1TraceRecord[] = [];
const conceptIds = new Set<string>();
let traceSeq = 1;

const SEED_CHUNKS: readonly DocumentChunk[] = [
  {
    chunkId: "k12-quad-1",
    docId: "K12_一元二次方程精讲.md",
    page: 1,
    headingPath: ["九年级数学", "一元二次方程与判别式"],
    text: "对于一般形式的一元二次方程 ax^2 + bx + c = 0 (a ≠ 0)，判别式 Δ = b^2 - 4ac。当 Δ > 0 时有两个不相等实根；Δ = 0 时有两个相等实根；Δ < 0 时无实根。易错点：代入 b 和 c 时务必保留负号。",
  },
  {
    chunkId: "scholar-gqa-1",
    docId: "GQA_Attention_Paper.pdf",
    page: 2,
    headingPath: ["2. Method", "Grouped-Query Attention"],
    text: "Grouped-Query Attention (GQA) divides query heads into G groups that share key and value projections. Compared to Multi-Head Attention (MHA), GQA shrinks KV cache memory footprint by a factor of H/G while preserving quality close to MHA.",
  },
  {
    chunkId: "scholar-fa2-1",
    docId: "FlashAttention2_Paper.pdf",
    page: 4,
    headingPath: ["3. Algorithm", "SRAM Tiling & IO Awareness"],
    text: "FlashAttention-2 tiles Q, K, V matrices inside fast on-chip SRAM to avoid materializing the O(N^2) attention matrix in HBM, achieving ~2x speedup over FlashAttention-1 via better warp work partitioning.",
  },
  {
    chunkId: "lifelong-fsrs-1",
    docId: "Lifelong_FSRS_心智模型.md",
    page: 1,
    headingPath: ["终身学习方法论", "间隔重复与主动回忆"],
    text: "被动重复阅读的遗忘率极高。FSRS (Free Spaced Repetition Scheduler) 通过追踪记忆稳定性 (Stability) 与难度 (Difficulty)，在即将遗忘的临界点触发主动回忆（每天 3~5 题），用最小时间实现长期知识留存。",
  },
];

function snapshotMemory(): MemorySnapshot {
  const now = Date.now();
  const concepts: L2ConceptNode[] = [];
  for (const id of conceptIds) {
    const prov = memoryStore.auditConceptProvenance(id);
    if (prov.length > 0) {
      const dueAll = memoryStore.getDueConcepts(Number.MAX_SAFE_INTEGER);
      const found = dueAll.find((c) => c.conceptId === id);
      if (found) concepts.push(found);
    }
  }
  const dueConcepts = memoryStore.getDueConcepts(now);
  return {
    traces: [...traceIndex],
    concepts,
    dueConcepts,
  };
}

function seedInitialState(): { chunks: readonly DocumentChunk[]; memory: MemorySnapshot } {
  if (allChunks.length === 0) {
    allChunks.push(...SEED_CHUNKS);
    retriever.indexChunks(allChunks);

    const now = Date.now();
    const t1: L1TraceRecord = {
      traceId: "trace-seed-1",
      sessionId: "k12-demo",
      summary: "K-12 练习中求解 x^2 - 5x + 6 = 0 时漏写了 b = -5 的负号",
      timestampMs: now - 3600_000,
    };
    const t2: L1TraceRecord = {
      traceId: "trace-seed-2",
      sessionId: "scholar-demo",
      summary: "精读 GQA 论文第 2 页：总结了 MHA / GQA / MQA 的 KV Cache 压缩比",
      timestampMs: now - 1800_000,
    };
    const t3: L1TraceRecord = {
      traceId: "trace-seed-3",
      sessionId: "lifelong-demo",
      summary: "通勤笔记提炼：FSRS 稳定性参数与每日 3 题主动回忆闭环",
      timestampMs: now - 900_000,
    };
    for (const t of [t1, t2, t3]) {
      memoryStore.recordTrace(t);
      traceIndex.push(t);
    }

    const seedConcepts: L2ConceptNode[] = [
      {
        conceptId: "concept-quad-sign",
        topic: "一元二次方程判别式符号易错点 (K-12)",
        masteryScore: 0.45,
        sourceTraceIds: ["trace-seed-1"],
        fsrs: { stabilityDays: 1, difficulty: 6.2, nextReviewAtMs: now - 60_000, reps: 1 },
        updatedAtMs: now,
      },
      {
        conceptId: "concept-gqa-kv",
        topic: "GQA 分组共享 KV Cache 显存复杂度 (Scholar)",
        masteryScore: 0.78,
        sourceTraceIds: ["trace-seed-2"],
        fsrs: { stabilityDays: 3, difficulty: 4.5, nextReviewAtMs: now - 30_000, reps: 2 },
        updatedAtMs: now,
      },
      {
        conceptId: "concept-fsrs-loop",
        topic: "FSRS 间隔重复与主动回忆心智模型 (Lifelong)",
        masteryScore: 0.62,
        sourceTraceIds: ["trace-seed-3"],
        fsrs: { stabilityDays: 2, difficulty: 4.8, nextReviewAtMs: now - 10_000, reps: 1 },
        updatedAtMs: now,
      },
    ];
    for (const c of seedConcepts) {
      memoryStore.upsertConcept(c);
      conceptIds.add(c.conceptId);
    }
  }
  return { chunks: [...allChunks], memory: snapshotMemory() };
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  const reply = (res: WorkerResponse) => self.postMessage(res);

  try {
    switch (req.type) {
      case "INIT_SEED": {
        reply({ id: req.id, ok: true, payload: seedInitialState() });
        break;
      }
      case "ADD_DOC_CHUNKS": {
        allChunks.push(...req.chunks);
        retriever.indexChunks(allChunks);
        reply({ id: req.id, ok: true, payload: { totalChunks: allChunks.length, chunks: [...allChunks] } });
        break;
      }
      case "RESET_ALL_CHUNKS": {
        allChunks.length = 0;
        allChunks.push(...req.chunks);
        retriever.indexChunks(allChunks);
        reply({ id: req.id, ok: true, payload: { totalChunks: allChunks.length, chunks: [...allChunks] } });
        break;
      }
      case "DELETE_DOCUMENT": {
        const filtered = allChunks.filter((c) => c.docId !== req.docId);
        allChunks.length = 0;
        allChunks.push(...filtered);
        retriever.indexChunks(allChunks);
        reply({ id: req.id, ok: true, payload: { totalChunks: allChunks.length, chunks: [...allChunks] } });
        break;
      }
      case "INGEST_RAW_DOCUMENTS": {
        const newChunks: DocumentChunk[] = [];
        for (const doc of req.documents) {
          const parsed = await docParser.parse(doc);
          newChunks.push(...parsed);
        }
        allChunks.push(...newChunks);
        retriever.indexChunks(allChunks);
        reply({
          id: req.id,
          ok: true,
          payload: {
            totalChunks: allChunks.length,
            chunks: [...allChunks],
            newChunks,
          },
        });
        break;
      }
      case "PREPARE_TURN": {
        const scrubbedPrompt = safetyGate.redactSecrets(req.userPrompt);
        const safety = safetyGate.evaluateInput(
          req.mode,
          scrubbedPrompt,
          req.guardianRevealUnlocked
        );
        const userTurn = turnEngine.appendTurn(req.sessionId, "user", scrubbedPrompt);
        const hits = retriever.search(scrubbedPrompt, 3, undefined, req.docIdFilter);
        const context = turnEngine.buildContextWindow(req.sessionId, 12000);
        const payload: PreparedTurnResult = {
          scrubbedPrompt,
          safety,
          userTurn,
          hits,
          context,
        };
        reply({ id: req.id, ok: true, payload });
        break;
      }
      case "COMMIT_ASSISTANT_TURN": {
        const safeText = safetyGate.redactSecrets(req.content);
        const assistantTurn = turnEngine.appendTurn(
          req.sessionId,
          "assistant",
          safeText,
          req.citations
        );
        const now = Date.now();
        const traceId = `trace-live-${traceSeq++}`;
        const trace: L1TraceRecord = {
          traceId,
          sessionId: req.sessionId,
          summary: (req.topicTag ? `[${req.topicTag}] ` : "") + safeText.slice(0, 72),
          timestampMs: now,
        };
        memoryStore.recordTrace(trace);
        traceIndex.unshift(trace);

        if (req.topicTag) {
          const conceptId = `concept-live-${traceSeq}`;
          memoryStore.upsertConcept({
            conceptId,
            topic: req.topicTag,
            masteryScore: 0.6,
            sourceTraceIds: [traceId],
            fsrs: { stabilityDays: 1, difficulty: 5.0, nextReviewAtMs: now - 1000, reps: 1 },
            updatedAtMs: now,
          });
          conceptIds.add(conceptId);
        }

        const context = turnEngine.buildContextWindow(req.sessionId, 12000);
        reply({
          id: req.id,
          ok: true,
          payload: { assistantTurn, context, memory: snapshotMemory() },
        });
        break;
      }
      case "STRESS_150": {
        const formula =
          "推导注意力权重与 KV Cache 复杂度：Attention(Q,K,V)=softmax(QK^T/sqrt(d_k))V ";
        for (let i = 0; i < 150; i++) {
          turnEngine.appendTurn(
            req.sessionId,
            i % 2 === 0 ? "user" : "assistant",
            `[压测轮次 #${i + 1}] ${formula.repeat(4)}`
          );
        }
        let maxBuildTimeMs = 0;
        let lastSlice = turnEngine.buildContextWindow(req.sessionId, 16000);
        for (let r = 0; r < 5; r++) {
          lastSlice = turnEngine.buildContextWindow(req.sessionId, 16000);
          if (lastSlice.buildTimeMs > maxBuildTimeMs) maxBuildTimeMs = lastSlice.buildTimeMs;
        }
        const payload: Stress150Result = {
          totalTurns: turnEngine.getTurnCount(req.sessionId),
          maxBuildTimeMs,
          lastSlice,
        };
        reply({ id: req.id, ok: true, payload });
        break;
      }
      case "RUN_RAG_EVAL": {
        const report = retriever.evaluateRetrieval(req.cases, req.topK);
        reply({ id: req.id, ok: true, payload: report });
        break;
      }
      case "GET_MEMORY": {
        reply({ id: req.id, ok: true, payload: snapshotMemory() });
        break;
      }
      case "PURGE_TRACE": {
        const res = memoryStore.purgeTraceAndCascade(req.traceId);
        const idx = traceIndex.findIndex((t) => t.traceId === req.traceId);
        if (idx >= 0) traceIndex.splice(idx, 1);
        reply({ id: req.id, ok: true, payload: { ...res, memory: snapshotMemory() } });
        break;
      }
      case "MARK_REVIEWED": {
        const all = memoryStore.getDueConcepts(Number.MAX_SAFE_INTEGER);
        const cur = all.find((c) => c.conceptId === req.conceptId);
        if (cur) {
          const nextStability = req.remembered
            ? Math.min(90, Math.round(cur.fsrs.stabilityDays * 2.4 * 10) / 10)
            : 1;
          const nextMastery = req.remembered
            ? Math.min(1, Number((cur.masteryScore + 0.15).toFixed(2)))
            : Math.max(0.2, Number((cur.masteryScore - 0.1).toFixed(2)));
          const now = Date.now();
          memoryStore.upsertConcept({
            ...cur,
            masteryScore: nextMastery,
            fsrs: {
              stabilityDays: nextStability,
              difficulty: req.remembered ? Math.max(1, cur.fsrs.difficulty - 0.3) : Math.min(10, cur.fsrs.difficulty + 0.5),
              reps: cur.fsrs.reps + 1,
              nextReviewAtMs: now + nextStability * 86_400_000,
            },
            updatedAtMs: now,
          });
        }
        reply({ id: req.id, ok: true, payload: snapshotMemory() });
        break;
      }
      case "RUN_AGENT_GOAL": {
        const run = agentOrchestrator.executeGoal({
          sessionId: req.sessionId,
          mode: req.mode,
          goal: req.goal,
          guardianRevealUnlocked: req.guardianRevealUnlocked,
          ...(req.docIdFilter ? { docIdFilter: req.docIdFilter } : {}),
        });
        const payload: AgentGoalWorkerPayload = {
          run,
          memory: snapshotMemory(),
        };
        reply({ id: req.id, ok: true, payload });
        break;
      }
      case "SUBMIT_QUIZ": {
        const evaluation = agentOrchestrator.submitQuizAnswer({
          sessionId: req.sessionId,
          quizId: req.quizId,
          selectedIndex: req.selectedIndex,
        });
        // Mirror newly created L1 trace & L2 concept into worker snapshot indices
        const allDue = memoryStore.getDueConcepts(Number.MAX_SAFE_INTEGER);
        for (const c of allDue) {
          if (!conceptIds.has(c.conceptId)) {
            conceptIds.add(c.conceptId);
            for (const tid of c.sourceTraceIds) {
              if (!traceIndex.some((t) => t.traceId === tid)) {
                const prov = memoryStore.auditConceptProvenance(c.conceptId).find((t) => t.traceId === tid);
                if (prov) traceIndex.unshift(prov);
              }
            }
          }
        }
        const payload: QuizSubmitWorkerPayload = {
          evaluation,
          memory: snapshotMemory(),
        };
        reply({ id: req.id, ok: true, payload });
        break;
      }
    }
  } catch (err) {
    reply({
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
