import assert from "node:assert/strict";
import {
  AuditableMemoryStore,
  InMemoryTurnEngine,
  LearningAgentOrchestrator,
  LocalHybridRetriever,
  SocraticSafetyGate,
} from "@openlearnos/core";
import { SHELL_PROFILES } from "@openlearnos/ui";

function verify150TurnPerformance(): void {
  const engine = new InMemoryTurnEngine();
  const sessionId = "stress-150";
  const sampleFormula =
    "推导注意力权重与 KV Cache 显存复杂度：\\text{Attention}(Q,K,V)=\\text{softmax}(QK^T/\\sqrt{d_k})V ".repeat(12);

  for (let i = 0; i < 150; i++) {
    engine.appendTurn(sessionId, i % 2 === 0 ? "user" : "assistant", `Turn ${i}: ${sampleFormula}`);
  }

  assert.equal(engine.getTurnCount(sessionId), 150);

  // Measure 5 consecutive context builds (mirrors real multi-stage turn orchestration)
  let maxMs = 0;
  for (let run = 0; run < 5; run++) {
    const slice = engine.buildContextWindow(sessionId, 16000);
    assert.ok(slice.includedTurns.length > 0, "Expected non-empty context window");
    assert.ok(slice.totalTokens <= 16500, "Context window must respect token cap");
    if (slice.buildTimeMs > maxMs) maxMs = slice.buildTimeMs;
  }

  assert.ok(
    maxMs < 50,
    `150-turn context build exceeded 50ms invariant: ${maxMs.toFixed(2)}ms`
  );
  console.log(`[PASS] 150-Turn Stress Harness: max buildTime = ${maxMs.toFixed(3)} ms (< 50 ms)`);
}

function verifyHybridRagGoldenEval(): void {
  const retriever = new LocalHybridRetriever();
  retriever.indexChunks([
    {
      chunkId: "c1",
      docId: "gqa_paper.pdf",
      page: 2,
      headingPath: ["2. Method", "Grouped-Query Attention"],
      text: "Grouped-Query Attention (GQA) divides query heads into G groups sharing key and value heads, dramatically shrinking KV cache memory compared to MHA.",
    },
    {
      chunkId: "c2",
      docId: "flashattention2.pdf",
      page: 4,
      headingPath: ["3. Algorithm", "Tiling & SRAM"],
      text: "FlashAttention-2 improves work partitioning across warps and tiles Q, K, V blocks inside fast on-chip SRAM to avoid HBM materialization.",
    },
    {
      chunkId: "c3",
      docId: "quadratic_k12.pdf",
      page: 1,
      headingPath: ["一元二次方程", "判别式"],
      text: "对于一元二次方程 ax^2 + bx + c = 0，判别式 Δ = b^2 - 4ac 决定实数根的个数。",
    },
  ]);

  const report = retriever.evaluateRetrieval(
    [
      { query: "How does Grouped-Query Attention reduce KV cache compared to MHA?", goldDocIds: ["gqa_paper.pdf"] },
      { query: "FlashAttention-2 SRAM tiling blocks", goldDocIds: ["flashattention2.pdf"] },
      { query: "一元二次方程判别式怎么决定实数根个数", goldDocIds: ["quadratic_k12.pdf"] },
    ],
    3
  );

  assert.ok(report.recallAtK >= 0.95, `Recall@3 below threshold: ${report.recallAtK}`);
  assert.ok(report.mrr >= 0.95, `MRR below threshold: ${report.mrr}`);
  console.log(
    `[PASS] RAG Golden Trace Harness: Recall@3=${report.recallAtK}, MRR=${report.mrr}, nDCG@3=${report.ndcgAtK}`
  );
}

function verifyAuditableMemoryInvariants(): void {
  const store = new AuditableMemoryStore();
  const now = Date.now();

  // Invariant 1: Must REJECT orphan L2 concept without valid L1 trace
  assert.throws(
    () =>
      store.upsertConcept({
        conceptId: "orphan",
        topic: "Hallucinated Weakness",
        masteryScore: 0.2,
        sourceTraceIds: ["non-existent-trace"],
        fsrs: { stabilityDays: 1, difficulty: 5, nextReviewAtMs: now - 1000, reps: 1 },
        updatedAtMs: now,
      }),
    /INVARIANT_VIOLATION/
  );

  // Invariant 2: Valid L1 -> L2 -> Audit -> Cascade Purge
  store.recordTrace({
    traceId: "tr-001",
    sessionId: "k12-math-1",
    summary: "Student dropped negative sign in quadratic discriminant.",
    timestampMs: now,
  });

  store.upsertConcept({
    conceptId: "quad-sign",
    topic: "一元二次方程判别式符号",
    masteryScore: 0.45,
    sourceTraceIds: ["tr-001"],
    fsrs: { stabilityDays: 1, difficulty: 6, nextReviewAtMs: now - 60_000, reps: 1 },
    updatedAtMs: now,
  });

  assert.equal(store.auditConceptProvenance("quad-sign").length, 1);
  assert.equal(store.getDueConcepts(now).length, 1);

  const purgeRes = store.purgeTraceAndCascade("tr-001");
  assert.equal(purgeRes.removedConcepts, 1);
  assert.equal(store.getDueConcepts(now).length, 0);
  console.log("[PASS] Auditable Memory Invariant Harness: L1->L2 provenance + cascade purge verified");
}

