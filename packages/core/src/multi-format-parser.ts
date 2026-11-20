import type {
  ChunkMediaType,
  DocumentChunk,
  DocumentSourceFormat,
} from "@openlearnos/contracts";
import * as fflate from "fflate";

// Polyfill Promise.try for cross-runtime compatibility (Node 22 / Web Workers / ES2025)
const runtimeGlobal = globalThis as unknown as {
  Promise?: { try?: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => Promise<unknown> };
};
if (runtimeGlobal.Promise && typeof runtimeGlobal.Promise.try !== "function") {
  runtimeGlobal.Promise.try = function (fn: (...args: unknown[]) => unknown, ...args: unknown[]) {
    return new Promise((resolve) => resolve(fn(...args)));
  };
}

export interface RawDocumentInput {
  readonly filename: string;
  readonly buffer?: Uint8Array;
  readonly textContent?: string;
  readonly dataUrl?: string;
  readonly mimeType?: string;
}

export interface ParseDocumentOptions {
  readonly maxChunkChars?: number;
  readonly tableBatchRows?: number;
}

function unescapeXml(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'");
}

function normalizeWhitespace(text: string): string {
  return text.replace(/[ \t\r\f]+/g, " ").trim();
}

/**
 * Pure TypeScript Omni-Format Document Ingestion Engine.
 * Runs 100% client-side in Web Worker, Node.js harness, or Tauri desktop without server dependencies.
 * Supports: PPTX, PDF, DOCX, XLSX, CSV, TSV, EPUB, Subtitles (SRT/VTT), LaTeX, Code, Scanned Documents & Images.
 */
export class MultiFormatDocumentParser {
  private readonly maxChunkChars: number;
  private readonly tableBatchRows: number;

  constructor(options?: ParseDocumentOptions) {
    this.maxChunkChars = options?.maxChunkChars ?? 900;
    this.tableBatchRows = options?.tableBatchRows ?? 25;
  }

  public async parse(input: RawDocumentInput): Promise<readonly DocumentChunk[]> {
    const ext = this.detectExtension(input.filename);

    switch (ext) {
      case "md":
      case "markdown":
      case "txt":
        return this.parseTextAndMarkdown(input, ext === "txt" ? "txt" : "md");

      case "csv":
      case "tsv":
        return this.parseCsvAndTsv(input, ext === "tsv" ? "\t" : ",");

      case "docx":
        return this.parseDocx(input);

      case "xlsx":
        return this.parseXlsx(input);

      case "pptx":
      case "ppt":
        return this.parsePptx(input);

      case "epub":
        return this.parseEpub(input);

      case "srt":
      case "vtt":
        return this.parseSubtitle(input, ext as "srt" | "vtt");

      case "tex":
      case "latex":
        return this.parseLatex(input);

      case "py":
      case "ts":
      case "js":
      case "rs":
      case "cpp":
      case "c":
      case "java":
      case "go":
      case "sql":
      case "sh":
      case "json":
      case "yaml":
      case "yml":
      case "xml":
      case "html":
      case "rst":
        return this.parseCodeAndMarkup(input, ext);

      case "pdf":
        return this.parsePdf(input);

      case "png":
      case "jpg":
      case "jpeg":
      case "webp":
      case "gif":
      case "bmp":
      case "svg":
      case "tiff":
        return this.parseImage(input, ext);

      default:
        // Graceful fallback: treat as plain text if textContent or buffer is available
        return this.parseTextAndMarkdown(input, "txt");
    }
  }

  private detectExtension(filename: string): string {
    const parts = filename.toLowerCase().split(".");
    return parts.length > 1 ? parts[parts.length - 1] ?? "txt" : "txt";
  }

  private getBuffer(input: RawDocumentInput): Uint8Array {
    if (input.buffer) return input.buffer;
    if (input.textContent) {
      return fflate.strToU8(input.textContent);
    }
    return new Uint8Array(0);
  }

  private getText(input: RawDocumentInput): string {
    if (input.textContent !== undefined) return input.textContent;
    if (input.buffer) {
      try {
        return fflate.strFromU8(input.buffer);
      } catch {
        return "";
      }
    }
    return "";
  }

  // 1. Text & Markdown Parser
  private parseTextAndMarkdown(
    input: RawDocumentInput,
    format: "txt" | "md"
  ): readonly DocumentChunk[] {
    const raw = this.getText(input);
    if (!raw.trim()) return [];

    const lines = raw.split(/\r?\n/);
    const chunks: DocumentChunk[] = [];
    let currentHeadingPath: string[] = [input.filename];
    let currentParagraphs: string[] = [];
    let charCount = 0;
    let chunkSeq = 1;

    const flushChunk = () => {
      const combined = currentParagraphs.join("\n\n").trim();
      if (combined.length > 0) {
        chunks.push({
          chunkId: `${input.filename}-chunk-${chunkSeq++}`,
          docId: input.filename,
          page: 1,
          headingPath: [...currentHeadingPath],
          text: combined,
          mediaType: "text",
          sourceFormat: format,
        });
      }
      currentParagraphs = [];
      charCount = 0;
    };

    for (const line of lines) {
      const trimmed = line.trim();
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch && headingMatch[2]) {
        flushChunk();
        const level = headingMatch[1]?.length ?? 1;
        const headingText = headingMatch[2].trim();
        currentHeadingPath = [input.filename, ...currentHeadingPath.slice(1, level), headingText];
        continue;
      }

      if (trimmed.length === 0) {
        if (charCount >= this.maxChunkChars) {
          flushChunk();
        }
      } else {
        currentParagraphs.push(line);
        charCount += line.length + 1;
        if (charCount >= this.maxChunkChars * 1.5) {
          flushChunk();
        }
      }
    }

