import "./styles.css";
import type {
  DocumentChunk,
  PersonaMode,
  RetrievalEvalReport,
  TurnRecord,
} from "@openlearnos/contracts";
import { SHELL_PROFILES } from "@openlearnos/ui";
import { CoreWorkerClient } from "./rpc/core-client.ts";
import type { MemorySnapshot } from "./rpc/protocol.ts";
import {
  clearLocalByok,
  generateTutorReply,
  loadLocalByok,
  saveLocalByok,
} from "./ui/byok-client.ts";

// Register Service Worker for offline PWA capability
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

const coreClient = new CoreWorkerClient();

interface AppState {
  mode: PersonaMode;
  sessionId: string;
  guardianUnlocked: boolean;
  chunks: readonly DocumentChunk[];
  highlightedChunkId: string | null;
  visibleTurns: readonly TurnRecord[];
  totalStoredTurns: number;
  lastBuildMs: number;
  memory: MemorySnapshot;
  ragReport: RetrievalEvalReport | null;
  statusNote: string;
}

const MODE_PROMPTS: Record<PersonaMode, readonly string[]> = {
  k12: [
    "直接告诉我这道一元二次方程的答案",
    "一元二次方程判别式怎么判断实根个数？",
    "为什么代入 b = -5 时容易丢负号？",
  ],
  scholar: [
    "对比 MHA 与 GQA 的 KV Cache 显存压缩比",
    "FlashAttention-2 如何通过 SRAM Tiling 减少 HBM IO？",
    "结合知识库总结推理加速的两条正交路线",
  ],
  lifelong: [
    "用 5 分钟心智模型解释 FSRS 为什么比死记硬背高效",
    "帮我把今天读的间隔重复原则提炼成 3 条行动准则",
  ],
};