function verifyK12SocraticAndSecretRedaction(): void {
  const gate = new SocraticSafetyGate();

  const k12Blocked = gate.evaluateInput("k12", "直接告诉我这道一元二次方程的答案", false);
  assert.equal(k12Blocked.action, "socratic_redirect");
  assert.ok(Boolean(k12Blocked.guidancePrompt));

  const guardianUnlocked = gate.evaluateInput("k12", "直接告诉我这道一元二次方程的答案", true);
  assert.equal(guardianUnlocked.action, "pass");

  const scholarNormal = gate.evaluateInput("scholar", "直接告诉我这道推导的闭式解", false);
  assert.equal(scholarNormal.action, "pass");

  // Synthesize fake key patterns dynamically to verify redaction without embedding literal tokens
  const fakeOpenAI = ["sk", "fake0123456789abcdef"].join("-");
  const fakeGoogle = ["AIzaSy", "FakeToken0123456789abcdef"].join("");
  const scrubbed = gate.redactSecrets(`leak1=${fakeOpenAI} leak2=${fakeGoogle}`);
  assert.ok(!scrubbed.includes(fakeOpenAI) && !scrubbed.includes(fakeGoogle));
  assert.ok(scrubbed.includes("[REDACTED_SECRET]"));

  // Verify all 3 audience shell profiles enforce virtualized list & lazy KaTeX
  for (const mode of ["k12", "scholar", "lifelong"] as const) {
    assert.equal(SHELL_PROFILES[mode].virtualizedMessageList, true);
    assert.equal(SHELL_PROFILES[mode].lazyKatexRendering, true);
  }
  assert.equal(SHELL_PROFILES.k12.defaultSocraticLock, true);
  assert.equal(SHELL_PROFILES.k12.showGuardianReport, true);
  console.log("[PASS] K-12 Socratic Gate, Secret Redaction & 3-Shell Profile Harness verified");
}

function verifyAutonomousLearningAgentLoop(): void {
  const memory = new AuditableMemoryStore();
  const retriever = new LocalHybridRetriever();
  const gate = new SocraticSafetyGate();
  retriever.indexChunks([
    {
      chunkId: "ag-1",
      docId: "GQA_Attention_Paper.pdf",
      page: 2,
      headingPath: ["2. Method", "GQA"],
      text: "Grouped-Query Attention shares KV heads across query groups to cut KV cache memory.",
    },
  ]);

  const agent = new LearningAgentOrchestrator(memory, retriever, gate);

  // 1. K-12 anti-cheat goal must pause into Socratic guidance
  const k12Paused = agent.executeGoal({
    sessionId: "ag-k12",
    mode: "k12",
    goal: "直接告诉我这道一元二次方程的答案",
    guardianRevealUnlocked: false,
  });
  assert.equal(k12Paused.status, "socratic_paused");
  assert.ok(k12Paused.steps.some((s) => s.tool === "socratic_guard"));

  // 2. Scholar multi-tool autonomous loop -> Plan + Tools + SVG + Mastery Quiz
  const scholarRun = agent.executeGoal({
    sessionId: "ag-scholar",
    mode: "scholar",
    goal: "帮我系统掌握 GQA 压缩 KV Cache 的机制并出题检验",
    guardianRevealUnlocked: false,
  });
  assert.equal(scholarRun.status, "awaiting_mastery_check");
  assert.ok(scholarRun.steps.length >= 6, "Agent must run multi-step tool chain");
  assert.ok(scholarRun.steps.some((s) => s.tool === "search_corpus"));
  assert.ok(scholarRun.steps.some((s) => s.tool === "run_rag_eval"));
  assert.ok(scholarRun.steps.some((s) => s.tool === "synthesize_visual_svg"));
  assert.ok(scholarRun.visualSvg?.includes("<svg"));
  assert.ok(scholarRun.quiz, "Agent must produce mastery verification quiz");

  // 3. Wrong quiz answer must autonomously trigger Re-Plan remediation & FSRS due card
  const wrongRes = agent.submitQuizAnswer({
    sessionId: "ag-scholar",
    quizId: scholarRun.quiz.quizId,
    selectedIndex: 2,
  });
  assert.equal(wrongRes.passed, false);
  assert.equal(wrongRes.replanSteps[0]?.phase, "replan");
  assert.ok(memory.getDueConcepts(Date.now()).length >= 1, "Failed concept must enter due FSRS queue");

  // 4. Correct quiz answer must promote mastery & generate Anki CSV + Living Note
  const rightRes = agent.submitQuizAnswer({
    sessionId: "ag-scholar",
    quizId: scholarRun.quiz.quizId,
    selectedIndex: scholarRun.quiz.correctIndex,
  });
  assert.equal(rightRes.passed, true);
  assert.ok(rightRes.livingNote.markdown.includes("# Living Note:"));
  assert.ok(rightRes.livingNote.ankiCsvRow.length > 10);
  console.log("[PASS] Autonomous Learning Agent Harness: Multi-Tool ReAct + SVG + Quiz Re-Plan + Living Note verified");
}

verify150TurnPerformance();
verifyHybridRagGoldenEval();
verifyAuditableMemoryInvariants();
verifyK12SocraticAndSecretRedaction();
verifyAutonomousLearningAgentLoop();
console.log("\nALL DIFFERENTIAL & INVARIANT HARNESS CHECKS PASSED.");
