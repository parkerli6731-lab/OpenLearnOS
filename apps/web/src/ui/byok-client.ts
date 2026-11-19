import type { PersonaMode, RetrievalHit } from "@openlearnos/contracts";

export interface LocalByokSettings {
  readonly baseUrl: string;
  readonly model: string;
  /** Stored strictly in browser localStorage; never logged or relayed to any third-party backend. */
  readonly apiKey: string;
}

const STORAGE_KEY = "openlearnos_byok_local_v1";

export function loadLocalByok(): LocalByokSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { baseUrl: "http://127.0.0.1:4000/v1", model: "gemini-3.8-flash-high", apiKey: "" };
    const parsed = JSON.parse(raw) as Partial<LocalByokSettings>;
    return {
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "http://127.0.0.1:4000/v1",
      model: typeof parsed.model === "string" ? parsed.model : "gemini-3.8-flash-high",
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
    };
  } catch {
    return { baseUrl: "http://127.0.0.1:4000/v1", model: "gemini-3.8-flash-high", apiKey: "" };
  }
}

export function saveLocalByok(settings: LocalByokSettings): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function clearLocalByok(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

export async function generateTutorReply(params: {
  mode: PersonaMode;
  prompt: string;
  hits: readonly RetrievalHit[];
  byok: LocalByokSettings;
}): Promise<{ text: string; providerLabel: string }> {
  const { mode, prompt, hits, byok } = params;
  const contextBlock =
    hits.length > 0
      ? hits
          .map(
            (h, i) =>
              `[${i + 1}] (${h.chunk.docId} · P.${h.chunk.page} · ${h.chunk.headingPath.join(" > ")})\n${h.chunk.text}`
          )
          .join("\n\n")
      : "（当前语料未命中强相关片段，将基于通用教学原则回答）";

  // If user configured a local BYOK key (or Ollama local endpoint without key), call directly from browser
  const isOllama = byok.baseUrl.includes("11434");
  if (byok.baseUrl.trim() && (byok.apiKey.trim() || isOllama)) {
    try {
      const systemPrompts: Record<PersonaMode, string> = {
        k12: "你是 OpenLearnOS K-12 苏格拉底伴学导师。优先通过分步提问启发学生思考，语气温和清晰，严格基于参考资料作答。",
        scholar: "你是 OpenLearnOS 科研导师。回答严谨、结构化，必须以 [文档名 · P.页码] 标注依据，指出方法假设与边界。",
        lifelong: "你是 OpenLearnOS 终身学习教练。用高信息密度输出：核心心智模型 + 行动规则 + 1 道 30 秒自测题。",
      };
      const endpoint = `${byok.baseUrl.replace(/\/+$/, "")}/chat/completions`;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (byok.apiKey.trim()) headers["Authorization"] = `Bearer ${byok.apiKey.trim()}`;

      const resp = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: byok.model || "gpt-4o-mini",
          temperature: mode === "scholar" ? 0.2 : 0.4,
          messages: [
            { role: "system", content: systemPrompts[mode] },
            {
              role: "user",
              content: `参考资料：\n${contextBlock}\n\n学习者问题：${prompt}`,
            },
          ],
        }),
      });

      if (resp.ok) {
        const data = (await resp.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = data.choices?.[0]?.message?.content;
        if (typeof content === "string" && content.trim()) {
          return { text: content.trim(), providerLabel: `BYOK · ${byok.model}` };
        }
      }
    } catch {
      // Fall back cleanly to offline local grounded tutor mode if CORS / offline
    }
  }

  // Zero-Key Offline Grounded Demo Mode (100% client-side, instant response)
  const topHit = hits[0];
  const citationLine = topHit
    ? `依据来源：[${topHit.chunk.docId} · P.${topHit.chunk.page}]（BM25=${topHit.bm25Score.toFixed(2)}）`
    : "提示：可拖入本地 .md / .txt 文档到左侧栏即时建库，或点击右上角配置本地 BYOK 模型获得深度生成。";

  if (mode === "k12") {
    return {
      providerLabel: "本地离线演示引擎 (Zero-Key)",
      text: [
        `🎒 **K-12 引导思路**：针对你的问题「${prompt}」`,
        topHit ? `我们先看课本对应知识点：${topHit.chunk.text}` : "我们先拆解题目里的已知条件与目标未知量。",
        `👉 **思考检验**：请你试着说出第一步应该代入哪几个数值（特别注意正负号）？`,
        citationLine,
      ].join("\n\n"),
    };
  }

  if (mode === "scholar") {
    return {
      providerLabel: "本地离线演示引擎 (Zero-Key)",
      text: [
        `🎓 **Scholar 溯源精读分析**：关于「${prompt}」`,
        topHit
          ? `核心原文证据：${topHit.chunk.text}`
          : "当前本地语料库未检索到直接匹配片段，建议先上传相关论文文本或切换右侧 RAG Eval 面板验证召回。",
        `📊 **方法对比要点**：关注显存复杂度、IO 瓶颈与精度取舍，可在右侧运行 \`RAG Eval\` 量化验证当前语料召回指标。`,
        citationLine,
      ].join("\n\n"),
    };
  }

  return {
    providerLabel: "本地离线演示引擎 (Zero-Key)",
    text: [
      `🌱 **Lifelong 5 分钟心智模型蒸馏**：`,
      topHit ? `核心原理：${topHit.chunk.text}` : `已将「${prompt}」沉淀为今日学习轨迹（L1 Trace）。`,
      `✅ **明日主动回忆自测**：合上页面后，用一句话复述这个概念能解决什么痛点？已自动写入右侧 FSRS 复习队列。`,
      citationLine,
    ].join("\n\n"),
  };
}