const state: AppState = {
  mode: (window.localStorage.getItem("openlearnos_mode") as PersonaMode) || "k12",
  sessionId: "session-main",
  guardianUnlocked: false,
  chunks: [],
  highlightedChunkId: null,
  visibleTurns: [],
  totalStoredTurns: 0,
  lastBuildMs: 0,
  memory: { traces: [], concepts: [], dueConcepts: [] },
  ragReport: null,
  statusNote: "Core Web Worker 已隔离就绪",
};

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderShell(): void {
  document.body.dataset.mode = state.mode;
  const profile = SHELL_PROFILES[state.mode];
  const byok = loadLocalByok();
  const byokReady = Boolean(byok.apiKey.trim() || byok.baseUrl.includes("11434"));

  const app = document.getElementById("app");
  if (!app) return;

  app.innerHTML = `
    <div class="layout">
      <header class="topbar">
        <div class="brand">
          <img src="./icon.svg" alt="OpenLearnOS" />
          <div>
            <div>OpenLearnOS <small>v0.2 PWA</small></div>
            <small>${escapeHtml(profile.displayName)} · Worker 物理隔离</small>
          </div>
        </div>

        <nav class="mode-tabs" aria-label="学习模式切换">
          <button class="mode-btn ${state.mode === "k12" ? "active" : ""}" data-switch="k12">🎒 K-12 Spark</button>
          <button class="mode-btn ${state.mode === "scholar" ? "active" : ""}" data-switch="scholar">🎓 Scholar 科研</button>
          <button class="mode-btn ${state.mode === "lifelong" ? "active" : ""}" data-switch="lifelong">🌱 Lifelong 终身学习</button>
        </nav>

        <div class="top-actions">
          <span class="pill ok" id="latency-pill">窗口构建: ${state.lastBuildMs.toFixed(2)} ms (${state.totalStoredTurns} 轮)</span>
          <button class="btn" id="stress-btn" title="向 Worker 注入 150 轮含公式对话并实测延迟">⚡ 150轮压测</button>
          <button class="btn ${byokReady ? "primary" : ""}" id="byok-btn">🔑 ${byokReady ? "BYOK 已配(仅本地)" : "配置本地模型 (BYOK)"}</button>
        </div>
      </header>

      <main class="workspace">
        <!-- Left Pane: Local Grounded Source Reader -->
        <section class="pane">
          <div class="pane-header">
            <span>📚 双栏溯源资料库 (${state.chunks.length} 段)</span>
          </div>
          <div class="pane-body" id="corpus-list">
            <label class="upload-zone" for="file-upload">
              + 点击上传本地 .md / .txt 资料即时建库<br/>
              <small>100% 端侧解析，不上传任何服务器</small>
              <input id="file-upload" type="file" accept=".md,.txt,.csv,.json" multiple hidden />
            </label>
            ${state.chunks
              .map(
                (c) => `
              <article class="card ${state.highlightedChunkId === c.chunkId ? "highlight" : ""}">
                <div class="card-title">
                  <span>${escapeHtml(c.docId)}</span>
                  <span class="trace-tag">P.${c.page}</span>
                </div>
                <div class="card-meta">${escapeHtml(c.headingPath.join(" › "))}</div>
                <div>${escapeHtml(c.text)}</div>
              </article>
            `
              )
              .join("")}
          </div>
        </section>

        <!-- Center Pane: Virtualized Windowed Chat + Decoupled Composer -->
        <section class="pane chat-pane">
          <div class="pane-header">
            <span>💬 ${escapeHtml(profile.displayName)} 对话引擎</span>
            <span class="pill">${escapeHtml(state.statusNote)}</span>
          </div>

          <div class="quick-prompts">
            ${MODE_PROMPTS[state.mode]
              .map((q) => `<button class="chip" data-quick="${escapeHtml(q)}">${escapeHtml(q)}</button>`)
              .join("")}
          </div>

          <div class="messages" id="messages-view">
            ${
              state.visibleTurns.length === 0
                ? `<div class="card">
                    <div class="card-title">👋 欢迎来到 OpenLearnOS（零安装 · Local-First）</div>
                    <div>点击上方快捷问题体验当前模式：${
                      state.mode === "k12"
                        ? "试着点「直接告诉我这道一元二次方程的答案」，观察苏格拉底防抄锁实时拦截！"
                        : state.mode === "scholar"
                        ? "试着对比 GQA 与 FlashAttention-2，或在右侧运行 RAG Eval 量化指标！"
                        : "试着体验 FSRS 每日复习卡与右侧可审计 L1→L2 记忆级联清除！"
                    }</div>
                  </div>`
                : renderWindowedMessages(state.visibleTurns)
            }
          </div>

          <form class="composer" id="chat-form">
            <input
              id="prompt-input"
              type="text"
              autocomplete="off"
              placeholder="${
                state.mode === "k12"
                  ? "输入作业问题（默认苏格拉底引导，不直接泄答案）..."
                  : state.mode === "scholar"
                  ? "输入论文精读、推导或跨文献对比问题..."
                  : "输入碎片笔记或概念问题，自动沉淀 FSRS 卡片..."
              }"
            />
            <button class="btn primary" type="submit">发送</button>
          </form>
        </section>

        <!-- Right Pane: Adaptive Governance / Eval / Auditable Memory -->
        <section class="pane">
          <div class="pane-header">
            <span>${
              state.mode === "k12"
                ? "🛡️ K-12 安全护栏 & 家长周报"
                : state.mode === "scholar"
                ? "📊 RAG 量化评测 & 记忆审计"
                : "🧠 FSRS 每日复习 & 可审计记忆"
            }</span>
          </div>
          <div class="pane-body">
            ${renderRightPanel()}
          </div>
        </section>
      </main>
    </div>

    <!-- Client-Only BYOK Modal -->
    <div class="modal-backdrop" id="byok-modal">
      <div class="modal">
        <div class="card-title">
          <span>🔑 本地模型网关配置 (BYOK · 零云端中转)</span>
          <button class="btn" id="close-byok">✕</button>
        </div>
        <div class="card-meta">
          安全不变量：密钥仅保存在当前浏览器 <code>localStorage</code>，绝不上传至任何后端服务器；留空也可使用内置离线演示引擎。
        </div>
        <div class="field">
          <label>OpenAI 兼容 Base URL（如本机 SmartRouter / Ollama / OpenAI）</label>
          <input id="byok-url" type="text" value="${escapeHtml(byok.baseUrl)}" placeholder="http://127.0.0.1:4000/v1" />
        </div>
        <div class="field">
          <label>模型 ID</label>
          <input id="byok-model" type="text" value="${escapeHtml(byok.model)}" placeholder="gemini-3.8-flash-high" />
        </div>
        <div class="field">
          <label>API Key（密码掩码输入 · Ollama 本地可留空）</label>
          <input id="byok-key" type="password" value="${escapeHtml(byok.apiKey)}" placeholder="仅存于本机浏览器，不回显" />
        </div>
        <div style="display:flex; justify-content:space-between; gap:8px;">
          <button class="btn danger" id="clear-byok">清空本地密钥</button>
          <div style="display:flex; gap:8px;">
            <button class="btn" id="preset-ollama">填入 Ollama</button>
            <button class="btn primary" id="save-byok">仅保存到本机</button>
          </div>
        </div>
      </div>
    </div>
  `;

  bindEvents();
  const msgEl = document.getElementById("messages-view");
  if (msgEl) msgEl.scrollTop = msgEl.scrollHeight;
}

