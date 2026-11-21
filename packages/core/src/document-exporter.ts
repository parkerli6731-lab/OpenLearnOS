import type { CitationRef, DocumentExportData } from "@openlearnos/contracts";
import * as fflate from "fflate";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function utf16Hex(str: string): string {
  let hex = "";
  for (let i = 0; i < str.length; i++) {
    hex += str.charCodeAt(i).toString(16).padStart(4, "0");
  }
  return hex;
}

/**
 * Clean-Room Word (.docx) document generator.
 * Produces a standard OpenXML package with styles, callouts, and citation tables.
 */
export function exportDocx(data: DocumentExportData): Uint8Array {
  const title = data.title || "OpenLearnOS 学习活体笔记与概念沉淀";
  const lines = data.markdown.split(/\r?\n/);
  const paragraphsXml: string[] = [];

  // Title block
  paragraphsXml.push(`
    <w:p>
      <w:pPr>
        <w:jc w:val="center"/>
        <w:spacing w:before="240" w:after="160"/>
      </w:pPr>
      <w:r>
        <w:rPr>
          <w:b/>
          <w:sz w:val="40"/>
          <w:color w:val="1E293B"/>
        </w:rPr>
        <w:t xml:space="preserve">${escapeXml(title)}</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:jc w:val="center"/>
        <w:spacing w:after="360"/>
      </w:pPr>
      <w:r>
        <w:rPr>
          <w:sz w:val="18"/>
          <w:color w:val="64748B"/>
        </w:rPr>
        <w:t xml:space="preserve">OpenLearnOS 自主闭环学习系统 · 生成模式：${escapeXml(data.mode ? data.mode.toUpperCase() : "AGENT")}</w:t>
      </w:r>
    </w:p>
  `);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith("### ")) {
      paragraphsXml.push(`
        <w:p>
          <w:pPr><w:spacing w:before="200" w:after="100"/></w:pPr>
          <w:r>
            <w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="2563EB"/></w:rPr>
            <w:t xml:space="preserve">${escapeXml(trimmed.slice(4))}</w:t>
          </w:r>
        </w:p>
      `);
    } else if (trimmed.startsWith("## ")) {
      paragraphsXml.push(`
        <w:p>
          <w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>
          <w:r>
            <w:rPr><w:b/><w:sz w:val="30"/><w:color w:val="1E293B"/></w:rPr>
            <w:t xml:space="preserve">${escapeXml(trimmed.slice(3))}</w:t>
          </w:r>
        </w:p>
      `);
    } else if (trimmed.startsWith("# ")) {
      paragraphsXml.push(`
        <w:p>
          <w:pPr><w:spacing w:before="280" w:after="140"/></w:pPr>
          <w:r>
            <w:rPr><w:b/><w:sz w:val="34"/><w:color w:val="0F172A"/></w:rPr>
            <w:t xml:space="preserve">${escapeXml(trimmed.slice(2))}</w:t>
          </w:r>
        </w:p>
      `);
    } else if (trimmed.startsWith("> ")) {
      paragraphsXml.push(`
        <w:p>
          <w:pPr>
            <w:pBdr><w:left w:val="single" w:sz="24" w:space="16" w:color="3B82F6"/></w:pBdr>
            <w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/>
            <w:spacing w:before="120" w:after="120"/>
            <w:ind w:left="240" w:right="240"/>
          </w:pPr>
          <w:r>
            <w:rPr><w:color w:val="334155"/><w:sz w:val="21"/></w:rPr>
            <w:t xml:space="preserve">${escapeXml(trimmed.slice(2))}</w:t>
          </w:r>
        </w:p>
      `);
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      paragraphsXml.push(`
        <w:p>
          <w:pPr>
            <w:spacing w:before="60" w:after="60"/>
            <w:ind w:left="360"/>
          </w:pPr>
          <w:r>
            <w:rPr><w:color w:val="2563EB"/></w:rPr>
            <w:t xml:space="preserve">• </w:t>
          </w:r>
          <w:r>
            <w:rPr><w:sz w:val="22"/><w:color w:val="334155"/></w:rPr>
            <w:t xml:space="preserve">${escapeXml(trimmed.slice(2))}</w:t>
          </w:r>
        </w:p>
      `);
    } else {
      paragraphsXml.push(`
        <w:p>
          <w:pPr><w:spacing w:before="80" w:after="80"/><w:ind w:firstLine="400"/></w:pPr>
          <w:r>
            <w:rPr><w:sz w:val="22"/><w:color w:val="1E293B"/></w:rPr>
            <w:t xml:space="preserve">${escapeXml(trimmed)}</w:t>
          </w:r>
        </w:p>
      `);
    }
  }

  // Citations table block
  if (data.citations && data.citations.length > 0) {
    paragraphsXml.push(`
      <w:p>
        <w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr>
        <w:r>
          <w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="1E293B"/></w:rPr>
          <w:t xml:space="preserve">📚 双栏溯源原文依据 (Grounding Citations)</w:t>
        </w:r>
      </w:p>
      <w:tbl>
        <w:tblPr>
          <w:tblW w:w="9360" w:type="dxa"/>
          <w:tblBorders>
            <w:top w:val="single" w:sz="8" w:space="0" w:color="CBD5E1"/>
            <w:bottom w:val="single" w:sz="8" w:space="0" w:color="CBD5E1"/>
            <w:insideH w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>
            <w:insideV w:val="none"/>
          </w:tblBorders>
        </w:tblPr>
        <w:tr>
          <w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="2563EB"/><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>序号</w:t></w:r></w:p></w:tc>
          <w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="2563EB"/><w:tcW w:w="3200" w:type="dxa"/></w:tcPr><w:p><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>文档名称</w:t></w:r></w:p></w:tc>
          <w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="2563EB"/><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>页码</w:t></w:r></w:p></w:tc>
          <w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="2563EB"/><w:tcW w:w="3760" w:type="dxa"/></w:tcPr><w:p><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>原文切片证据摘录</w:t></w:r></w:p></w:tc>
        </w:tr>
        ${data.citations
          .map(
            (c, idx) => `
          <w:tr>
            <w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p><w:r><w:rPr><w:sz w:val="19"/><w:color w:val="64748B"/></w:rPr><w:t>[${idx + 1}]</w:t></w:r></w:p></w:tc>
            <w:tc><w:tcPr><w:tcW w:w="3200" w:type="dxa"/></w:tcPr><w:p><w:r><w:rPr><w:sz w:val="19"/><w:color w:val="1E293B"/></w:rPr><w:t>${escapeXml(c.docId)}</w:t></w:r></w:p></w:tc>
            <w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p><w:r><w:rPr><w:sz w:val="19"/><w:color w:val="2563EB"/></w:rPr><w:t>P.${c.page}</w:t></w:r></w:p></w:tc>
            <w:tc><w:tcPr><w:tcW w:w="3760" w:type="dxa"/></w:tcPr><w:p><w:r><w:rPr><w:sz w:val="18"/><w:color w:val="475569"/></w:rPr><w:t>${escapeXml((c.excerpt || "").slice(0, 100))}</w:t></w:r></w:p></w:tc>
          </w:tr>
        `
          )
          .join("")}
      </w:tbl>
    `);
  }

  // Quiz item block
  if (data.quiz) {
    paragraphsXml.push(`
      <w:p>
        <w:pPr><w:spacing w:before="280" w:after="80"/></w:pPr>
        <w:r>
          <w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="1E293B"/></w:rPr>
          <w:t xml:space="preserve">🎯 知识掌握度检验试题 (Mastery Quiz)</w:t>
        </w:r>
      </w:p>
      <w:p>
        <w:pPr>
          <w:pBdr><w:left w:val="single" w:sz="24" w:space="12" w:color="10B981"/></w:pBdr>
          <w:shd w:val="clear" w:color="auto" w:fill="ECFDF5"/>
          <w:spacing w:before="100" w:after="100"/>
          <w:ind w:left="200" w:right="200"/>
        </w:pPr>
        <w:r>
          <w:rPr><w:b/><w:sz w:val="22"/><w:color w:val="065F46"/></w:rPr>
          <w:t xml:space="preserve">${escapeXml(data.quiz.question)}</w:t>
        </w:r>
      </w:p>
      ${data.quiz.options
        .map(
          (opt, i) => `
        <w:p>
          <w:pPr><w:ind w:left="360"/><w:spacing w:before="40" w:after="40"/></w:pPr>
          <w:r>
            <w:rPr><w:b/><w:color w:val="059669"/><w:sz w:val="20"/></w:rPr>
            <w:t xml:space="preserve">${String.fromCharCode(65 + i)}. </w:t>
          </w:r>
          <w:r>
            <w:rPr><w:sz w:val="20"/><w:color w:val="334155"/></w:rPr>
            <w:t xml:space="preserve">${escapeXml(opt)}</w:t>
          </w:r>
        </w:p>
      `
        )
        .join("")}
      <w:p>
        <w:pPr><w:spacing w:before="80" w:after="80"/><w:ind w:left="360"/></w:pPr>
        <w:r>
          <w:rPr><w:b/><w:color w:val="10B981"/><w:sz w:val="20"/></w:rPr>
          <w:t xml:space="preserve">正确答案：${String.fromCharCode(65 + data.quiz.correctIndex)}    解析：${escapeXml(data.quiz.explanation)}</w:t>
        </w:r>
      </w:p>
    `);
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphsXml.join("\n")}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const docPartPath = "word/" + "document" + ".xml";
  const docPartType =
    "application/vnd.openxmlformats-officedocument.wordprocessingml." + "document" + ".main+xml";

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/${docPartPath}" ContentType="${docPartType}"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${docPartPath}"/>
</Relationships>`;

  const zipFiles: Record<string, Uint8Array> = {
    "[Content_Types].xml": fflate.strToU8(contentTypesXml),
    "_rels/.rels": fflate.strToU8(rootRelsXml),
  };
  zipFiles[docPartPath] = fflate.strToU8(documentXml);

  return fflate.zipSync(zipFiles);
}

/**
 * Clean-Room Excel (.xlsx) workbook generator.
 * Produces structured worksheets for living notes and flashcards.
 */
export function exportXlsx(data: DocumentExportData): Uint8Array {
  const lines = data.markdown.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const title = data.title || "OpenLearnOS 学习活体笔记与概念沉淀";

  const rowsXml: string[] = [];
  rowsXml.push(`
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>序号</t></is></c>
      <c r="B1" t="inlineStr"><is><t>模块/章节</t></is></c>
      <c r="C1" t="inlineStr"><is><t>核心笔记与概念推导</t></is></c>
      <c r="D1" t="inlineStr"><is><t>溯源出处</t></is></c>
      <c r="E1" t="inlineStr"><is><t>学习模式</t></is></c>
    </row>
  `);

  let currentHeading = title;
  let rowIdx = 2;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      currentHeading = trimmed.replace(/^#+\s*/, "");
      continue;
    }

    const citationHint = data.citations?.[0]
      ? `${data.citations[0].docId} P.${data.citations[0].page}`
      : "OpenLearnOS Grounded Retrieval";

    rowsXml.push(`
      <row r="${rowIdx}">
        <c r="A${rowIdx}"><v>${rowIdx - 1}</v></c>
        <c r="B${rowIdx}" t="inlineStr"><is><t>${escapeXml(currentHeading)}</t></is></c>
        <c r="C${rowIdx}" t="inlineStr"><is><t>${escapeXml(trimmed)}</t></is></c>
        <c r="D${rowIdx}" t="inlineStr"><is><t>${escapeXml(citationHint)}</t></is></c>
        <c r="E${rowIdx}" t="inlineStr"><is><t>${escapeXml(data.mode ? data.mode.toUpperCase() : "AGENT")}</t></is></c>
      </row>
    `);
    rowIdx++;
  }

  // Quiz Sheet Rows
  const quizRowsXml: string[] = [];
  quizRowsXml.push(`
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>试题ID</t></is></c>
      <c r="B1" t="inlineStr"><is><t>知识主题</t></is></c>
      <c r="C1" t="inlineStr"><is><t>检验问题</t></is></c>
      <c r="D1" t="inlineStr"><is><t>选项 A</t></is></c>
      <c r="E1" t="inlineStr"><is><t>选项 B</t></is></c>
      <c r="F1" t="inlineStr"><is><t>选项 C</t></is></c>
      <c r="G1" t="inlineStr"><is><t>选项 D</t></is></c>
      <c r="H1" t="inlineStr"><is><t>正确答案</t></is></c>
      <c r="I1" t="inlineStr"><is><t>解析说明</t></is></c>
    </row>
  `);

  if (data.quiz) {
    const q = data.quiz;
    quizRowsXml.push(`
      <row r="2">
        <c r="A2" t="inlineStr"><is><t>${escapeXml(q.quizId)}</t></is></c>
        <c r="B2" t="inlineStr"><is><t>${escapeXml(q.conceptTopic)}</t></is></c>
        <c r="C2" t="inlineStr"><is><t>${escapeXml(q.question)}</t></is></c>
        <c r="D2" t="inlineStr"><is><t>${escapeXml(q.options[0] || "")}</t></is></c>
        <c r="E2" t="inlineStr"><is><t>${escapeXml(q.options[1] || "")}</t></is></c>
        <c r="F2" t="inlineStr"><is><t>${escapeXml(q.options[2] || "")}</t></is></c>
        <c r="G2" t="inlineStr"><is><t>${escapeXml(q.options[3] || "")}</t></is></c>
        <c r="H2" t="inlineStr"><is><t>${String.fromCharCode(65 + q.correctIndex)}</t></is></c>
        <c r="I2" t="inlineStr"><is><t>${escapeXml(q.explanation)}</t></is></c>
      </row>
    `);
  }

  const sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${rowsXml.join("\n")}
  </sheetData>
</worksheet>`;

  const sheet2Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${quizRowsXml.join("\n")}
  </sheetData>
</worksheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="知识笔记清单" sheetId="1" r:id="rId1"/>
    <sheet name="掌握度题库与复习卡" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const zipFiles: Record<string, Uint8Array> = {
    "[Content_Types].xml": fflate.strToU8(contentTypesXml),
    "_rels/.rels": fflate.strToU8(rootRelsXml),
    "xl/_rels/workbook.xml.rels": fflate.strToU8(workbookRelsXml),
    "xl/workbook.xml": fflate.strToU8(workbookXml),
    "xl/worksheets/sheet1.xml": fflate.strToU8(sheet1Xml),
    "xl/worksheets/sheet2.xml": fflate.strToU8(sheet2Xml),
  };

  return fflate.zipSync(zipFiles);
}

/**
 * Clean-Room Standalone PDF (%PDF-1.4) document generator.
 * Employs standard Adobe CJK CID-Font mapping (STSong-Light / UniGB-UTF16-H)
 * with multi-page line wrapping and pagination.
 */
export function exportPdf(data: DocumentExportData): Uint8Array {
  const title = data.title || "OpenLearnOS 学习活体笔记与概念沉淀";
  const lines: string[] = [];

  lines.push(title);
  lines.push(`OpenLearnOS 自主闭环学习系统 · 模式: ${(data.mode || "agent").toUpperCase()}`);
  lines.push("--------------------------------------------------------------------------------");

  for (const rawLine of data.markdown.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    // Simple line wrap for PDF standard width (~42 chars per line)
    const maxLen = 38;
    for (let i = 0; i < trimmed.length; i += maxLen) {
      lines.push(trimmed.slice(i, i + maxLen));
    }
  }

  if (data.citations && data.citations.length > 0) {
    lines.push("--------------------------------------------------------------------------------");
    lines.push("📚 双栏溯源原文依据 (Grounding Citations):");
    for (const c of data.citations) {
      lines.push(`[${c.docId} P.${c.page}] ${(c.excerpt || "").slice(0, 36)}...`);
    }
  }

  if (data.quiz) {
    lines.push("--------------------------------------------------------------------------------");
    lines.push(`🎯 知识掌握度检验试题: ${data.quiz.question}`);
    data.quiz.options.forEach((opt, i) => {
      lines.push(`  ${String.fromCharCode(65 + i)}. ${opt}`);
    });
    lines.push(`  [正确答案: ${String.fromCharCode(65 + data.quiz.correctIndex)}] 解析: ${data.quiz.explanation}`);
  }

  // Paginate lines: ~38 lines per A4 page
  const LINES_PER_PAGE = 36;
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
    pages.push(lines.slice(i, i + LINES_PER_PAGE));
  }
  if (pages.length === 0) pages.push(["(空白笔记)"]);

  // Build PDF Objects
  // 1: Catalog
  // 2: Pages
  // 4: Font Type0 (STSong-Light)
  // 5: CIDFontType0
  // 6.. : Page and Contents
  const totalPages = pages.length;
  const pageObjIds: number[] = [];
  const contentObjIds: number[] = [];
  let nextObjId = 6;

  for (let i = 0; i < totalPages; i++) {
    pageObjIds.push(nextObjId++);
    contentObjIds.push(nextObjId++);
  }

  let pdfStr = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [0];

  function addObj(id: number, content: string): void {
    offsets[id] = Buffer.byteLength(pdfStr);
    pdfStr += `${id} 0 obj\n${content}\nendobj\n`;
  }

  // 1: Catalog
  addObj(1, `<< /Type /Catalog /Pages 2 0 R >>`);

  // 2: Pages
  addObj(2, `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${totalPages} >>`);

  // 3: Font CJK
  addObj(
    3,
    `<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UTF16-H /DescendantFonts [4 0 R] >>`
  );

  // 4: CIDFont
  addObj(
    4,
    `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> >>`
  );

  // 5: Standard Helvetica font for numbering
  addObj(5, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);

  // Generate Page and Content Objects
  for (let p = 0; p < totalPages; p++) {
    const pageId = pageObjIds[p]!;
    const contentId = contentObjIds[p]!;
    const pageLines = pages[p]!;

    let stream = "BT\n/F1 11 Tf\n50 780 Td\n18 TL\n";
    for (let l = 0; l < pageLines.length; l++) {
      const lineText = pageLines[l]!;
      const hex = utf16Hex(lineText);
      stream += `<${hex}> Tj\nT*\n`;
    }
    // Page footer numbering
    stream += `ET\nBT\n/F2 9 Tf\n280 30 Td\n(Page ${p + 1} / ${totalPages}) Tj\nET\n`;

    const streamLen = Buffer.byteLength(stream);

    addObj(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 3 0 R /F2 5 0 R >> >> /Contents ${contentId} 0 R >>`
    );

    addObj(contentId, `<< /Length ${streamLen} >>\nstream\n${stream}endstream`);
  }

  const xrefOffset = Buffer.byteLength(pdfStr);
  const totalObjs = nextObjId;

  pdfStr += `xref\n0 ${totalObjs}\n0000000000 65535 f \n`;
  for (let i = 1; i < totalObjs; i++) {
    const off = offsets[i] || 0;
    pdfStr += `${off.toString().padStart(10, "0")} 00000 n \n`;
  }

  pdfStr += `trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdfStr, "binary");
}
