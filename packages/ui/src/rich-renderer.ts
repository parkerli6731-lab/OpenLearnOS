/**
 * Clean-Room Rich Text & Reading-Optimized HTML Formatter.
 * Eliminates raw Markdown syntax symbols (###, **, >, raw backticks) and renders content
 * as executive visual cards, callout quotes, interactive badge pills, and comfortable typography.
 */

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatInlineElements(text: string): string {
  let result = escapeHtml(text);

  // 1. Format file citation pill: `filename.ext · P.1` or `filename.ext`
  result = result.replace(/`([^`]+\.(?:md|pdf|docx|xlsx|pptx|csv|srt|py|tex)[^`]*)`/g, (_, cite) => {
    return `<span class="trace-pill" data-cite-pill="${cite}">📄 ${cite}</span>`;
  });

  // 2. Format inline code `code`
  result = result.replace(/`([^`]+)`/g, '<code class="rich-inline-code">$1</code>');

  // 3. Format bold **text**
  result = result.replace(/\*\*([^*]+)\*\*/g, '<strong class="rich-strong">$1</strong>');

  // 4. Format math formulas $...$
  result = result.replace(/\$([^$]+)\$/g, '<span class="rich-math-span">$1</span>');

  return result;
}

export function renderRichTextHtml(markdown: string): string {
  if (!markdown || !markdown.trim()) return "";

  const lines = markdown.split(/\r?\n/);
  const htmlBlocks: string[] = [];

  let currentBlockType: "none" | "quote" | "ul" | "ol" = "none";
  let currentBlockLines: string[] = [];

  const flushBlock = () => {
    if (currentBlockLines.length === 0) return;
    if (currentBlockType === "quote") {
      const quoteContent = currentBlockLines.map(formatInlineElements).join("<br/>");
      htmlBlocks.push(`
        <blockquote class="rich-callout-quote">
          <div class="rich-quote-icon">❝</div>
          <div class="rich-quote-body">${quoteContent}</div>
        </blockquote>
      `);
    } else if (currentBlockType === "ul") {
      const items = currentBlockLines.map((l) => `<li class="rich-li">${formatInlineElements(l)}</li>`).join("");
      htmlBlocks.push(`<ul class="rich-ul">${items}</ul>`);
    } else if (currentBlockType === "ol") {
      const items = currentBlockLines.map((l) => `<li class="rich-li">${formatInlineElements(l)}</li>`).join("");
      htmlBlocks.push(`<ol class="rich-ol">${items}</ol>`);
    }
    currentBlockLines = [];
    currentBlockType = "none";
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const trimmed = rawLine.trim();

    if (trimmed.length === 0) {
      flushBlock();
      continue;
    }

    // 1. Headings: ### 🤖 Agent 自主学习简报（K12 模式）
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch && headingMatch[2]) {
      flushBlock();
      const level = headingMatch[1]?.length ?? 3;
      const title = formatInlineElements(headingMatch[2]);
      htmlBlocks.push(`
        <div class="rich-hero-banner rich-h${level}">
          <span class="rich-hero-title">${title}</span>
        </div>
      `);
      continue;
    }

    // 2. Blockquotes: > quote text
    if (trimmed.startsWith(">")) {
      const quoteText = trimmed.replace(/^>\s*/, "");
      if (currentBlockType !== "quote") {
        flushBlock();
        currentBlockType = "quote";
      }
      currentBlockLines.push(quoteText);
      continue;
    }

    // 3. Unordered list: - item or * item
    if (/^[-*•]\s+/.test(trimmed)) {
      const itemText = trimmed.replace(/^[-*•]\s+/, "");
      if (currentBlockType !== "ul") {
        flushBlock();
        currentBlockType = "ul";
      }
      currentBlockLines.push(itemText);
      continue;
    }

    // 4. Ordered list: 1. item
    if (/^\d+\.\s+/.test(trimmed)) {
      const itemText = trimmed.replace(/^\d+\.\s+/, "");
      if (currentBlockType !== "ol") {
        flushBlock();
        currentBlockType = "ol";
      }
      currentBlockLines.push(itemText);
      continue;
    }

    flushBlock();

    // 5. Section Callout Cards:
    // e.g. **原文核心依据**（...）：... OR **个性化记忆衔接**：... OR **下一步（强制闭环）**：...
    const sectionMatch = trimmed.match(/^\*\*([^*]+)\*\*(?:（([^）]+)）)?[:：]\s*(.*)$/);
    if (sectionMatch) {
      const title = sectionMatch[1] ?? "";
      const meta = sectionMatch[2] ? formatInlineElements(sectionMatch[2]) : "";
      const body = sectionMatch[3] ? formatInlineElements(sectionMatch[3]) : "";

      let cardType = "default";
      let icon = "📌";
      if (title.includes("原文") || title.includes("依据") || title.includes("资料")) {
        cardType = "grounding";
        icon = "📖";
      } else if (title.includes("记忆") || title.includes("概念") || title.includes("巩固")) {
        cardType = "memory";
        icon = "🧠";
      } else if (title.includes("下一步") || title.includes("闭环") || title.includes("建议")) {
        cardType = "action";
        icon = "🚀";
      }

      htmlBlocks.push(`
        <div class="rich-section-card ${cardType}-card">
          <div class="rich-section-header">
            <span class="rich-section-icon">${icon}</span>
            <span class="rich-section-name">${escapeHtml(title)}</span>
            ${meta ? `<span class="rich-section-meta">${meta}</span>` : ""}
          </div>
          ${body ? `<div class="rich-section-body">${body}</div>` : ""}
        </div>
      `);
      continue;
    }

    // Normal paragraph
    htmlBlocks.push(`<p class="rich-para">${formatInlineElements(trimmed)}</p>`);
  }

  flushBlock();
  return htmlBlocks.join("\n");
}