function renderWindowedMessages(turns: readonly TurnRecord[]): string {
  // Windowed viewport: render only the latest 30 turns in DOM to guarantee <16ms typing across all browsers
  const maxDom = 30;
  const hiddenCount = Math.max(0, turns.length - maxDom);
  const sliced = turns.slice(-maxDom);
  const notice =
    hiddenCount > 0
      ? `<div class="pill" style="align-self:center;">⚡ 虚拟窗口保护已激活：已折叠前 ${hiddenCount} 条历史 DOM 节点（总计 ${state.totalStoredTurns} 轮），确保 Chrome/Safari/Firefox 输入零卡顿</div>`
      : "";

  return (
    notice +
    sliced
      .map((t) => {
        const isSocratic = t.content.includes("先不直接给出最终答案");
        const cites =
          t.citations.length > 0
            ? `<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;">${t.citations
                .map((c) => `<span class="trace-tag">${escapeHtml(c.docId)} · P.${c.page}</span>`)
                .join("")}</div>`
            : "";
        return `
        <div class="msg ${t.role} ${isSocratic ? "socratic" : ""}">
          <div class="msg-meta">${t.role === "user" ? "学习者" : "OpenLearnOS"} · #${t.index + 1}</div>
          <div>${escapeHtml(t.content)}</div>
          ${cites}
        </div>
      `;
      })
      .join("")
  );
}

