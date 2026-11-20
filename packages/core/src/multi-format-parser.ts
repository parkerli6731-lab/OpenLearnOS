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
    .replace(/&apos;/g, "'");
}

function normalizeWhitespace(text: string): string {
  return text.replace(/[ \t\r\f]+/g, " ").trim();
}

/**
 * Pure TypeScript Multi-Format Document Ingestion Engine.
 * Runs client-side in Web Worker, Node.js harness, or Tauri desktop without server dependencies.
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
    const docId = input.filename;

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

      case "pdf":
        return this.parsePdf(input);

      case "png":
      case "jpg":
      case "jpeg":
      case "webp":
      case "gif":
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

      // Construct clean Markdown Table
      const mdLines: string[] = [];
      mdLines.push(`| ${header.join(" | ")} |`);
      mdLines.push(`| ${header.map(() => "---").join(" | ")} |`);
      for (const row of batch) {
        // Pad row to header length
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

      // Extract tables and paragraphs in order
      const bodyRegex = /<w:body[\s>]([\s\S]*?)<\/w:body>/;
      const bodyMatch = docXml.match(bodyRegex);
      const bodyContent = bodyMatch ? (bodyMatch[1] ?? "") : docXml;

      // Tokenize by top-level <w:p> and <w:tbl>
      const blockRegex = /<(w:p|w:tbl)[\s>][\s\S]*?<\/\1>/g;
      let match: RegExpExecArray | null;

      while ((match = blockRegex.exec(bodyContent)) !== null) {
        const blockXml = match[0];
        const isTable = match[1] === "w:tbl";

        if (isTable) {
          flushChunk("text");
          // Parse table rows and cells into Markdown table
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
          // Paragraph <w:p>
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
      // 1. Shared Strings Table
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

      // 2. Discover Sheet Names from workbook.xml
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

      // 3. Process each worksheet
      for (const [pathKey, fileBytes] of Object.entries(unzipped)) {
        if (!pathKey.startsWith("xl/worksheets/sheet") || !pathKey.endsWith(".xml")) continue;
        const sheetFile = pathKey.replace("xl/worksheets/", "");
        const sheetTitle = sheetNames[sheetFile] || sheetFile.replace(".xml", "");
        const sheetXml = fflate.strFromU8(fileBytes);

        // Parse rows
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

        // First row as header
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

  private columnLettersToIndex(letters: string): number {
    let index = 0;
    for (let i = 0; i < letters.length; i++) {
      index = index * 26 + (letters.charCodeAt(i) - 64);
    }
    return index;
  }

  // 5. PDF Parser (Dual-Engine: pdfjs-dist when available + pure TS Flate stream extractor fallback)
  private async parsePdf(input: RawDocumentInput): Promise<readonly DocumentChunk[]> {
    const buffer = this.getBuffer(input);
    if (buffer.length === 0) return [];

    // Attempt 1: High-fidelity pdfjs-dist if loaded
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

          if (pageText.length > 0) {
            // Split long page text into manageable chunks
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
          }
        }
        if (chunks.length > 0) return chunks;
      }
    } catch {
      // Gracefully fall through to pure TS stream extractor
    }

    // Attempt 2: Zero-Dependency Flate-Decode Stream & Text Operator Extractor
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

      // Extract uncompressed literal strings
      const literalMatches = pdfString.matchAll(/\(([^()]{3,})\)\s*Tj/g);
      for (const m of literalMatches) {
        if (m[1]) extractedTextPieces.push(unescapeXml(m[1]));
      }

      // Extract array strings: [(Hello) -10 (World)] TJ
      const arrayMatches = pdfString.matchAll(/\[(.*?)\]\s*TJ/g);
      for (const am of arrayMatches) {
        const inner = am[1] || "";
        const parts = Array.from(inner.matchAll(/\((.*?)\)/g)).map((p) => p[1] || "");
        if (parts.length > 0) extractedTextPieces.push(parts.join(" "));
      }

      // Locate streams that might be FlateDecoded
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

      // If text extraction yielded nothing (e.g. scanned image PDF), provide metadata chunk
      if (chunks.length === 0) {
        chunks.push({
          chunkId: `${input.filename}-pdf-meta`,
          docId: input.filename,
          page: 1,
          headingPath: [input.filename, "PDF 文档信息"],
          text: `[PDF 文档: ${input.filename}] 大小: ${(buffer.length / 1024).toFixed(1)} KB。已录入本地知识库，可作为检索源与学习目标依据。`,
          mediaType: "text",
          sourceFormat: "pdf",
        });
      }

      return chunks;
    } catch {
      return [];
    }
  }

  // 6. Image Parser (PNG, JPEG, WebP Header Dimensions & Visual Chunk Formulation)
  private parseImage(
    input: RawDocumentInput,
    ext: string
  ): readonly DocumentChunk[] {
    const buffer = this.getBuffer(input);
    const sizeKb = (buffer.length / 1024).toFixed(1);
    let width = 0;
    let height = 0;

    if (ext === "png" && buffer.length >= 24) {
      // PNG IHDR: bytes 16-19 width, 20-23 height (big endian)
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      width = view.getUint32(16, false);
      height = view.getUint32(20, false);
    } else if ((ext === "jpg" || ext === "jpeg") && buffer.length >= 8) {
      // JPEG SOF0/SOF2 marker scan
      let offset = 2;
      while (offset < buffer.length - 8) {
        if (buffer[offset] === 0xff) {
          const marker = buffer[offset + 1];
          // Baseline SOF0 (0xc0) or Progressive SOF2 (0xc2)
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
    }

    const dimensionDesc = width > 0 && height > 0 ? `${width}×${height}px` : "标准图像尺寸";
    const text = `[多模态视觉资源: ${input.filename}] 格式: ${ext.toUpperCase()}, 分辨率: ${dimensionDesc}, 体积: ${sizeKb} KB。包含视觉图表或插图证据，可供学习智能体在多模态分析、解题辅导和 SVG 绘图反思中直接关联佐证。`;

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
        // Find nearby space or punctuation
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
