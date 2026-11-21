import assert from "node:assert/strict";
import type { CitationRef, DocumentChunk, DocumentExportData } from "@openlearnos/contracts";
import {
  AuditableMemoryStore,
  InMemoryTurnEngine,
  LearningAgentOrchestrator,
  LocalHybridRetriever,
  MultiFormatDocumentParser,
  SocraticSafetyGate,
  exportDocx,
  exportPdf,
  exportXlsx,
} from "@openlearnos/core";
import { SHELL_PROFILES } from "@openlearnos/ui";
import * as fflate from "fflate";

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

async function verifyMultiFormatDocumentIngestion(): Promise<void> {
  const parser = new MultiFormatDocumentParser();
  const allParsedChunks: DocumentChunk[] = [];

  // 1. Markdown Ingestion
  const mdChunks = await parser.parse({
    filename: "RL_DPO_Notes.md",
    textContent: `# 强化学习与直接偏好优化 (DPO)\n\n## 1. 核心理论\n\nDirect Preference Optimization 跳过显式奖励模型训练，直接利用 Bradley-Terry 偏好模型求解最优闭式解。\n\n## 2. 损失函数\n\n损失函数形式为：L_{DPO} = -E[log sigma(beta * log(pi/ref))]。`,
  });
  assert.ok(mdChunks.length >= 2, "MD must produce structured chunks");
  assert.equal(mdChunks[0]?.sourceFormat, "md");
  assert.ok(mdChunks[1]?.headingPath.includes("2. 损失函数"));
  allParsedChunks.push(...mdChunks);

  // 2. CSV Table Ingestion
  const csvChunks = await parser.parse({
    filename: "benchmarks_eval.csv",
    textContent: `Model,ContextLen,MMLU_Pro,VRAM_GB\nOpenLearn-7B,32k,72.4,14.2\nDeepSeek-R1,128k,84.1,320.0\nQwen2.5-Coder,64k,79.5,28.0`,
  });
  assert.equal(csvChunks.length, 1);
  assert.equal(csvChunks[0]?.mediaType, "table");
  assert.equal(csvChunks[0]?.sourceFormat, "csv");
  assert.ok(csvChunks[0]?.text.includes("| Model | ContextLen | MMLU_Pro | VRAM_GB |"));
  allParsedChunks.push(...csvChunks);

  // 3. Word DOCX Ingestion (with fflate synthesized in-memory archive)
  const docxXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第1章 大模型推理优化</w:t></w:r></w:p>
    <w:p><w:r><w:t>推测解码 (Speculative Decoding) 使用小型 Draft Model 生成前瞻草稿，大模型并行验证，突破自回归显存带宽瓶颈。</w:t></w:r></w:p>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>优化方案</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>加速比</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>Speculative Decoding</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>2.5x</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
  </w:body>
</w:document>`;
  const docxEntry = "word/doc" + "ument.xml";
  const docxBuffer = fflate.zipSync({ [docxEntry]: fflate.strToU8(docxXml) });
  const docxChunks = await parser.parse({
    filename: "inference_optimization.docx",
    buffer: docxBuffer,
  });
  assert.ok(docxChunks.length >= 2, "DOCX must extract both paragraph and table chunks");
  assert.ok(docxChunks.some((c) => c.text.includes("Speculative Decoding")));
  assert.ok(docxChunks.some((c) => c.mediaType === "table" && c.text.includes("| 优化方案 | 加速比 |")));
  allParsedChunks.push(...docxChunks);

  // 4. Excel XLSX Ingestion (with sharedStrings and sheetData)
  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><t>算法名称</t></si>
  <si><t>收敛步数</t></si>
  <si><t>PPO</t></si>
  <si><t>DPO</t></si>
</sst>`;
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>2</v></c>
      <c r="B2"><v>1500</v></c>
    </row>
    <row r="3">
      <c r="A3" t="s"><v>3</v></c>
      <c r="B3"><v>450</v></c>
    </row>
  </sheetData>
</worksheet>`;
  const xlsxBuffer = fflate.zipSync({
    "xl/sharedStrings.xml": fflate.strToU8(sharedStringsXml),
    "xl/worksheets/sheet1.xml": fflate.strToU8(sheetXml),
  });
  const xlsxChunks = await parser.parse({
    filename: "rl_convergence_study.xlsx",
    buffer: xlsxBuffer,
  });
  assert.equal(xlsxChunks.length, 1);
  assert.equal(xlsxChunks[0]?.mediaType, "table");
  assert.equal(xlsxChunks[0]?.sourceFormat, "xlsx");
  assert.ok(xlsxChunks[0]?.text.includes("| 算法名称 | 收敛步数 |"));
  assert.ok(xlsxChunks[0]?.text.includes("| PPO | 1500 |"));
  assert.ok(xlsxChunks[0]?.text.includes("| DPO | 450 |"));
  allParsedChunks.push(...xlsxChunks);

  // 5. PDF Ingestion (synthesized PDF stream)
  const pdfContent = `%PDF-1.4
1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj
2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj
3 0 obj <</Type /Page /Parent 2 0 R /Contents 4 0 R>> endobj
4 0 obj
<< /Length 120 >>
stream
BT
/F1 12 Tf
(PPO clipped surrogate objective optimizes policy without excessive updates) Tj
ET
endstream
endobj
xref
trailer <</Root 1 0 R>>
%%EOF`;
  const pdfChunks = await parser.parse({
    filename: "ppo_objective.pdf",
    buffer: fflate.strToU8(pdfContent),
  });
  assert.ok(pdfChunks.length >= 1, "PDF must extract text stream");
  assert.equal(pdfChunks[0]?.sourceFormat, "pdf");
  assert.ok(pdfChunks[0]?.text.includes("PPO clipped surrogate objective"));
  allParsedChunks.push(...pdfChunks);

  // 6. Image Ingestion (synthesized PNG with valid 16x16 IHDR)
  const pngHeader = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG magic
    0x00, 0x00, 0x00, 0x0d, // IHDR chunk length 13
    0x49, 0x48, 0x44, 0x52, // "IHDR"
    0x00, 0x00, 0x04, 0x00, // width: 1024
    0x00, 0x00, 0x03, 0x00, // height: 768
    0x08, 0x06, 0x00, 0x00, 0x00, // 8-bit RGBA
    0x00, 0x00, 0x00, 0x00, // CRC placeholder
  ]);
  const imgChunks = await parser.parse({
    filename: "reinforcement_learning_loss_curve.png",
    buffer: pngHeader,
    dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABAAAAAMACA==",
  });
  assert.equal(imgChunks.length, 1);
  assert.equal(imgChunks[0]?.mediaType, "image");
  assert.equal(imgChunks[0]?.sourceFormat, "image");
  assert.ok(imgChunks[0]?.text.includes("1024×768px"));
  assert.ok(Boolean(imgChunks[0]?.dataUrl));
  allParsedChunks.push(...imgChunks);

  // 7. PowerPoint Presentation (PPTX) Ingestion
  const pptxSlideXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp><p:nvSpPr><p:ph type="title"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>强化学习课件: Policy Gradient 策略梯度定理</a:t></a:r></a:p></p:txBody></p:sp>
      <p:sp><p:txBody><a:p><a:r><a:t>通过蒙特卡洛采样估计回报梯度，避免价值函数近似误差。</a:t></a:r></a:p></p:txBody></p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;
  const pptxBuffer = fflate.zipSync({ "ppt/slides/slide1.xml": fflate.strToU8(pptxSlideXml) });
  const pptxChunks = await parser.parse({ filename: "reinforcement_learning_lecture.pptx", buffer: pptxBuffer });
  assert.equal(pptxChunks.length, 1);
  assert.equal(pptxChunks[0]?.sourceFormat, "pptx");
  assert.ok(pptxChunks[0]?.text.includes("Policy Gradient"));
  allParsedChunks.push(...pptxChunks);

  // 8. MOOC Video Subtitle / Transcript (.srt) Ingestion
  const srtChunks = await parser.parse({
    filename: "distributed_rl_lecture.srt",
    textContent: `1\n00:00:01,000 --> 00:00:05,000\n同学们好，今天我们讲解分布式强化学习框架 Ray RLlib 的架构。\n\n2\n00:00:05,500 --> 00:00:10,000\nActor 模型能够跨节点并发收集环境转移轨迹 (Trajectory)。`,
  });
  assert.ok(srtChunks.length >= 1);
  assert.equal(srtChunks[0]?.sourceFormat, "transcript");
  assert.ok(srtChunks[0]?.text.includes("Ray RLlib"));
  allParsedChunks.push(...srtChunks);

  // 9. Python Code (.py) Ingestion
  const codeChunks = await parser.parse({
    filename: "ppo_clip_loss.py",
    textContent: `def ppo_clip_loss(logp, old_logp, advantages, clip_eps=0.2):\n    ratio = torch.exp(logp - old_logp)\n    surr1 = ratio * advantages\n    surr2 = torch.clamp(ratio, 1.0 - clip_eps, 1.0 + clip_eps) * advantages\n    return -torch.min(surr1, surr2).mean()`,
  });
  assert.ok(codeChunks.length >= 1);
  assert.equal(codeChunks[0]?.sourceFormat, "code");
  assert.ok(codeChunks[0]?.text.includes("def ppo_clip_loss"));
  allParsedChunks.push(...codeChunks);

  // 10. Vector SVG Diagram (.svg) Ingestion
  const svgXml = `<svg viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg"><text x="100" y="100">Actor-Critic 架构网络拓扑</text></svg>`;
  const svgChunks = await parser.parse({ filename: "actor_critic_architecture.svg", textContent: svgXml });
  assert.equal(svgChunks.length, 1);
  assert.equal(svgChunks[0]?.sourceFormat, "image");
  assert.ok(svgChunks[0]?.text.includes("Actor-Critic 架构网络拓扑"));
  allParsedChunks.push(...svgChunks);

  // 11. Cross-Validation: Ingest all multi-format chunks into LocalHybridRetriever
  const retriever = new LocalHybridRetriever();
  retriever.indexChunks(allParsedChunks);

  const evalReport = retriever.evaluateRetrieval(
    [
      { query: "Bradley-Terry 直接偏好优化 DPO 闭式解", goldDocIds: ["RL_DPO_Notes.md"] },
      { query: "MMLU_Pro VRAM benchmark comparison", goldDocIds: ["benchmarks_eval.csv"] },
      { query: "Speculative Decoding 草稿验证 2.5x 加速比", goldDocIds: ["inference_optimization.docx"] },
      { query: "收敛步数 算法名称 1500 450", goldDocIds: ["rl_convergence_study.xlsx"] },
      { query: "PPO clipped surrogate objective policy", goldDocIds: ["ppo_objective.pdf"] },
      { query: "reinforcement_learning_loss_curve 视觉图表 1024x768", goldDocIds: ["reinforcement_learning_loss_curve.png"] },
      { query: "Policy Gradient 策略梯度定理 课件 幻灯片", goldDocIds: ["reinforcement_learning_lecture.pptx"] },
      { query: "分布式强化学习 Ray RLlib 课程字幕 录播", goldDocIds: ["distributed_rl_lecture.srt"] },
      { query: "def ppo_clip_loss surrogate 代码实现", goldDocIds: ["ppo_clip_loss.py"] },
      { query: "Actor-Critic 架构网络拓扑 矢量图 标注", goldDocIds: ["actor_critic_architecture.svg"] },
    ],
    2
  );

  assert.ok(evalReport.recallAtK >= 0.95, `Multi-format Recall@2 below threshold: ${evalReport.recallAtK}`);
  assert.ok(evalReport.mrr >= 0.95, `Multi-format MRR below threshold: ${evalReport.mrr}`);
  console.log(
    `[PASS] Universal Omni-Format RAG Harness: PPTX, PDF, Word, Excel, CSV, SRT, Code, SVG & Markdown recall=${evalReport.recallAtK}, MRR=${evalReport.mrr}`
  );
}

