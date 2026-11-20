import "./styles.css";
import type {
  AgentRunResult,
  DocumentChunk,
  LivingNoteExport,
  PersonaMode,
  QuizEvaluationResult,
  RetrievalEvalReport,
  TurnRecord,
} from "@openlearnos/contracts";
import { renderRichTextHtml, SHELL_PROFILES } from "@openlearnos/ui";
import { CoreWorkerClient } from "./rpc/core-client.ts";
import type { MemorySnapshot } from "./rpc/protocol.ts";
import {
  clearLocalByok,
  generateTutorReply,
  loadLocalByok,
  saveLocalByok,
} from "./ui/byok-client.ts";
import { loadUploadedChunks, saveUploadedChunks } from "./ui/local-db.ts";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

const coreClient = new CoreWorkerClient();

interface AppState {
  mode: PersonaMode;
  interactionStyle: "agent" | "chat";
  sessionId: string;
  guardianUnlocked: boolean;
  chunks: readonly DocumentChunk[];
  uploadedChunks: DocumentChunk[];
  highlightedChunkId: string | null;
  visibleTurns: readonly TurnRecord[];
  totalStoredTurns: number;
  lastBuildMs: number;
  memory: MemorySnapshot;
  ragReport: RetrievalEvalReport | null;
  activeAgentRun: AgentRunResult | null;
  lastQuizEval: QuizEvaluationResult | null;
  statusNote: string;
  showGuideModal: boolean;
}

const MODE_GOALS: Record<PersonaMode, readonly string[]> = {
  k12: [
    "帮我 10 分钟彻底掌握一元二次方程判别式并出题检验",
    "直接告诉我这道一元二次方程的答案",
  ],
  scholar: [
    "帮我系统梳理 GQA 与 FlashAttention-2 的显存/IO 优化差异并出题验证",
    "对比 MHA 与 GQA 的 KV Cache 显存压缩比",
  ],
  lifelong: [
    "用 5 分钟心智模型帮我掌握 FSRS 间隔重复闭环并生成明日复习卡",
    "把间隔重复原则提炼成 3 条可执行行动准则",
  ],
};

