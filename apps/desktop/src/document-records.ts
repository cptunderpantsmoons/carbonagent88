import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CarbonDatabase } from "@carbon-agent/local-store";

export type GeneratedDocumentFormat = "markdown" | "docx" | "pdf";

export interface GeneratedDocumentRecordInput {
  workspaceId: string;
  title: string;
  content: string;
  filePath: string;
  format: GeneratedDocumentFormat;
}

function mimeTypeForFormat(format: GeneratedDocumentFormat): string | null {
  if (format === "markdown") return "text/markdown";
  if (format === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (format === "pdf") return "application/pdf";
  return null;
}

export async function recordGeneratedDocument(db: CarbonDatabase, input: GeneratedDocumentRecordInput): Promise<void> {
  let sizeBytes: number | undefined;
  try {
    sizeBytes = fs.statSync(input.filePath).size;
  } catch {
    sizeBytes = undefined;
  }

  const dataSourceId = crypto.randomUUID();
  await db.createDataSource({
    id: dataSourceId,
    workspaceId: input.workspaceId,
    type: "file",
    name: path.basename(input.filePath),
    path: input.filePath,
    mimeType: mimeTypeForFormat(input.format) ?? undefined,
    sizeBytes,
  });

  await db.createDocument({
    id: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    dataSourceId,
    title: input.title,
    content: input.content,
  });
}
