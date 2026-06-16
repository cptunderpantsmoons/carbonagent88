/**
 * Directory connector — dependency-free filesystem scan.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  ConnectorAdapter,
  ConnectorConfig,
  ConnectorFetchResult,
  ConnectorItem,
  ConnectorRunState,
  ConnectorType,
  TypedConnectorConfig,
} from "./types.js";

export interface DirectoryConnectorOptions extends Record<string, unknown> {
  /** Absolute base directory to scan. */
  basePath: string;
  /** Recurse into subdirectories. */
  recursive?: boolean;
  /** Glob-like inclusion suffixes, e.g. [".txt", ".md"]. Empty = include all. */
  extensions?: string[];
  /** Maximum items per fetch. */
  batchSize?: number;
}

export interface DirectoryConnectorConfig extends TypedConnectorConfig<DirectoryConnectorOptions> {
  type: "directory";
}

interface DirectoryCursor {
  stack: string[];
  emittedCount: number;
  [key: string]: unknown;
}

function isTextFile(filePath: string): boolean {
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.includes(0)) return false;
    return true;
  } catch {
    return false;
  }
}

function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 24);
}

export class DirectoryConnector implements ConnectorAdapter {
  readonly type: ConnectorType = "directory";

  async fetch(
    config: ConnectorConfig,
    state: ConnectorRunState,
  ): Promise<ConnectorFetchResult> {
    const opts = (config.options ?? { basePath: "" }) as DirectoryConnectorOptions;
    const basePath = opts.basePath;
    if (!basePath || !fs.existsSync(basePath)) {
      throw new Error(`Directory connector base path is missing or invalid: ${basePath}`);
    }

    const batchSize = opts.batchSize ?? 50;
    const recursive = opts.recursive !== false;
    const extensions = opts.extensions?.filter(Boolean).map((e) => e.toLowerCase());

    const cursor: DirectoryCursor = (state.payload as DirectoryCursor | undefined) ?? {
      stack: [basePath],
      emittedCount: 0,
    };

    const items: ConnectorItem[] = [];
    let hasMore = false;

    while (cursor.stack.length > 0 && items.length < batchSize) {
      const current = cursor.stack.pop()!;
      const stat = fs.statSync(current, { throwIfNoEntry: false });
      if (!stat) continue;

      if (stat.isDirectory()) {
        if (!recursive && current !== basePath) continue;
        for (const entry of fs.readdirSync(current)) {
          cursor.stack.push(path.join(current, entry));
        }
        continue;
      }

      if (!stat.isFile()) continue;

      const ext = path.extname(current).toLowerCase();
      if (extensions && extensions.length > 0 && !extensions.includes(ext)) {
        continue;
      }

      const relativePath = path.relative(basePath, current);
      const fileName = path.basename(current);
      let body = "";
      if (isTextFile(current)) {
        body = fs.readFileSync(current, "utf8");
      } else {
        body = `[Binary file: ${fileName}, ${stat.size} bytes]`;
      }

      const raw: Record<string, unknown> = {
        fileName,
        relativePath,
        sizeBytes: stat.size,
        extension: ext,
      };

      items.push({
        id: contentHash(`${relativePath}:${stat.mtime.toISOString()}:${stat.size}`),
        sourceType: "directory_file",
        title: relativePath,
        body,
        timestamp: stat.mtime.toISOString(),
        url: `file://${current}`,
        raw,
        contentHash: contentHash(body),
      });

      cursor.emittedCount += 1;
    }

    if (cursor.stack.length > 0) {
      hasMore = true;
    }

    return {
      items,
      nextState: {
        ...state,
        lastItemId: items.length > 0 ? items[items.length - 1]!.id : state.lastItemId,
        payload: hasMore ? (cursor as unknown as Record<string, unknown>) : undefined,
      },
      hasMore,
    };
  }
}