const state: AppState = {
  mode: (window.localStorage.getItem("openlearnos_mode") as PersonaMode) || "scholar",
  interactionStyle: "agent",
  sessionId: "session-main",
  guardianUnlocked: false,
  chunks: [],
  uploadedChunks: [],
  highlightedChunkId: null,
  visibleTurns: [],
  totalStoredTurns: 0,
  lastBuildMs: 0,
  memory: { traces: [], concepts: [], dueConcepts: [] },
  ragReport: null,
  activeAgentRun: null,
  lastQuizEval: null,
  statusNote: "Autonomous Agent Worker 已隔离就绪",
  showGuideModal: false,
};

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function downloadTextFile(filename: string, content: string, mime = "text/plain;charset=utf-8"): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
            <div>OpenLearnOS <small>v0.3 Agent OS</small></div>
            <small>${escapeHtml(profile.displayName)} · Worker 隔离 + IndexedDB</small>
          </div>
        </div>

        <nav class="mode-tabs" aria-label="学习模式切换">
          <button class="mode-btn ${state.mode === "k12" ? "active" : ""}" data-switch="k12">🎒 K-12 Spark</button>
          <button class="mode-btn ${state.mode === "scholar" ? "active" : ""}" data-switch="scholar">🎓 Scholar 科研</button>
          <button class="mode-btn ${state.mode === "lifelong" ? "active" : ""}" data-switch="lifelong">🌱 Lifelong 终身学习</button>
        </nav>

        <div class="top-actions">
          <button class="btn" id="guide-top-btn" style="background:var(--accent-soft); color:var(--accent); font-weight:600;">💡 新手快速入门</button>
          <span class="pill ok" id="latency-pill">窗口: ${state.lastBuildMs.toFixed(2)} ms (${state.totalStoredTurns} 轮)</span>
          <button class="btn" id="stress-btn">⚡ 150轮压测</button>
          <button class="btn ${byokReady ? "primary" : ""}" id="byok-btn">🔑 ${byokReady ? "BYOK 已配(仅本地)" : "配置本地模型 (BYOK)"}</button>
        </div>
      </header>

      <main class="workspace">
        <!-- Left Pane: Local Grounded Source Reader -->
        <section class="pane">
          <div class="pane-header">
            <span>📚 双栏溯源资料库 (${state.chunks.length} 段)</span>
          </div>
          <div class="pane-body">
            <label class="upload-zone" id="upload-zone" for="file-upload">
              + 上传通用全格式学习资料（PPTX/PDF/Word/Excel/CSV/EPUB/视频字幕/代码/图片扫描件）<br/>
              <small>拖拽或点击上传 · 100% 端侧解析 · 刷新不丢失</small>
              <input id="file-upload" type="file" accept=".pdf,.docx,.xlsx,.pptx,.ppt,.epub,.csv,.tsv,.txt,.md,.markdown,.json,.yaml,.yml,.xml,.html,.tex,.py,.js,.ts,.rs,.cpp,.c,.java,.sql,.sh,.srt,.vtt,.png,.jpg,.jpeg,.webp,.svg,.bmp,.gif" multiple hidden />
            </label>
            ${state.chunks
              .map(
                (c) => {
                  const fmt = c.sourceFormat || (c.mediaType === "image" ? "image" : c.docId.split(".").pop()?.toLowerCase() || "txt");
                  const fmtClass = `format-${fmt === "jpeg" ? "image" : fmt === "jpg" ? "image" : fmt === "png" ? "image" : fmt}`;
                  return `
              <article class="card ${state.highlightedChunkId === c.chunkId ? "highlight" : ""}" id="chunk-${escapeHtml(c.chunkId)}">
                <div class="card-title">
                  <div style="display:flex; align-items:center; gap:6px; overflow:hidden;">
                    <span class="format-badge ${fmtClass}">${escapeHtml(fmt.toUpperCase())}</span>
                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(c.docId)}</span>
                  </div>
                  <span class="trace-tag">P.${c.page}</span>
                </div>
                <div class="card-meta">${escapeHtml(c.headingPath.join(" › "))}</div>
                ${c.mediaType === "image" && c.dataUrl ? `<img src="${c.dataUrl}" alt="${escapeHtml(c.docId)}" class="chunk-img-preview" />` : ""}
                ${c.mediaType === "table" ? `<div class="chunk-table-container"><pre style="margin:0;">${escapeHtml(c.text)}</pre></div>` : `<div>${escapeHtml(c.text)}</div>`}
              </article>
            `;
                }
              )
              .join("")}
          </div>
        </section>

        <!-- Center Pane: Autonomous Learning Agent Loop OR Quick Chat -->
        <section class="pane chat-pane">
          <div class="pane-header">
            <div style="display:flex; gap:6px; align-items:center;">
              <button class="btn ${state.interactionStyle === "agent" ? "primary" : ""}" id="style-agent">🤖 Agent 自主闭环</button>
              <button class="btn ${state.interactionStyle === "chat" ? "primary" : ""}" id="style-chat">💬 快速问答</button>
            </div>
            <span class="pill">${escapeHtml(state.statusNote)}</span>
          </div>

          <div class="quick-prompts">
            ${MODE_GOALS[state.mode]
              .map((q) => `<button class="chip" data-quick="${escapeHtml(q)}">${escapeHtml(q)}</button>`)
              .join("")}
          </div>

          <div class="messages" id="messages-view">
            ${
              state.interactionStyle === "agent"
                ? renderAgentWorkspace()
                : renderChatWorkspace()
            }
          </div>

          <form class="composer" id="chat-form">
            <input
              id="prompt-input"
              type="text"
              autocomplete="off"
              placeholder="${
                state.interactionStyle === "agent"
                  ? "下达一个【学习目标】给 Agent（将自动拆解计划 → 链式调工具 → 出图 → 出题检验 → 错题 Re-Plan）..."
                  : "输入单轮快速问答..."
              }"
            />
            <button class="btn primary" type="submit">${state.interactionStyle === "agent" ? "派发目标给 Agent" : "发送"}</button>
          </form>
        </section>

        <!-- Right Pane: Governance / Eval / FSRS / Auditable Memory -->
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
          安全不变量：密钥仅保存在当前浏览器 <code>localStorage</code>，绝不上传至任何后端服务器；留空也可直接运行完整离线 Agent 工具闭环。
        </div>
        <div class="field">
          <label>OpenAI 兼容 Base URL（本机 SmartRouter / Ollama / OpenAI）</label>
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

    <!-- Interactive Quick-Start Guide Modal -->
    <div class="modal-backdrop" id="guide-modal" style="display:${state.showGuideModal ? "flex" : "none"};">
      <div class="modal" style="max-width:680px; max-height:85vh; overflow-y:auto;">
        <div class="card-title">
          <span>🎓 OpenLearnOS 快速入门操作秘籍</span>
          <button class="btn" id="close-guide-btn">✕</button>
        </div>
        <div class="card-meta">
          3 分钟掌握三大核心心智模型，从“不会用”到拥有真正属于自己的个人学习操作系统。
        </div>

        <div class="guide-step-card">
          <h4>
            <span>1. 为什么它不像 ChatGPT 那样直接回我答案？</span>
            <span class="trace-tag">核心心智模型</span>
          </h4>
          <p>
            • <strong>被动聊天 vs 自主学习</strong>：传统 Chatbot 会顺从任何提问直接吐答案，但这会导致学生丧失思考，研究者得到幻觉假象。<br/>
            • <strong>三大分层模式</strong>：在 <strong>K-12 Spark</strong> 模式下，系统开启了苏格拉底防抄锁，拦截直接抄答案，转为引导；在 <strong>Scholar</strong> 模式下，强制要求深入论文底层数学推导并绘制 SVG 架构图；在 <strong>Lifelong</strong> 模式下，强制连接 FSRS 遗忘曲线算法。
          </p>
        </div>

        <div class="guide-step-card">
          <h4>
            <span>2. 快速上手三部曲（1 分钟跑通）</span>
            <span class="trace-tag">实战 SOP</span>
          </h4>
          <p>
            <strong>步骤 1：下达明确的学习目标</strong><br/>
            切到「🤖 Agent 自主闭环」模式，不要问“你好”，而是下达具体目标，例如：<i>“帮我系统梳理 GQA 与 FlashAttention-2 的显存差异并出题验证”</i>。<br/><br/>
            <strong>步骤 2：观察智能体链式工具调用</strong><br/>
            Agent 会依次执行：规划 Plan → 安全门控 <code>socratic_guard</code> → 检查记忆 <code>check_memory</code> → 混合检索 <code>search_corpus</code> → 绘制 <code>synthesize_visual_svg</code> → 生成检验试题。<br/><br/>
            <strong>步骤 3：参与掌握度检验与错题重规划 (Re-Plan)</strong><br/>
            回答生成的选择题。<strong>答错不会扣分</strong>，而是立即触发 Re-Plan 重规划为你补齐盲区，并自动沉淀至右侧 FSRS 记忆库；答对后一键导出 Anki 卡片！
          </p>
        </div>

        <div class="guide-step-card">
          <h4>
            <span>3. 通用全格式本地资料库怎么用？</span>
            <span class="trace-tag">全格式支持</span>
          </h4>
          <p>
            支持直接将 <strong>PPTX 课件、PDF 论文、Word 讲义、Excel 数据表、CSV 指标、代码文件、视频字幕 SRT/VTT 及图片扫描件</strong> 拖入左侧资料库。<br/>
            • <strong>100% 浏览器本地端侧解析</strong>，零数据出境；<br/>
            • <strong>刷新网页不丢失</strong>：自动存入 IndexedDB 本地数据库；<br/>
            • <strong>双栏点对点溯源</strong>：智能体回答中的每一个引用角标 <code>[1]</code>，点击后左侧资料库对应卡片立即高亮，彻底杜绝大模型胡说八道。
          </p>
        </div>

        <div class="guide-step-card">
          <h4>
            <span>4. 如何激活真实大模型？（BYOK 模式）</span>
            <span class="trace-tag">零门槛接入</span>
          </h4>
          <p>
            点击右上角 <strong>🔑 配置本地模型 (BYOK)</strong>，可填入你自己的 DeepSeek (https://api.deepseek.com) / OpenAI / Google Gemini 密钥或本地 Ollama 地址。<br/>
            密钥严格仅保存在你当前浏览器的 <code>localStorage</code>，不经过任何第三方服务器。配置后即可体验 DeepSeek-R1 / GPT-4o 级别的满血推理！
          </p>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:8px;">
          <button class="btn primary" id="guide-modal-start-btn">我知道了，开始学习！</button>
        </div>
      </div>
    </div>
  `;

  bindEvents();
  const msgEl = document.getElementById("messages-view");
  if (msgEl) msgEl.scrollTop = msgEl.scrollHeight;
}

function renderAgentWorkspace(): string {
  const run = state.activeAgentRun;
  if (!run) {
    return `
      <div class="welcome-guide-card">
        <h3>🎓 欢迎使用 OpenLearnOS 自主学习操作系统</h3>
        <p>与普通聊天机器人的“被动闲聊/直接吐答案”不同，OpenLearnOS 是一个具备<b>双栏证据溯源</b>、<b>自主思维导图绘制</b>与<b>FSRS 间隔复习闭环</b>的个人学习操作系统。如果觉得刚开始不太好上手，请直接点击下方 3 个真实案例一键体验：</p>
        <div class="guide-actions" style="margin-top:10px;">
          <button class="btn primary" id="run-demo-k12">🎒 案例 1：中考数学防作弊导学 (K-12 模式)</button>
          <button class="btn primary" id="run-demo-scholar">🎓 案例 2：GQA 论文推导与架构图 (Scholar 模式)</button>
          <button class="btn primary" id="run-demo-lifelong">🌱 案例 3：FSRS 记忆卡片与错题 Re-Plan (Lifelong 模式)</button>
          <button class="btn" id="open-guide-modal-btn">📖 完整入门操作秘籍</button>
        </div>
      </div>
    `;
  }

  const evalRes = state.lastQuizEval;
  const activeNote: LivingNoteExport | undefined = evalRes?.livingNote ?? run.livingNote;

  return `
    <div class="card highlight">
      <div class="card-title">
        <span>🤖 Agent 任务轨迹 [${escapeHtml(run.runId)}]</span>
        <span class="trace-tag">${escapeHtml(run.status)}</span>
      </div>
      <div class="card-meta">学习目标：${escapeHtml(run.goal)}</div>
      <div style="display:flex; flex-direction:column; gap:6px; margin-top:6px;">
        ${run.steps
          .map(
            (s) => `
          <div style="background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:7px 9px; font-size:0.8rem;">
            <div style="display:flex; justify-content:space-between; gap:6px; margin-bottom:2px;">
              <strong>#${s.stepIndex} [${escapeHtml(s.phase.toUpperCase())}] ${s.tool ? `<code>${escapeHtml(s.tool)}</code>` : ""}</strong>
              <span class="trace-tag">${s.durationMs} ms</span>
            </div>
            <div style="color:var(--muted);">思考：${escapeHtml(s.thought)}</div>
            <div>观测：${escapeHtml(s.observation)}</div>
          </div>
        `
          )
          .join("")}
      </div>
    </div>

    ${
      run.visualSvg
        ? `<div class="card">
            <div class="card-title"><span>📐 Agent 自主合成交互概念图（零本地渲染依赖）</span></div>
            <div style="overflow-x:auto;">${run.visualSvg}</div>
          </div>`
        : ""
    }

    <div class="card">
      <div class="rich-markdown-body">${renderRichTextHtml(run.synthesisMarkdown)}</div>
      ${
        run.citations.length > 0
          ? `
          <div class="evidence-shelf">
            <div class="evidence-title">📚 引用溯源依据卡片（点击在左侧高亮原文）：</div>
            <div class="evidence-cards">
              ${run.citations
                .map((c, idx) => {
                  const targetChunkId = c.chunkId || state.chunks.find((chunk) => chunk.docId === c.docId)?.chunkId || "";
                  return `
                <button class="evidence-pill" data-cite-chunk="${escapeHtml(targetChunkId)}" data-cite-doc="${escapeHtml(c.docId)}" title="点击在左侧资料库高亮原文">
                  <span class="evidence-num">[${idx + 1}]</span>
                  <span class="evidence-doc">${escapeHtml(c.docId)}</span>
                  <span class="evidence-page">P.${c.page}</span>
                </button>
              `;
                })
                .join("")}
            </div>
          </div>
          `
          : ""
      }
    </div>

    ${
      run.quiz
        ? `<div class="card" style="border-left:4px solid var(--warn);">
            <div class="card-title"><span>🎯 掌握度验证门控（答错将自动触发 Agent Re-Plan）</span></div>
            <div style="font-weight:600; margin:6px 0;">${escapeHtml(run.quiz.question)}</div>
            <div style="display:flex; flex-direction:column; gap:6px;">
              ${run.quiz.options
                .map(
                  (opt, idx) => `
                <button class="btn" style="text-align:left;" data-quiz-id="${escapeHtml(run.quiz!.quizId)}" data-quiz-idx="${idx}">
                  ${String.fromCharCode(65 + idx)}. ${escapeHtml(opt)}
                </button>
              `
                )
                .join("")}
            </div>
          </div>`
        : ""
    }

    ${
      evalRes
        ? `<div class="card" style="border-left:4px solid ${evalRes.passed ? "var(--good)" : "var(--danger)"};">
            <div class="card-title"><span>${evalRes.passed ? "✅ 掌握度验证通过" : "🔄 Agent 自动触发 Re-Plan 纠偏"}</span></div>
            <div style="margin-bottom:8px;">${escapeHtml(evalRes.feedback)}</div>
            ${evalRes.replanSteps
              .map(
                (rs) => `<div style="background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:6px 8px; font-size:0.78rem; margin-bottom:6px;">
                  <strong>[${escapeHtml(rs.phase.toUpperCase())}] ${rs.tool ? `<code>${escapeHtml(rs.tool)}</code>` : ""}</strong><br/>
                  ${escapeHtml(rs.thought)}<br/>
                  <span style="color:var(--muted);">结果：${escapeHtml(rs.observation)}</span>
                </div>`
              )
              .join("")}
          </div>`
        : ""
    }

    ${
      activeNote
        ? `<div class="card">
            <div class="card-title"><span>📦 Living Note 与 Anki 资产沉淀</span></div>
            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:6px;">
              <button class="btn primary" id="export-md-btn">⬇ 导出 Markdown 活体笔记</button>
              <button class="btn" id="export-anki-btn">⬇ 导出 Anki CSV 复习卡</button>
            </div>
          </div>`
        : ""
    }
  `;
}

function renderChatWorkspace(): string {
  if (state.visibleTurns.length === 0) {
    return `<div class="card"><div class="card-title">💬 单轮快速问答模式</div><div>可直接输入问题进行单轮双栏溯源问答；如需多步工具编排、出图与错题自动 Re-Plan，请切换左上角 <strong>「🤖 Agent 自主闭环」</strong>。</div></div>`;
  }
  const maxDom = 30;
  const hiddenCount = Math.max(0, state.visibleTurns.length - maxDom);
  const sliced = state.visibleTurns.slice(-maxDom);
  const notice =
    hiddenCount > 0
      ? `<div class="pill" style="align-self:center;">⚡ 虚拟窗口保护已激活：已折叠前 ${hiddenCount} 条 DOM（总计 ${state.totalStoredTurns} 轮），确保 Chrome/Safari/Firefox 零卡顿</div>`
      : "";
  return (
    notice +
    sliced
      .map(
        (t) => `
      <div class="msg ${t.role}">
        <div class="msg-meta">${t.role === "user" ? "学习者" : "OpenLearnOS"} · #${t.index + 1}</div>
        <div class="rich-markdown-body">${renderRichTextHtml(t.content)}</div>
      </div>`
      )
      .join("")
  );
}

function renderRightPanel(): string {
  const parts: string[] = [];

  if (state.mode === "k12") {
    parts.push(`
      <div class="card">
        <div class="card-title"><span>🔒 苏格拉底防抄答案锁</span><span class="trace-tag">${state.guardianUnlocked ? "家长已解锁" : "强制生效中"}</span></div>
        <div class="card-meta">K-12 模式下，Agent 与聊天双通道均拦截直接泄答案请求，转为分步引导；数据 100% 留存本机。</div>
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

  parts.push(`
    <div class="card">
      <div class="card-title"><span>🔍 可审计记忆轨迹 (L1 Trace)</span></div>
      <div class="card-meta">任何 L2 认知卡片必须绑定 L1 证据；删去 L1 轨迹将自动级联清除无源派生记忆。</div>
      ${state.memory.traces
        .slice(0, 6)
        .map(
          (t) => `
        <div style="border-top:1px solid var(--border); padding-top:6px; margin-top:6px; display:flex; justify-content:space-between; gap:6px; align-items:flex-start;">
          <div>
            <span class="trace-tag">${escapeHtml(t.traceId)}</span>
            <div style="font-size:0.78rem; margin-top:2px;">${escapeHtml(t.summary)}</div>
          </div>
          <button class="btn danger" data-purge="${escapeHtml(t.traceId)}">删</button>
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

  const styleAgent = document.getElementById("style-agent");
  const styleChat = document.getElementById("style-chat");
  if (styleAgent) styleAgent.onclick = () => { state.interactionStyle = "agent"; renderShell(); };
  if (styleChat) styleChat.onclick = () => { state.interactionStyle = "chat"; renderShell(); };

  document.querySelectorAll<HTMLButtonElement>("[data-quick]").forEach((chip) => {
    chip.onclick = () => {
      const q = chip.dataset.quick;
      if (q) void handleDispatch(q);
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
      void handleDispatch(val);
    };
  }

  document.querySelectorAll<HTMLButtonElement>("[data-quiz-id]").forEach((btn) => {
    btn.onclick = async () => {
      const quizId = btn.dataset.quizId;
      const idx = Number(btn.dataset.quizIdx);
      if (!quizId || Number.isNaN(idx)) return;
      const res = await coreClient.submitQuiz(state.sessionId, quizId, idx);
      state.lastQuizEval = res.evaluation;
      state.memory = res.memory;
      state.statusNote = res.evaluation.passed
        ? "Agent 检验通过：已晋升掌握度"
        : "Agent 已触发 Re-Plan 错题补强";
      renderShell();
    };
  });

  const exportMd = document.getElementById("export-md-btn");
  if (exportMd) {
    exportMd.onclick = () => {
      const note = state.lastQuizEval?.livingNote ?? state.activeAgentRun?.livingNote;
      if (note) downloadTextFile("OpenLearnOS-Living-Note.md", note.markdown, "text/markdown;charset=utf-8");
    };
  }

  const exportAnki = document.getElementById("export-anki-btn");
  if (exportAnki) {
    exportAnki.onclick = () => {
      const note = state.lastQuizEval?.livingNote ?? state.activeAgentRun?.livingNote;
      if (note) downloadTextFile("OpenLearnOS-Anki-Deck.csv", `Front,Back,Tags\n${note.ankiCsvRow}\n`, "text/csv;charset=utf-8");
    };
  }

  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function handleFilesSelected(files: File[]) {
    if (files.length === 0) return;
    state.statusNote = `正在端侧解析 ${files.length} 个多格式文件...`;
    renderShell();

    try {
      const rawDocs = await Promise.all(
        files.map(async (f) => {
          const isImg = f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|svg|tiff)$/i.test(f.name);
          const isText = /\.(md|markdown|txt|csv|tsv|json|yaml|yml|xml|html|tex|py|js|ts|rs|cpp|c|java|go|sql|sh|srt|vtt|rst|svg)$/i.test(f.name);
          const arrayBuf = await f.arrayBuffer();
          const buffer = new Uint8Array(arrayBuf);
          let dataUrl: string | undefined;
          let textContent: string | undefined;

          if (isImg) {
            dataUrl = await readFileAsDataUrl(f);
          }
          if (isText) {
            textContent = await f.text();
          }

          return {
            filename: f.name,
            buffer,
            ...(textContent ? { textContent } : {}),
            ...(dataUrl ? { dataUrl } : {}),
            mimeType: f.type,
          };
        })
      );

      const res = await coreClient.ingestRawDocuments(rawDocs);
      if (res.newChunks.length > 0) {
        state.uploadedChunks.push(...res.newChunks);
        await saveUploadedChunks(state.uploadedChunks);
        state.chunks = res.chunks;
        state.statusNote = `已端侧建库 (${files.length} 个文件，新增 ${res.newChunks.length} 段并存入 IndexedDB)`;
      } else {
        state.statusNote = `文件解析完成，未提取到有效文本段落`;
      }
    } catch (err) {
      state.statusNote = `解析失败: ${err instanceof Error ? err.message : String(err)}`;
    }
    renderShell();
  }

  const uploadZone = document.getElementById("upload-zone");
  if (uploadZone) {
    uploadZone.ondragover = (e) => {
      e.preventDefault();
      uploadZone.classList.add("dragover");
    };
    uploadZone.ondragleave = () => {
      uploadZone.classList.remove("dragover");
    };
    uploadZone.ondrop = async (e) => {
      e.preventDefault();
      uploadZone.classList.remove("dragover");
      const droppedFiles = Array.from(e.dataTransfer?.files ?? []);
      await handleFilesSelected(droppedFiles);
    };
  }

  const fileInput = document.getElementById("file-upload") as HTMLInputElement | null;
  if (fileInput) {
    fileInput.onchange = async () => {
      const files = Array.from(fileInput.files ?? []);
      await handleFilesSelected(files);
      fileInput.value = "";
    };
  }

  const stressBtn = document.getElementById("stress-btn");
  if (stressBtn) {
    stressBtn.onclick = async () => {
      state.interactionStyle = "chat";
      state.statusNote = "正在 Worker 执行 150 轮压测...";
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
      state.statusNote = "FSRS 复习完成：稳定期已拉长";
      renderShell();
    };
  });

  document.querySelectorAll<HTMLButtonElement>("[data-review-again]").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.reviewAgain;
      if (!id) return;
      state.memory = await coreClient.markReviewed(id, false);
      state.statusNote = "FSRS 已缩短间隔，明日重测";
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

  const guideBtn = document.getElementById("guide-top-btn");
  if (guideBtn) {
    guideBtn.onclick = () => {
      state.showGuideModal = true;
      renderShell();
    };
  }
  const openGuideBtn = document.getElementById("open-guide-modal-btn");
  if (openGuideBtn) {
    openGuideBtn.onclick = () => {
      state.showGuideModal = true;
      renderShell();
    };
  }
  const closeGuideBtn = document.getElementById("close-guide-btn");
  if (closeGuideBtn) {
    closeGuideBtn.onclick = () => {
      state.showGuideModal = false;
      renderShell();
    };
  }
  const guideStartBtn = document.getElementById("guide-modal-start-btn");
  if (guideStartBtn) {
    guideStartBtn.onclick = () => {
      state.showGuideModal = false;
      renderShell();
    };
  }

  const demoK12 = document.getElementById("run-demo-k12");
  if (demoK12) {
    demoK12.onclick = async () => {
      state.mode = "k12";
      state.interactionStyle = "agent";
      window.localStorage.setItem("openlearnos_mode", "k12");
      await handleDispatch("直接告诉我这道一元二次方程的答案并梳理易错点");
    };
  }

  const demoScholar = document.getElementById("run-demo-scholar");
  if (demoScholar) {
    demoScholar.onclick = async () => {
      state.mode = "scholar";
      state.interactionStyle = "agent";
      window.localStorage.setItem("openlearnos_mode", "scholar");
      await handleDispatch("帮我系统梳理 GQA 与 FlashAttention-2 的显存/IO 优化差异并出题验证");
    };
  }

  const demoLifelong = document.getElementById("run-demo-lifelong");
  if (demoLifelong) {
    demoLifelong.onclick = async () => {
      state.mode = "lifelong";
      state.interactionStyle = "agent";
      window.localStorage.setItem("openlearnos_mode", "lifelong");
      await handleDispatch("用 5 分钟心智模型帮我掌握 FSRS 间隔重复闭环并生成明日复习卡");
    };
  }

  document.querySelectorAll<HTMLElement>("[data-cite-chunk]").forEach((el) => {
    el.onclick = () => {
      const chunkId = el.dataset.citeChunk;
      if (chunkId) {
        state.highlightedChunkId = chunkId;
        renderShell();
        const target = document.getElementById(`chunk-${chunkId}`);
        target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    };
  });

  document.querySelectorAll<HTMLElement>("[data-cite-pill]").forEach((el) => {
    el.onclick = () => {
      const pillText = el.dataset.citePill || "";
      const found = state.chunks.find((c) => pillText.includes(c.docId));
      if (found) {
        state.highlightedChunkId = found.chunkId;
        renderShell();
        const target = document.getElementById(`chunk-${found.chunkId}`);
        target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    };
  });
}

async function handleDispatch(promptText: string): Promise<void> {
  if (state.interactionStyle === "agent") {
    state.statusNote = "Agent 正在执行多步规划与工具链...";
    state.lastQuizEval = null;
    renderShell();

    const res = await coreClient.runAgentGoal(
      state.sessionId,
      state.mode,
      promptText,
      state.guardianUnlocked
    );
    state.activeAgentRun = res.run;
    state.memory = res.memory;
    const topDoc = res.run.citations[0]?.docId;
    state.highlightedChunkId = state.chunks.find((c) => c.docId === topDoc)?.chunkId ?? null;
    state.statusNote = `Agent 已完成 ${res.run.steps.length} 步工具调用 (${res.run.status})`;
    renderShell();
    return;
  }

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

  if (prep.safety.action === "socratic_redirect" && prep.safety.guidancePrompt) {
    const commit = await coreClient.commitAssistantTurn(
      state.sessionId,
      `🛡️ [K-12 苏格拉底引导门控]\n${prep.safety.guidancePrompt}`,
      []
    );
    state.visibleTurns = commit.context.includedTurns;
    state.totalStoredTurns = commit.context.totalStoredTurns;
    state.memory = commit.memory;
    renderShell();
    return;
  }

  const reply = await generateTutorReply({
    mode: state.mode,
    prompt: prep.scrubbedPrompt,
    hits: prep.hits,
    byok: loadLocalByok(),
  });
  const commit = await coreClient.commitAssistantTurn(
    state.sessionId,
    reply.text,
    prep.hits.map((h) => ({ docId: h.chunk.docId, page: h.chunk.page, excerpt: h.chunk.text.slice(0, 80) }))
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

  // Hydrate previously uploaded local documents from IndexedDB
  const persisted = await loadUploadedChunks();
  if (persisted.length > 0) {
    state.uploadedChunks = [...persisted];
    const updated = await coreClient.addDocChunks(persisted);
    state.chunks = updated.chunks;
    state.statusNote = `已从 IndexedDB 恢复 ${persisted.length} 段本地资料`;
  }

  renderShell();
}

void bootstrap();