function verifyDocumentScopedRetrievalAndFiltering(): void {
  const retriever = new LocalHybridRetriever();
  retriever.indexChunks([
    {
      chunkId: "docA-1",
      docId: "Linear_Algebra_Textbook.pdf",
      page: 12,
      headingPath: ["Chapter 3", "Eigenvalues"],
      text: "Eigenvalues and eigenvectors satisfy Av = lambda v for non-zero vectors v.",
    },
    {
      chunkId: "docB-1",
      docId: "Quantum_Mechanics_Notes.md",
      page: 1,
      headingPath: ["Postulate 1", "State Space"],
      text: "Quantum state vectors live in a complex Hilbert space with inner product.",
    },
    {
      chunkId: "docC-1",
      docId: "K12_Algebra_Basics.docx",
      page: 5,
      headingPath: ["Linear Equations", "Systems"],
      text: "Solving systems of linear equations and coefficient vectors using Gaussian elimination and row operations.",
    },
  ]);

  // Test 1: Without filter, searching for "vectors" hits all documents
  const allHits = retriever.search("vectors", 3);
  assert.equal(allHits.length, 3);

  // Test 2: With filter, strictly limited to docB
  const scopedHits = retriever.search("vectors", 3, undefined, "Quantum_Mechanics_Notes.md");
  assert.equal(scopedHits.length, 1);
  assert.equal(scopedHits[0]?.chunk.docId, "Quantum_Mechanics_Notes.md");

  // Test 3: Agent orchestrator with docIdFilter
  const memory = new AuditableMemoryStore();
  const safety = new SocraticSafetyGate();
  const agent = new LearningAgentOrchestrator(memory, retriever, safety);

  const runResult = agent.executeGoal({
    sessionId: "test-scoped",
    mode: "scholar",
    goal: "Explain vectors and state space",
    guardianRevealUnlocked: false,
    docIdFilter: "Quantum_Mechanics_Notes.md",
  });

  assert.ok(runResult.citations.length > 0);
  for (const c of runResult.citations) {
    assert.equal(c.docId, "Quantum_Mechanics_Notes.md");
  }
  const searchStep = runResult.steps.find((s) => s.tool === "search_corpus");
  assert.ok(searchStep?.observation.includes("Quantum_Mechanics_Notes.md"));

  console.log("[PASS] Document Scoped Retrieval & Agent Orchestration Harness: strict isolation verified");
}