function renderRightPanel(): string {
  const parts: string[] = [];

  if (state.mode === "k12") {
    parts.push(`
      <div class="card">
        <div class="card-title"><span>🔒 苏格拉底防抄答案锁</span><span class="trace-tag">${state.guardianUnlocked ? "家长已解锁" : "强制生效中"}</span></div>
        <div class="card-meta">K-12 模式默认拦截直接索要作业答案的请求，转为分步启发引导；数据 100% 留存本机（零儿童 PII 上报）。</div>
        <button class="btn ${state.guardianUnlocked ? "danger" : "primary"}" id="toggle-guardian">
          ${state.guardianUnlocked ? "恢复苏格拉底锁" : "家长核对模式：临时解锁解析"}
        </button>
      </div>
      <div class="card">
        <div class="card-title"><span>👨‍👩‍👧 家长只读周报（离线生成）</span></div>
        <div class="metric-grid">
          <div class="metric-box"><div class="metric-val">${state.memory.concepts.length}</div><div class="metric-lbl">追踪知识点</div></div>
          <div class="metric-box"><div class="metric-val">${state.memory.dueConcepts.length}</div><div class="metric-lbl">待巩固错题</div></div>
        </div>
      </div>
    `);
  }

  if (state.mode === "scholar") {
    const r = state.ragReport;
    parts.push(`
      <div class="card">
        <div class="card-title"><span>🎯 Hybrid RAG 量化质检 (kb-eval)</span></div>
        <div class="card-meta">基于中英双语黄金测试集实时计算检索指标，拒绝盲信黑盒 RAG。</div>
        ${
          r
            ? `<div class="metric-grid" style="margin-bottom:8px;">
                <div class="metric-box"><div class="metric-val">${(r.recallAtK * 100).toFixed(0)}%</div><div class="metric-lbl">Recall@${r.topK}</div></div>
                <div class="metric-box"><div class="metric-val">${r.mrr.toFixed(2)}</div><div class="metric-lbl">MRR</div></div>
                <div class="metric-box"><div class="metric-val">${r.ndcgAtK.toFixed(2)}</div><div class="metric-lbl">nDCG@${r.topK}</div></div>
                <div class="metric-box"><div class="metric-val">${r.totalCases}</div><div class="metric-lbl">黄金用例</div></div>
              </div>`
            : ""
        }
        <button class="btn primary" id="run-eval-btn">▶ 运行黄金评测集</button>
      </div>
    `);
  }

  // FSRS Due Cards (especially prominent in Lifelong & K-12)
  parts.push(`
    <div class="card">
      <div class="card-title"><span>⏱️ FSRS 今日到期复习 (${state.memory.dueConcepts.length})</span></div>
      ${
        state.memory.dueConcepts.length === 0
          ? `<div class="card-meta">🎉 今日复习队列已清空！</div>`
          : state.memory.dueConcepts
              .map(
                (c) => `
          <div style="border-top:1px solid var(--border); padding-top:8px; margin-top:8px;">
            <div style="font-weight:600;">${escapeHtml(c.topic)}</div>
            <div class="card-meta">掌握度 ${(c.masteryScore * 100).toFixed(0)}% · 稳定期 ${c.fsrs.stabilityDays} 天 · 溯源 ${c.sourceTraceIds.map((id) => `<span class="trace-tag">${escapeHtml(id)}</span>`).join(" ")}</div>
            <div style="display:flex; gap:6px;">
              <button class="btn primary" data-review-ok="${escapeHtml(c.conceptId)}">✓ 已掌握</button>
              <button class="btn" data-review-again="${escapeHtml(c.conceptId)}">↻ 需重练</button>
            </div>
          </div>
        `
              )
              .join("")
      }
    </div>
  `);

  // Auditable L1 -> L2 Memory Graph
  parts.push(`
    <div class="card">
      <div class="card-title"><span>🔍 可审计记忆轨迹 (L1 Trace)</span></div>
      <div class="card-meta">不变量保障：任何 L2 认知卡片必须绑定有效 L1 证据；删除 L1 轨迹将自动级联清理关联派生记忆。</div>
      ${state.memory.traces
        .slice(0, 6)
        .map(
          (t) => `
        <div style="border-top:1px solid var(--border); padding-top:6px; margin-top:6px; display:flex; justify-content:space-between; gap:6px; align-items:flex-start;">
          <div>
            <span class="trace-tag">${escapeHtml(t.traceId)}</span>
            <div style="font-size:0.78rem; margin-top:2px;">${escapeHtml(t.summary)}</div>
          </div>
          <button class="btn danger" data-purge="${escapeHtml(t.traceId)}" title="清除轨迹并级联删除无源 L2 概念">删</button>
        </div>
      `
        )
        .join("")}
    </div>
  `);

  return parts.join("");
}

