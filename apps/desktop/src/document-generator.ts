/**
 * Document Generator — Production-grade DOCX and PDF generation
 *
 * Gate 1 Remediation:
 * - Uses `docx` npm package for real ZIP-based OOXML generation
 * - Uses `pdf-lib` npm package for real PDF binary generation
 */

import fs from "node:fs";
import path from "node:path";
import {
  Document, Paragraph, TextRun, HeadingLevel, Packer,
} from "docx";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { getDocumentsDir } from "@carbon-agent/local-store";

export type DocumentFormat = "markdown" | "docx" | "pdf";

export interface GenerateDocumentInput {
  workspaceId: string;
  title: string;
  content: string;
  format: DocumentFormat;
}

export interface GenerateDocumentResult {
  filePath: string;
  finalContent: string;
}

/**
 * Generate a real DOCX file using the `docx` library.
 */
export async function generateRealDocx(filePath: string, title: string, content: string): Promise<void> {
  const paragraphs = content.split("\n\n").map((p) => {
    const trimmed = p.trim();
    if (trimmed.startsWith("# ")) {
      return new Paragraph({
        text: trimmed.slice(2),
        heading: HeadingLevel.HEADING_1,
      });
    }
    if (trimmed.startsWith("## ")) {
      return new Paragraph({
        text: trimmed.slice(3),
        heading: HeadingLevel.HEADING_2,
      });
    }
    if (trimmed.startsWith("### ")) {
      return new Paragraph({
        text: trimmed.slice(4),
        heading: HeadingLevel.HEADING_3,
      });
    }
    return new Paragraph({
      children: [
        new TextRun({ text: trimmed, break: 0 }),
      ],
    });
  });

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: title,
            heading: HeadingLevel.TITLE,
          }),
          ...paragraphs,
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(filePath, buffer);
}

/**
 * Generate a real PDF file using `pdf-lib`.
 */
export async function generateRealPdf(filePath: string, title: string, content: string): Promise<void> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 50;
  const maxWidth = pageWidth - margin * 2;
  const lineHeight = 14;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  // Title
  const titleSize = 18;
  page.drawText(title, {
    x: margin,
    y: y - titleSize,
    size: titleSize,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  y -= titleSize + lineHeight * 2;

  const textSize = 11;
  const paragraphs = content.split("\n\n");

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // Check for heading
    let fontToUse = font;
    let sizeToUse = textSize;
    let text = trimmed;

    if (trimmed.startsWith("# ")) {
      fontToUse = boldFont;
      sizeToUse = 16;
      text = trimmed.slice(2);
    } else if (trimmed.startsWith("## ")) {
      fontToUse = boldFont;
      sizeToUse = 14;
      text = trimmed.slice(3);
    } else if (trimmed.startsWith("### ")) {
      fontToUse = boldFont;
      sizeToUse = 12;
      text = trimmed.slice(4);
    }

    // Word-wrap
    const words = text.split(/\s+/);
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const width = fontToUse.widthOfTextAtSize(testLine, sizeToUse);
      if (width > maxWidth && currentLine) {
        // Flush current line
        if (y < margin + lineHeight) {
          page = pdfDoc.addPage([pageWidth, pageHeight]);
          y = pageHeight - margin;
        }
        page.drawText(currentLine, {
          x: margin,
          y: y - sizeToUse,
          size: sizeToUse,
          font: fontToUse,
          color: rgb(0, 0, 0),
        });
        y -= sizeToUse + 4;
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    // Flush remaining
    if (currentLine) {
      if (y < margin + lineHeight) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
      page.drawText(currentLine, {
        x: margin,
        y: y - sizeToUse,
        size: sizeToUse,
        font: fontToUse,
        color: rgb(0, 0, 0),
      });
      y -= sizeToUse + 4;
    }

    y -= lineHeight; // Paragraph spacing
  }

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(filePath, Buffer.from(pdfBytes));
}

/**
 * Generate a document in the requested format.
 */
export async function generateDocument(input: GenerateDocumentInput): Promise<GenerateDocumentResult> {
  const docsDir = getDocumentsDir();
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

  const safeTitle = input.title.replace(/[^a-zA-Z0-9]/g, "_");
  let filePath: string;
  let finalContent = input.content;

  if (input.format === "markdown") {
    filePath = path.join(docsDir, `${safeTitle}.md`);
    fs.writeFileSync(filePath, `# ${input.title}\n\n${input.content}`);
  } else if (input.format === "docx") {
    filePath = path.join(docsDir, `${safeTitle}.docx`);
    await generateRealDocx(filePath, input.title, input.content);
    finalContent = `[DOCX generated: ${filePath}]`;
  } else if (input.format === "pdf") {
    filePath = path.join(docsDir, `${safeTitle}.pdf`);
    await generateRealPdf(filePath, input.title, input.content);
    finalContent = `[PDF generated: ${filePath}]`;
  } else {
    // Fallback to markdown for unknown formats
    filePath = path.join(docsDir, `${safeTitle}.md`);
    fs.writeFileSync(filePath, `# ${input.title}\n\n${input.content}`);
  }

  return { filePath, finalContent };
}