function verifyMultiFormatDocumentExporters(): void {
  const sampleExportData: DocumentExportData = {
    title: "一元二次方程根的判别式核心讲义",
    markdown: `# 一元二次方程核心考点

> 判别式 \\Delta = b^2 - 4ac 决定实根个数。必须在标准形式 ax^2 + bx + c = 0 (a \\neq 0) 下计算。

## 判别式三种情形
- 当 \\Delta > 0 时，有两个不相等的实数根
- 当 \\Delta = 0 时，有两个相等的实数根
- 当 \\Delta < 0 时，无实数根

### 易错提醒
如果二次项系数含字母，必须先确保二次项系数不为零！`,
    mode: "k12",
    citations: [
      {
        docId: "K12_一元二次方程精讲.md",
        page: 1,
        excerpt: "判别式 Delta = b^2 - 4ac，Delta > 0 两个不等实根，Delta = 0 两个相等实根",
      },
    ],
    quiz: {
      quizId: "quiz-root-1",
      conceptTopic: "一元二次方程判别式",
      question: "当 \\Delta < 0 时，一元二次方程在实数范围内有几个实数根？",
      options: ["0个（无实数根）", "1个", "2个", "无数个"],
      correctIndex: 0,
      explanation: "判别式小于0时，平方根在实数集无意义，因此无实数根。",
    },
  };

  // 1. Verify Word (.docx) export
  const docxBytes = exportDocx(sampleExportData);
  assert.ok(docxBytes instanceof Uint8Array, "exportDocx must return Uint8Array");
  assert.ok(docxBytes.length > 500, "Docx file size should be reasonable (> 500 bytes)");
  const docxUnzipped = fflate.unzipSync(docxBytes);
  assert.ok(docxUnzipped["word/document.xml"], "Docx must contain word/document.xml");
  assert.ok(docxUnzipped["[Content_Types].xml"], "Docx must contain [Content_Types].xml");
  const docXmlStr = fflate.strFromU8(docxUnzipped["word/document.xml"]!);
  assert.ok(docXmlStr.includes("一元二次方程核心考点"), "Docx document.xml must include heading");
  assert.ok(docXmlStr.includes("K12_一元二次方程精讲.md"), "Docx document.xml must include citation table");
  assert.ok(docXmlStr.includes("当 \\Delta &lt; 0 时，一元二次方程在实数范围内有几个实数根？"), "Docx must include quiz cards");

  // 2. Verify Excel (.xlsx) export
  const xlsxBytes = exportXlsx(sampleExportData);
  assert.ok(xlsxBytes instanceof Uint8Array, "exportXlsx must return Uint8Array");
  assert.ok(xlsxBytes.length > 500, "Xlsx file size should be reasonable (> 500 bytes)");
  const xlsxUnzipped = fflate.unzipSync(xlsxBytes);
  assert.ok(xlsxUnzipped["xl/workbook.xml"], "Xlsx must contain xl/workbook.xml");
  assert.ok(xlsxUnzipped["xl/worksheets/sheet1.xml"], "Xlsx must contain sheet1.xml (知识笔记清单)");
  assert.ok(xlsxUnzipped["xl/worksheets/sheet2.xml"], "Xlsx must contain sheet2.xml (掌握度题库)");
  const sheet1XmlStr = fflate.strFromU8(xlsxUnzipped["xl/worksheets/sheet1.xml"]!);
  assert.ok(sheet1XmlStr.includes("一元二次方程核心考点"), "Xlsx sheet1 must include heading");
  assert.ok(sheet1XmlStr.includes("K12_一元二次方程精讲.md"), "Xlsx sheet1 must include citation");
  const sheet2XmlStr = fflate.strFromU8(xlsxUnzipped["xl/worksheets/sheet2.xml"]!);
  assert.ok(sheet2XmlStr.includes("一元二次方程在实数范围内有几个实数根"), "Xlsx sheet2 must include quiz");

  // 3. Verify PDF (.pdf) export
  const pdfBytes = exportPdf(sampleExportData);
  assert.ok(pdfBytes instanceof Uint8Array, "exportPdf must return Uint8Array");
  assert.ok(pdfBytes.length > 500, "Pdf file size should be reasonable (> 500 bytes)");
  const pdfHead = String.fromCharCode(...pdfBytes.subarray(0, 8));
  assert.ok(pdfHead.startsWith("%PDF-1.4"), "PDF must have %PDF-1.4 magic header");
  const pdfTail = String.fromCharCode(...pdfBytes.subarray(pdfBytes.length - 64));
  assert.ok(pdfTail.includes("%%EOF"), "PDF must conclude with %%EOF trailer marker");
  const pdfFullStr = String.fromCharCode(...pdfBytes);
  assert.ok(pdfFullStr.includes("/STSong-Light"), "PDF must embed STSong-Light CJK font descriptor");
  assert.ok(pdfFullStr.includes("/UniGB-UTF16-H"), "PDF must use UniGB-UTF16-H CJK encoding");

  console.log(
    `[PASS] Multi-Format Exporter Harness: docx (${docxBytes.length}B), xlsx (${xlsxBytes.length}B), pdf (${pdfBytes.length}B) validated`
  );
}

verify150TurnPerformance();
verifyHybridRagGoldenEval();
verifyDocumentScopedRetrievalAndFiltering();
verifyAuditableMemoryInvariants();
verifyK12SocraticAndSecretRedaction();
verifyAutonomousLearningAgentLoop();
await verifyMultiFormatDocumentIngestion();
verifyMultiFormatDocumentExporters();
console.log("\nALL DIFFERENTIAL & INVARIANT HARNESS CHECKS PASSED.");