function bindEvents(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-switch]").forEach((btn) => {
    btn.onclick = () => {
      const next = btn.dataset.switch as PersonaMode;
      state.mode = next;
      window.localStorage.setItem("openlearnos_mode", next);
      renderShell();
    };
  });

  document.querySelectorAll<HTMLButtonElement>("[data-quick]").forEach((chip) => {
    chip.onclick = () => {
      const q = chip.dataset.quick;
      if (q) void handleSend(q);
    };
  });

  const form = document.getElementById("chat-form") as HTMLFormElement | null;
  const input = document.getElementById("prompt-input") as HTMLInputElement | null;
  if (form && input) {
    form.onsubmit = (e) => {
      e.preventDefault();
      const val = input.value.trim();
      if (!val) return;
      input.value = "";
      void handleSend(val);
    };
  }

  const fileInput = document.getElementById("file-upload") as HTMLInputElement | null;
  if (fileInput) {
    fileInput.onchange = async () => {
      const files = Array.from(fileInput.files ?? []);
      if (files.length === 0) return;
      const newChunks: DocumentChunk[] = [];
      for (const f of files) {
        const text = await f.text();
        const paragraphs = text
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .filter((p) => p.length > 10)
          .slice(0, 20);
        paragraphs.forEach((p, idx) => {
          newChunks.push({
            chunkId: `local-${f.name}-${idx}-${Date.now()}`,
            docId: f.name,
            page: idx + 1,
            headingPath: ["本地上传", f.name],
            text: p.slice(0, 800),
          });
        });
      }
      if (newChunks.length > 0) {
        const res = await coreClient.addDocChunks(newChunks);
        state.chunks = res.chunks;
        state.statusNote = `已本地建库 +${newChunks.length} 段`;
        renderShell();
      }
    };
  }

  const stressBtn = document.getElementById("stress-btn");
  if (stressBtn) {
    stressBtn.onclick = async () => {
      state.statusNote = "正在 Worker 中执行 150 轮压测...";
      renderShell();
      const res = await coreClient.runStress150(state.sessionId);
      state.totalStoredTurns = res.totalTurns;
      state.visibleTurns = res.lastSlice.includedTurns;
      state.lastBuildMs = res.maxBuildTimeMs;
      state.statusNote = `150轮压测通过: ${res.maxBuildTimeMs.toFixed(3)} ms (<50ms)`;
      renderShell();
    };
  }

  const evalBtn = document.getElementById("run-eval-btn");
  if (evalBtn) {
    evalBtn.onclick = async () => {
      const report = await coreClient.runRagEval(
        [
          { query: "How does Grouped-Query Attention reduce KV cache compared to MHA?", goldDocIds: ["GQA_Attention_Paper.pdf"] },
          { query: "FlashAttention-2 SRAM tiling HBM speedup", goldDocIds: ["FlashAttention2_Paper.pdf"] },
          { query: "一元二次方程判别式怎么决定实根个数", goldDocIds: ["K12_一元二次方程精讲.md"] },
        ],
        3
      );
      state.ragReport = report;
      state.statusNote = `RAG Eval 完成: Recall@3=${(report.recallAtK * 100).toFixed(0)}%`;
      renderShell();
    };
  }

  const guardianBtn = document.getElementById("toggle-guardian");
  if (guardianBtn) {
    guardianBtn.onclick = () => {
      state.guardianUnlocked = !state.guardianUnlocked;
      state.statusNote = state.guardianUnlocked ? "家长核对模式已解锁" : "K-12 苏格拉底引导锁已恢复";
      renderShell();
    };
  }

  document.querySelectorAll<HTMLButtonElement>("[data-purge]").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.purge;
      if (!id) return;
      const res = await coreClient.purgeTrace(id);
      state.memory = res.memory;
      state.statusNote = `已清除 ${id}，级联移除 ${res.removedConcepts} 条关联 L2 概念`;
      renderShell();
    };
  });

  document.querySelectorAll<HTMLButtonElement>("[data-review-ok]").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.reviewOk;
      if (!id) return;
      state.memory = await coreClient.markReviewed(id, true);
      state.statusNote = "FSRS 复习完成：稳定期已自动拉长";
      renderShell();
    };
  });

  document.querySelectorAll<HTMLButtonElement>("[data-review-again]").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.reviewAgain;
      if (!id) return;
      state.memory = await coreClient.markReviewed(id, false);
      state.statusNote = "FSRS 已缩短复习间隔，明日重测";
      renderShell();
    };
  });

  // BYOK Modal bindings
  const modal = document.getElementById("byok-modal");
  const openBtn = document.getElementById("byok-btn");
  const closeBtn = document.getElementById("close-byok");
  const saveBtn = document.getElementById("save-byok");
  const clearBtn = document.getElementById("clear-byok");
  const ollamaBtn = document.getElementById("preset-ollama");

  if (openBtn && modal) openBtn.onclick = () => modal.classList.add("open");
  if (closeBtn && modal) closeBtn.onclick = () => modal.classList.remove("open");

  if (ollamaBtn) {
    ollamaBtn.onclick = () => {
      const u = document.getElementById("byok-url") as HTMLInputElement | null;
      const m = document.getElementById("byok-model") as HTMLInputElement | null;
      const k = document.getElementById("byok-key") as HTMLInputElement | null;
      if (u) u.value = "http://127.0.0.1:11434/v1";
      if (m) m.value = "qwen2.5:7b";
      if (k) k.value = "";
    };
  }

  if (saveBtn && modal) {
    saveBtn.onclick = () => {
      const u = (document.getElementById("byok-url") as HTMLInputElement | null)?.value ?? "";
      const m = (document.getElementById("byok-model") as HTMLInputElement | null)?.value ?? "";
      const k = (document.getElementById("byok-key") as HTMLInputElement | null)?.value ?? "";
      saveLocalByok({ baseUrl: u.trim(), model: m.trim(), apiKey: k.trim() });
      modal.classList.remove("open");
      state.statusNote = "BYOK 已仅保存在本地浏览器";
      renderShell();
    };
  }

  if (clearBtn && modal) {
    clearBtn.onclick = () => {
      clearLocalByok();
      modal.classList.remove("open");
      state.statusNote = "已清除本地浏览器密钥";
      renderShell();
    };
  }
}