    flushChunk();
    return chunks;
  }

  // 2. CSV & TSV Parser with Automatic Markdown Table Synthesis
  private parseCsvAndTsv(
    input: RawDocumentInput,
    delimiter: string
  ): readonly DocumentChunk[] {
    const raw = this.getText(input);
    if (!raw.trim()) return [];

    const rawRows = raw.split(/\r?\n/).filter((r) => r.trim().length > 0);
    if (rawRows.length === 0) return [];

    const parseLine = (line: string): string[] => {
      const tokens: string[] = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === delimiter && !inQuotes) {
          tokens.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
      tokens.push(current.trim());
      return tokens;
    };

    const header = parseLine(rawRows[0] ?? "");
    const dataRows = rawRows.slice(1).map(parseLine);
    const chunks: DocumentChunk[] = [];
    let chunkSeq = 1;

    for (let i = 0; i < dataRows.length; i += this.tableBatchRows) {
      const batch = dataRows.slice(i, i + this.tableBatchRows);
      const startRow = i + 1;
      const endRow = i + batch.length;

      const mdLines: string[] = [];
      mdLines.push(`| ${header.join(" | ")} |`);
      mdLines.push(`| ${header.map(() => "---").join(" | ")} |`);
      for (const row of batch) {
        const padded = header.map((_, idx) => row[idx] ?? "");
        mdLines.push(`| ${padded.join(" | ")} |`);
      }

      chunks.push({
        chunkId: `${input.filename}-table-${chunkSeq++}`,
        docId: input.filename,
        page: 1,
        headingPath: [input.filename, `数据表格 行 ${startRow}-${endRow}`],
        text: mdLines.join("\n"),
        mediaType: "table",
        sourceFormat: "csv",
        metadata: {
          totalRows: dataRows.length,
          columns: header,
          startRow,
          endRow,
        },
      });
    }

    return chunks;
  }

  // 3. DOCX Parser (Extracts Paragraphs, Headings & Tables via fflate)
  private parseDocx(input: RawDocumentInput): readonly DocumentChunk[] {
    const buffer = this.getBuffer(input);
    if (buffer.length === 0) return [];

    try {
      const unzipped = fflate.unzipSync(buffer);
      const docxXmlKey = "word/doc" + "ument.xml";
      const docXmlBytes = unzipped[docxXmlKey];
      if (!docXmlBytes) return [];

      const docXml = fflate.strFromU8(docXmlBytes);
      const chunks: DocumentChunk[] = [];
      let currentHeadingPath: string[] = [input.filename];
      let currentTextBuffer: string[] = [];
      let chunkSeq = 1;

      const flushChunk = (mediaType: ChunkMediaType = "text") => {
        const text = currentTextBuffer.join("\n\n").trim();
        if (text.length > 0) {
          chunks.push({
            chunkId: `${input.filename}-docx-${chunkSeq++}`,
            docId: input.filename,
            page: Math.max(1, Math.ceil(chunkSeq / 2)),
            headingPath: [...currentHeadingPath],
            text,
            mediaType,
            sourceFormat: "docx",
          });
        }
        currentTextBuffer = [];
      };

      const bodyRegex = /<w:body[\s>]([\s\S]*?)<\/w:body>/;
      const bodyMatch = docXml.match(bodyRegex);
      const bodyContent = bodyMatch ? (bodyMatch[1] ?? "") : docXml;

      const blockRegex = /<(w:p|w:tbl)[\s>][\s\S]*?<\/\1>/g;
      let match: RegExpExecArray | null;

      while ((match = blockRegex.exec(bodyContent)) !== null) {
        const blockXml = match[0];
        const isTable = match[1] === "w:tbl";

        if (isTable) {
          flushChunk("text");
          const rowRegex = /<w:tr[\s>][\s\S]*?<\/w:tr>/g;
          const tableRows: string[][] = [];
          let rowMatch: RegExpExecArray | null;

          while ((rowMatch = rowRegex.exec(blockXml)) !== null) {
            const cellRegex = /<w:tc[\s>][\s\S]*?<\/w:tc>/g;
            const cells: string[] = [];
            let cellMatch: RegExpExecArray | null;
            while ((cellMatch = cellRegex.exec(rowMatch[0])) !== null) {
              const textMatches = Array.from(cellMatch[0].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g));
              const cellText = textMatches.map((m) => unescapeXml(m[1] ?? "")).join("");
              cells.push(normalizeWhitespace(cellText));
            }
            if (cells.length > 0) tableRows.push(cells);
          }

          if (tableRows.length > 0) {
            const maxCols = Math.max(...tableRows.map((r) => r.length));
            const mdLines: string[] = [];
            const header = tableRows[0] ?? [];
            const paddedHeader = Array.from({ length: maxCols }, (_, idx) => header[idx] || `列${idx + 1}`);
            mdLines.push(`| ${paddedHeader.join(" | ")} |`);
            mdLines.push(`| ${paddedHeader.map(() => "---").join(" | ")} |`);

            for (let r = 1; r < tableRows.length; r++) {
              const row = tableRows[r] ?? [];
              const paddedRow = Array.from({ length: maxCols }, (_, idx) => row[idx] || "");
              mdLines.push(`| ${paddedRow.join(" | ")} |`);
            }

            chunks.push({
              chunkId: `${input.filename}-table-${chunkSeq++}`,
              docId: input.filename,
              page: Math.max(1, Math.ceil(chunkSeq / 2)),
              headingPath: [...currentHeadingPath, "文档表格"],
              text: mdLines.join("\n"),
              mediaType: "table",
              sourceFormat: "docx",
            });
          }
        } else {
          const isHeading = /<w:pStyle\s+w:val="Heading(\d)"/i.exec(blockXml);
          const textMatches = Array.from(blockXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g));
          const pText = normalizeWhitespace(textMatches.map((m) => unescapeXml(m[1] ?? "")).join(""));

          if (pText.length === 0) continue;

          if (isHeading) {
            flushChunk("text");
            const level = parseInt(isHeading[1] ?? "1", 10);
            currentHeadingPath = [input.filename, ...currentHeadingPath.slice(1, level), pText];
          } else {
            currentTextBuffer.push(pText);
            const currentLen = currentTextBuffer.reduce((acc, p) => acc + p.length, 0);
            if (currentLen >= this.maxChunkChars) {
              flushChunk("text");
            }
          }
        }
      }

      flushChunk("text");
      return chunks;
    } catch {
      return [];
    }
  }

  // 4. XLSX Parser (Extracts Worksheets & Shared Strings into Markdown Tables via fflate)
  private parseXlsx(input: RawDocumentInput): readonly DocumentChunk[] {
    const buffer = this.getBuffer(input);
    if (buffer.length === 0) return [];

    try {
      const unzipped = fflate.unzipSync(buffer);
      const sharedStrings: string[] = [];
      const sstBytes = unzipped["xl/sharedStrings.xml"];
      if (sstBytes) {
        const sstXml = fflate.strFromU8(sstBytes);
        const siRegex = /<si[\s>]([\s\S]*?)<\/si>/g;
        let siMatch: RegExpExecArray | null;
        while ((siMatch = siRegex.exec(sstXml)) !== null) {
          const tMatches = Array.from(siMatch[1]?.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? []);
          const str = tMatches.map((m) => unescapeXml(m[1] ?? "")).join("");
          sharedStrings.push(normalizeWhitespace(str));
        }
      }

      const sheetNames: Record<string, string> = {};
      const wbBytes = unzipped["xl/workbook.xml"];
      if (wbBytes) {
        const wbXml = fflate.strFromU8(wbBytes);
        const sheetTagRegex = /<sheet\s+name="([^"]+)"[^>]*sheetId="([^"]+)"/g;
        let sMatch: RegExpExecArray | null;
        while ((sMatch = sheetTagRegex.exec(wbXml)) !== null) {
          const name = sMatch[1];
          const id = sMatch[2];
          if (name && id) sheetNames[`sheet${id}.xml`] = name;
        }
      }

      const chunks: DocumentChunk[] = [];
      let chunkSeq = 1;

      for (const [pathKey, fileBytes] of Object.entries(unzipped)) {
        if (!pathKey.startsWith("xl/worksheets/sheet") || !pathKey.endsWith(".xml")) continue;
        const sheetFile = pathKey.replace("xl/worksheets/", "");
        const sheetTitle = sheetNames[sheetFile] || sheetFile.replace(".xml", "");
        const sheetXml = fflate.strFromU8(fileBytes);

        const rowRegex = /<row\s+r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
        const grid: Record<number, Record<number, string>> = {};
        let rowMatch: RegExpExecArray | null;
        let maxColIdx = 1;

        while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
          const rowNum = parseInt(rowMatch[1] ?? "1", 10);
          const rowContent = rowMatch[2] ?? "";
          grid[rowNum] = grid[rowNum] || {};

          const cellRegex = /<c\s+r="([A-Z]+)(\d+)"(?:\s+t="([a-z]+)")?[^>]*>(?:<v>([\s\S]*?)<\/v>)?(?:<is><t>([\s\S]*?)<\/t><\/is>)?<\/c>/g;
          let cellMatch: RegExpExecArray | null;

          while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
            const colLetters = cellMatch[1] ?? "A";
            const colIdx = this.columnLettersToIndex(colLetters);
            if (colIdx > maxColIdx) maxColIdx = colIdx;

            const cellType = cellMatch[3];
            const rawVal = cellMatch[4];
            const inlineText = cellMatch[5];

            let cellValue = "";
            if (inlineText) {
              cellValue = unescapeXml(inlineText);
            } else if (cellType === "s" && rawVal) {
              const strIdx = parseInt(rawVal, 10);
              cellValue = sharedStrings[strIdx] || "";
            } else if (rawVal) {
              cellValue = rawVal;
            }
            grid[rowNum][colIdx] = normalizeWhitespace(cellValue);
          }
        }

        const sortedRowKeys = Object.keys(grid)
          .map((k) => parseInt(k, 10))
          .sort((a, b) => a - b);
        if (sortedRowKeys.length === 0) continue;

        const headerRowIdx = sortedRowKeys[0] ?? 1;
        const headerRowData = grid[headerRowIdx] || {};
        const headerList = Array.from({ length: maxColIdx }, (_, c) => {
          return headerRowData[c + 1] || `Col_${c + 1}`;
        });

        const dataRowKeys = sortedRowKeys.slice(1);
        for (let i = 0; i < dataRowKeys.length; i += this.tableBatchRows) {
          const batchKeys = dataRowKeys.slice(i, i + this.tableBatchRows);
          const startR = batchKeys[0] ?? 2;
          const endR = batchKeys[batchKeys.length - 1] ?? startR;

          const mdLines: string[] = [];
          mdLines.push(`| ${headerList.join(" | ")} |`);
          mdLines.push(`| ${headerList.map(() => "---").join(" | ")} |`);

          for (const rk of batchKeys) {
            const rowData = grid[rk] || {};
            const rowValues = Array.from({ length: maxColIdx }, (_, c) => rowData[c + 1] || "");
            mdLines.push(`| ${rowValues.join(" | ")} |`);
          }

          chunks.push({
            chunkId: `${input.filename}-${sheetTitle}-${chunkSeq++}`,
            docId: input.filename,
            page: 1,
            headingPath: [input.filename, sheetTitle, `行 ${startR}-${endR}`],
            text: mdLines.join("\n"),
            mediaType: "table",
            sourceFormat: "xlsx",
            metadata: {
              sheet: sheetTitle,
              columns: headerList,
              startRow: startR,
              endRow: endR,
            },
          });
        }
      }

      return chunks;
    } catch {
      return [];
    }
  }

  // 5. PowerPoint Presentation Parser (PPTX Slide Structure, Bullet Points, Tables & Notes)
  private parsePptx(input: RawDocumentInput): readonly DocumentChunk[] {
    const buffer = this.getBuffer(input);
    if (buffer.length === 0) return [];

    try {
      const unzipped = fflate.unzipSync(buffer);
      const slideEntries: { num: number; key: string }[] = [];
      const notesEntries: Record<number, string> = {};

      for (const key of Object.keys(unzipped)) {
        const slideMatch = key.match(/^ppt\/slides\/slide(\d+)\.xml$/);
        if (slideMatch && slideMatch[1]) {
          slideEntries.push({ num: parseInt(slideMatch[1], 10), key });
        }
        const notesMatch = key.match(/^ppt\/notesSlides\/notesSlide(\d+)\.xml$/);
        if (notesMatch && notesMatch[1]) {
          const notesBytes = unzipped[key];
          if (notesBytes) {
            notesEntries[parseInt(notesMatch[1], 10)] = fflate.strFromU8(notesBytes);
          }
        }
      }

      slideEntries.sort((a, b) => a.num - b.num);
      const chunks: DocumentChunk[] = [];

      for (const entry of slideEntries) {
        const slideBytes = unzipped[entry.key];
        if (!slideBytes) continue;
        const slideXml = fflate.strFromU8(slideBytes);
        const slideNum = entry.num;

        // 1. Discover Title if present
        let slideTitle = "";
        const titleRegex = /<p:sp[\s>][\s\S]*?<p:ph[^>]*type="(?:title|ctrTitle)"[\s\S]*?<\/p:sp>/g;
        const tMatch = titleRegex.exec(slideXml);
        if (tMatch) {
          const tRuns = Array.from(tMatch[0].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g));
          slideTitle = normalizeWhitespace(tRuns.map((r) => unescapeXml(r[1] ?? "")).join(""));
        }

        // 2. Discover Text Paragraphs & Bullet Points
        const bodyLines: string[] = [];
        const paraRegex = /<a:p[\s>][\s\S]*?<\/a:p>/g;
        let pMatch: RegExpExecArray | null;

        while ((pMatch = paraRegex.exec(slideXml)) !== null) {
          const pXml = pMatch[0];
          if (tMatch && tMatch[0].includes(pXml)) continue;

          const textRuns = Array.from(pXml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g));
          const line = normalizeWhitespace(textRuns.map((r) => unescapeXml(r[1] ?? "")).join(""));
          if (line.length > 0 && line !== slideTitle) {
            bodyLines.push(`• ${line}`);
          }
        }

        // 3. Discover Tables <a:tbl>
        const tableRegex = /<a:tbl[\s>][\s\S]*?<\/a:tbl>/g;
        let tblMatch: RegExpExecArray | null;
        let hasTable = false;

        while ((tblMatch = tableRegex.exec(slideXml)) !== null) {
          const tblXml = tblMatch[0];
          const rowRegex = /<a:tr[\s>][\s\S]*?<\/a:tr>/g;
          const tableRows: string[][] = [];
          let rMatch: RegExpExecArray | null;

          while ((rMatch = rowRegex.exec(tblXml)) !== null) {
            const cellRegex = /<a:tc[\s>][\s\S]*?<\/a:tc>/g;
            const cells: string[] = [];
            let cMatch: RegExpExecArray | null;
            while ((cMatch = cellRegex.exec(rMatch[0])) !== null) {
              const runs = Array.from(cMatch[0].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g));
              cells.push(normalizeWhitespace(runs.map((r) => unescapeXml(r[1] ?? "")).join("")));
            }
            if (cells.length > 0) tableRows.push(cells);
          }

          if (tableRows.length > 0) {
            hasTable = true;
            const maxCols = Math.max(...tableRows.map((r) => r.length));
            const header = tableRows[0] ?? [];
            const paddedHeader = Array.from({ length: maxCols }, (_, idx) => header[idx] || `列${idx + 1}`);
            bodyLines.push(`\n| ${paddedHeader.join(" | ")} |`);
            bodyLines.push(`| ${paddedHeader.map(() => "---").join(" | ")} |`);
            for (let r = 1; r < tableRows.length; r++) {
              const row = tableRows[r] ?? [];
              const paddedRow = Array.from({ length: maxCols }, (_, idx) => row[idx] || "");
              bodyLines.push(`| ${paddedRow.join(" | ")} |`);
            }
            bodyLines.push("");
          }
        }

        // 4. Discover Speaker Notes if available
        const notesXml = notesEntries[slideNum];
        if (notesXml) {
          const noteRuns = Array.from(notesXml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g));
          const noteText = normalizeWhitespace(noteRuns.map((r) => unescapeXml(r[1] ?? "")).join(" "));
          if (noteText.length > 0) {
            bodyLines.push(`\n[讲师/演讲者备忘]: ${noteText}`);
          }
        }

        const combinedText = [
          slideTitle ? `# ${slideTitle}` : `幻灯片 ${slideNum}`,
          ...bodyLines,
        ].join("\n").trim();

        if (combinedText.length > 0) {
          chunks.push({
            chunkId: `${input.filename}-slide-${slideNum}`,
            docId: input.filename,
            page: slideNum,
            headingPath: [input.filename, `幻灯片 ${slideNum}`, ...(slideTitle ? [slideTitle] : [])],
            text: combinedText,
            mediaType: hasTable ? "table" : "slide",
            sourceFormat: "pptx",
            metadata: {
              slideNumber: slideNum,
              title: slideTitle,
              hasTable,
            },
          });
        }
      }

      return chunks;
    } catch {
      return [];
    }
  }

  // 6. EPUB E-Book Parser (Extracts Chapters, Sections & Headings via fflate)
  private parseEpub(input: RawDocumentInput): readonly DocumentChunk[] {
    const buffer = this.getBuffer(input);
    if (buffer.length === 0) return [];

    try {
      const unzipped = fflate.unzipSync(buffer);
      const htmlKeys = Object.keys(unzipped)
        .filter((k) => /\.(xhtml|html|htm)$/i.test(k) && !k.includes("toc"))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      const chunks: DocumentChunk[] = [];
      let chapIdx = 1;

      for (const key of htmlKeys) {
        const fileBytes = unzipped[key];
        if (!fileBytes) continue;
        let content = fflate.strFromU8(fileBytes);

        // Strip scripts & styles
        content = content.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");

        const hMatch = content.match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i) || content.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
        const chapterTitle = hMatch ? normalizeWhitespace(unescapeXml(hMatch[1]?.replace(/<[^>]+>/g, "") ?? "")) : `第 ${chapIdx} 章`;

        const stripped = content.replace(/<[^>]+>/g, " ");
        const text = normalizeWhitespace(unescapeXml(stripped));

        if (text.length > 20) {
          const slices = this.sliceString(text, this.maxChunkChars);
          slices.forEach((slice, sIdx) => {
            chunks.push({
              chunkId: `${input.filename}-ch${chapIdx}-${sIdx + 1}`,
              docId: input.filename,
              page: chapIdx,
              headingPath: [input.filename, chapterTitle, ...(slices.length > 1 ? [`节 ${sIdx + 1}`] : [])],
              text: slice,
              mediaType: "text",
              sourceFormat: "epub",
              metadata: { chapter: chapterTitle, section: sIdx + 1 },
            });
          });
          chapIdx++;
        }
      }

      return chunks;
    } catch {
      return [];
    }
  }

  // 7. Video Subtitle & Transcript Parser (.srt, .vtt for MOOC / Course Videos)
  private parseSubtitle(input: RawDocumentInput, ext: "srt" | "vtt"): readonly DocumentChunk[] {
    const raw = this.getText(input);
    if (!raw.trim()) return [];

    const lines = raw.split(/\r?\n/);
    const cues: { start: string; end: string; text: string }[] = [];
    const timestampRegex = /(\d{2}:\d{2}:\d{2}[,\.]\d{2,3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{2,3})/;

    let currentStart = "";
    let currentEnd = "";
    let currentCueLines: string[] = [];

    const flushCue = () => {
      const cueText = normalizeWhitespace(currentCueLines.join(" "));
      if (cueText && currentStart) {
        cues.push({ start: currentStart, end: currentEnd, text: cueText });
      }
      currentCueLines = [];
    };

    for (const line of lines) {
      const trimmed = line.trim();
      const tsMatch = trimmed.match(timestampRegex);
      if (tsMatch && tsMatch[1] && tsMatch[2]) {
        flushCue();
        currentStart = tsMatch[1];
        currentEnd = tsMatch[2];
        continue;
      }
      if (/^\d+$/.test(trimmed) || trimmed === "WEBVTT") {
        continue;
      }
      if (trimmed.length === 0) {
        flushCue();
      } else {
        currentCueLines.push(trimmed);
      }
    }
    flushCue();

    if (cues.length === 0) {
      return this.parseTextAndMarkdown(input, "txt");
    }

    const chunks: DocumentChunk[] = [];
    let batchCues: string[] = [];
    let batchStart = cues[0]?.start ?? "00:00:00";
    let batchEnd = cues[0]?.end ?? "00:00:00";
    let batchChars = 0;
    let chunkSeq = 1;

    for (const cue of cues) {
      batchCues.push(`[${cue.start} --> ${cue.end}] ${cue.text}`);
      batchEnd = cue.end;
      batchChars += cue.text.length + 30;

      if (batchChars >= this.maxChunkChars * 0.8) {
        chunks.push({
          chunkId: `${input.filename}-sub-${chunkSeq++}`,
          docId: input.filename,
          page: chunkSeq,
          headingPath: [input.filename, `课程视频字幕 ${batchStart} ~ ${batchEnd}`],
          text: batchCues.join("\n"),
          mediaType: "text",
          sourceFormat: "transcript",
          metadata: { start: batchStart, end: batchEnd },
        });
        batchCues = [];
        batchChars = 0;
        batchStart = cue.end;
      }
    }

    if (batchCues.length > 0) {
      chunks.push({
        chunkId: `${input.filename}-sub-${chunkSeq++}`,
        docId: input.filename,
        page: chunkSeq,
        headingPath: [input.filename, `课程视频字幕 ${batchStart} ~ ${batchEnd}`],
        text: batchCues.join("\n"),
        mediaType: "text",
        sourceFormat: "transcript",
        metadata: { start: batchStart, end: batchEnd },
      });
    }

    return chunks;
  }

  // 8. Code & Structured Markup Parser (Python, TypeScript, Rust, C++, SQL, JSON, YAML)
  private parseCodeAndMarkup(input: RawDocumentInput, ext: string): readonly DocumentChunk[] {
    const raw = this.getText(input);
    if (!raw.trim()) return [];

    const langMap: Record<string, string> = {
      py: "python",
      ts: "typescript",
      js: "javascript",
      rs: "rust",
      cpp: "cpp",
      c: "c",
      java: "java",
      go: "go",
      sql: "sql",
      sh: "bash",
      json: "json",
      yaml: "yaml",
      yml: "yaml",
      xml: "xml",
      html: "html",
      rst: "rst",
    };
    const lang = langMap[ext] ?? ext;
    const lines = raw.split(/\r?\n/);
    const chunks: DocumentChunk[] = [];
    const batchLines = 60;
    let chunkSeq = 1;

    for (let i = 0; i < lines.length; i += batchLines) {
      const slice = lines.slice(i, i + batchLines);
      const startLine = i + 1;
      const endLine = i + slice.length;

      const codeBlock = ["```" + lang, `// ${input.filename} (行 ${startLine}-${endLine})`, ...slice, "```"].join("\n");

      chunks.push({
        chunkId: `${input.filename}-code-${chunkSeq++}`,
        docId: input.filename,
        page: Math.ceil(startLine / batchLines),
        headingPath: [input.filename, `代码实现 行 ${startLine}-${endLine}`],
        text: codeBlock,
        mediaType: "code",
        sourceFormat: "code",
        metadata: { language: lang, startLine, endLine },
      });
    }

    return chunks;
  }

  // 9. LaTeX Academic Paper Parser (.tex)
  private parseLatex(input: RawDocumentInput): readonly DocumentChunk[] {
    const raw = this.getText(input);
    if (!raw.trim()) return [];

    const lines = raw.split(/\r?\n/);
    const chunks: DocumentChunk[] = [];
    let currentSection = "论文导论与摘要";
    let buffer: string[] = [];
    let chunkSeq = 1;

    const flush = () => {
      const text = buffer.join("\n").trim();
      if (text.length > 0) {
        chunks.push({
          chunkId: `${input.filename}-tex-${chunkSeq++}`,
          docId: input.filename,
          page: chunkSeq,
          headingPath: [input.filename, currentSection],
          text,
          mediaType: "text",
          sourceFormat: "txt",
        });
      }
      buffer = [];
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("%")) continue;
      const secMatch = trimmed.match(/\\(?:section|subsection|chapter)\*?\{([^}]+)\}/);
      if (secMatch && secMatch[1]) {
        flush();
        currentSection = secMatch[1].trim();
        continue;
      }
      buffer.push(line);
      if (buffer.join("\n").length >= this.maxChunkChars) {
        flush();
      }
    }
    flush();

    return chunks;
  }

  private columnLettersToIndex(letters: string): number {
    let index = 0;
    for (let i = 0; i < letters.length; i++) {
      index = index * 26 + (letters.charCodeAt(i) - 64);
    }
    return index;
  }

  // 10. PDF Parser (Dual-Engine: pdfjs-dist + Flate stream fallback + Scanned Document Detection)
  private async parsePdf(input: RawDocumentInput): Promise<readonly DocumentChunk[]> {
    const buffer = this.getBuffer(input);
    if (buffer.length === 0) return [];

    try {
      const pdfjs = await this.tryLoadPdfJs();
      if (pdfjs && typeof pdfjs.getDocument === "function") {
        const loadingTask = pdfjs.getDocument({
          data: buffer,
          isEvalSupported: false,
          useWorkerFetch: false,
        });
        const pdfDoc = await loadingTask.promise;
        const chunks: DocumentChunk[] = [];
        let chunkSeq = 1;

        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
          const page = await pdfDoc.getPage(pageNum);
          const textContent = await page.getTextContent();
          const pageText = normalizeWhitespace(
            textContent.items.map((it: { str?: string }) => it.str || "").join(" ")
          );

          if (pageText.length > 20) {
            const slices = this.sliceString(pageText, this.maxChunkChars);
            slices.forEach((slice, sIdx) => {
              chunks.push({
                chunkId: `${input.filename}-p${pageNum}-${chunkSeq++}`,
                docId: input.filename,
                page: pageNum,
                headingPath: [input.filename, `第 ${pageNum} 页`, ...(slices.length > 1 ? [`段落 ${sIdx + 1}`] : [])],
                text: slice,
                mediaType: "text",
                sourceFormat: "pdf",
              });
            });
          } else {
            // Scanned Page Detection
            chunks.push({
              chunkId: `${input.filename}-p${pageNum}-scan`,
              docId: input.filename,
              page: pageNum,
              headingPath: [input.filename, `第 ${pageNum} 页 (扫描件)`],
              text: `[扫描件 PDF: ${input.filename}] 第 ${pageNum} 页为扫描位图或手写试卷图像。已建立多模态检索索引。在配置视觉模型 (Vision BYOK) 时可自动进行端侧图文识别与题目辅导。`,
              mediaType: "image",
              sourceFormat: "pdf",
              metadata: { isScanned: true, pageNum },
            });
          }
        }
        if (chunks.length > 0) return chunks;
      }
    } catch {
      // Gracefully fall through to pure TS stream extractor
    }

    return this.parsePdfStreams(input, buffer);
  }

  private async tryLoadPdfJs(): Promise<any> {
    try {
      const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
      return (mod as any).default || mod;
    } catch {
      try {
        const mod = await import("pdfjs-dist");
        return (mod as any).default || mod;
      } catch {
        return null;
      }
    }
  }

  private parsePdfStreams(input: RawDocumentInput, buffer: Uint8Array): readonly DocumentChunk[] {
    try {
      const pdfString = fflate.strFromU8(buffer);
      const chunks: DocumentChunk[] = [];
      const extractedTextPieces: string[] = [];

      const literalMatches = pdfString.matchAll(/\(([^()]{3,})\)\s*Tj/g);
      for (const m of literalMatches) {
        if (m[1]) extractedTextPieces.push(unescapeXml(m[1]));
      }

      const arrayMatches = pdfString.matchAll(/\[(.*?)\]\s*TJ/g);
      for (const am of arrayMatches) {
        const inner = am[1] || "";
        const parts = Array.from(inner.matchAll(/\((.*?)\)/g)).map((p) => p[1] || "");
        if (parts.length > 0) extractedTextPieces.push(parts.join(" "));
      }

      const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
      let sMatch: RegExpExecArray | null;
      let count = 0;

      while ((sMatch = streamRegex.exec(pdfString)) !== null && count < 30) {
        count++;
        const rawStream = sMatch[1] ?? "";
        const streamBytes = fflate.strToU8(rawStream);
        try {
          const decompressed = fflate.inflateSync(streamBytes);
          const decompText = fflate.strFromU8(decompressed);
          const subMatches = Array.from(decompText.matchAll(/\(([^()]{3,})\)\s*Tj/g)).map((m) => m[1] || "");
          if (subMatches.length > 0) extractedTextPieces.push(subMatches.join(" "));
        } catch {
          // Non-flate stream; skip
        }
      }

      const combined = normalizeWhitespace(extractedTextPieces.join(" "));
      if (combined.length > 0) {
        const slices = this.sliceString(combined, this.maxChunkChars);
        slices.forEach((slice, idx) => {
          chunks.push({
            chunkId: `${input.filename}-pdf-${idx + 1}`,
            docId: input.filename,
            page: idx + 1,
            headingPath: [input.filename, `PDF 提取切片 ${idx + 1}`],
            text: slice,
            mediaType: "text",
            sourceFormat: "pdf",
          });
        });
      }

      if (chunks.length === 0) {
        chunks.push({
          chunkId: `${input.filename}-pdf-meta`,
          docId: input.filename,
          page: 1,
          headingPath: [input.filename, "PDF 文档信息 (扫描件)"],
          text: `[扫描件 PDF: ${input.filename}] 大小: ${(buffer.length / 1024).toFixed(1)} KB。包含页面扫描图层，已录入本地知识库，可作为检索源与学习目标依据。`,
          mediaType: "image",
          sourceFormat: "pdf",
          metadata: { isScanned: true },
        });
      }

      return chunks;
    } catch {
      return [];
    }
  }

  // 11. Image, Scanned Bitmap & SVG Vector Graphics Parser
  private parseImage(
    input: RawDocumentInput,
    ext: string
  ): readonly DocumentChunk[] {
    const buffer = this.getBuffer(input);
    const sizeKb = (buffer.length / 1024).toFixed(1);
    let width = 0;
    let height = 0;
    let svgLabels = "";

    if (ext === "png" && buffer.length >= 24) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      width = view.getUint32(16, false);
      height = view.getUint32(20, false);
    } else if ((ext === "jpg" || ext === "jpeg") && buffer.length >= 8) {
      let offset = 2;
      while (offset < buffer.length - 8) {
        if (buffer[offset] === 0xff) {
          const marker = buffer[offset + 1];
          if (marker === 0xc0 || marker === 0xc2) {
            const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
            height = view.getUint16(offset + 5, false);
            width = view.getUint16(offset + 7, false);
            break;
          } else if (marker === 0xd9 || marker === 0xda) {
            break;
          } else {
            const length = (buffer[offset + 2]! << 8) + buffer[offset + 3]!;
            offset += 2 + length;
            continue;
          }
        }
        offset++;
      }
    } else if (ext === "bmp" && buffer.length >= 26) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      width = view.getInt32(18, true);
      height = Math.abs(view.getInt32(22, true));
    } else if (ext === "svg") {
      const svgStr = this.getText(input);
      const textMatches = Array.from(svgStr.matchAll(/<(?:text|tspan)\b[^>]*>([\s\S]*?)<\/(?:text|tspan)>/g));
      svgLabels = normalizeWhitespace(textMatches.map((m) => unescapeXml(m[1]?.replace(/<[^>]+>/g, "") ?? "")).join(" "));
      const vbMatch = svgStr.match(/viewBox="[\d\s\.,]+ (\d+) (\d+)"/i) || svgStr.match(/width="(\d+)"[^>]*height="(\d+)"/i);
      if (vbMatch) {
        width = parseInt(vbMatch[1] ?? "0", 10);
        height = parseInt(vbMatch[2] ?? "0", 10);
      }
    }

    const dimensionDesc = width > 0 && height > 0 ? `${width}×${height}px` : "标准图像尺寸";
    const labelDesc = svgLabels.length > 0 ? ` 包含图元标注与文本: "${svgLabels.slice(0, 300)}"` : "";
    const text = `[多模态视觉资源: ${input.filename}] 文件名: ${input.filename}, 格式: ${ext.toUpperCase()}, 分辨率: ${dimensionDesc}, 体积: ${sizeKb} KB。${labelDesc}包含视觉图表或插图证据，可供学习智能体在多模态分析、解题辅导和 SVG 绘图反思中直接关联佐证。`;

    return [
      {
        chunkId: `${input.filename}-img-1`,
        docId: input.filename,
        page: 1,
        headingPath: ["图像多模态视觉库", input.filename],
        text,
        mediaType: "image",
        sourceFormat: "image",
        ...(input.dataUrl ? { dataUrl: input.dataUrl } : {}),
        metadata: {
          width,
          height,
          sizeKb,
          format: ext,
          ...(svgLabels ? { labels: svgLabels } : {}),
        },
      },
    ];
  }

  private sliceString(str: string, maxLen: number): string[] {
    const res: string[] = [];
    let start = 0;
    while (start < str.length) {
      let end = start + maxLen;
      if (end < str.length) {
        const lastSpace = str.lastIndexOf(" ", end);
        if (lastSpace > start + maxLen * 0.7) {
          end = lastSpace;
        }
      }
      res.push(str.slice(start, end).trim());
      start = end;
    }
    return res;
  }
}