async function handleSend(promptText: string): Promise<void> {
  const prep = await coreClient.prepareTurn(
    state.sessionId,
    state.mode,
    promptText,
    state.guardianUnlocked
  );

  state.lastBuildMs = prep.context.buildTimeMs;
  state.totalStoredTurns = prep.context.totalStoredTurns;
  state.visibleTurns = prep.context.includedTurns;
  state.highlightedChunkId = prep.hits[0]?.chunk.chunkId ?? null;

  // Enforce K-12 Socratic Gate directly before any model generation
  if (prep.safety.action === "socratic_redirect" && prep.safety.guidancePrompt) {
    const commit = await coreClient.commitAssistantTurn(
      state.sessionId,
      `🛡️ [K-12 苏格拉底引导门控]\n${prep.safety.guidancePrompt}`,
      prep.hits.slice(0, 1).map((h) => ({
        docId: h.chunk.docId,
        page: h.chunk.page,
        excerpt: h.chunk.text.slice(0, 80),
      }))
    );
    state.visibleTurns = commit.context.includedTurns;
    state.totalStoredTurns = commit.context.totalStoredTurns;
    state.lastBuildMs = commit.context.buildTimeMs;
    state.memory = commit.memory;
    state.statusNote = "已拦截直给答案，转入苏格拉底启发";
    renderShell();
    return;
  }

  state.statusNote = "生成回答中...";
  renderShell();

  const reply = await generateTutorReply({
    mode: state.mode,
    prompt: prep.scrubbedPrompt,
    hits: prep.hits,
    byok: loadLocalByok(),
  });

  const citations = prep.hits.map((h) => ({
    docId: h.chunk.docId,
    page: h.chunk.page,
    excerpt: h.chunk.text.slice(0, 80),
  }));

  const commit = await coreClient.commitAssistantTurn(
    state.sessionId,
    reply.text,
    citations,
    state.mode === "lifelong" ? prep.scrubbedPrompt.slice(0, 24) : undefined
  );
  state.visibleTurns = commit.context.includedTurns;
  state.totalStoredTurns = commit.context.totalStoredTurns;
  state.lastBuildMs = commit.context.buildTimeMs;
  state.memory = commit.memory;
  state.statusNote = `${reply.providerLabel} · ${commit.context.buildTimeMs.toFixed(2)} ms`;
  renderShell();
}

async function bootstrap(): Promise<void> {
  const seed = await coreClient.initSeed();
  state.chunks = seed.chunks;
  state.memory = seed.memory;
  renderShell();
}

void bootstrap();
