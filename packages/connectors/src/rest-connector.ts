/**
 * Generic REST connector using `fetch`.
 */

import type {
  ConnectorAdapter,
  ConnectorConfig,
  ConnectorFetchResult,
  ConnectorItem,
  ConnectorRunState,
  ConnectorType,
  TypedConnectorConfig,
} from "./types.js";

export interface RestConnectorOptions extends Record<string, unknown> {
  /** Full base URL for the endpoint. */
  url: string;
  /** HTTP method. */
  method?: "GET" | "POST";
  /** Static headers merged per request. */
  headers?: Record<string, string>;
  /** JSONPath-like dot path to item array (e.g. "data.items"). */
  itemsPath?: string;
  /** Pagination strategy: "offset", "cursor", or "none". */
  pagination?: "offset" | "cursor" | "none";
  /** Dot path to next cursor in response. */
  cursorPath?: string;
  /** Initial cursor value. */
  initialCursor?: string;
  /** Dot path to page number. */
  pagePath?: string;
  /** Dot path to item total. */
  totalPath?: string;
  /** Items per page. */
  pageSize?: number;
  /** Body template for POST; use {{cursor}} / {{offset}} / {{page}}. */
  bodyTemplate?: Record<string, unknown>;
  /** Field name to inject bearer token from credentials decrypted value. */
  bearerTokenField?: string;
  /** Authentication type. */
  authType?: "none" | "bearer" | "basic" | "query";
  /** Query param name when authType="query". */
  authQueryParam?: string;
  credential?: string | null;
}

export interface RestConnectorConfig extends TypedConnectorConfig<RestConnectorOptions> {
  type: "rest";
}

const ITEM_ID_SEED = 0;

function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function inferTitle(item: Record<string, unknown>): string {
  for (const key of ["title", "name", "subject", "summary", "id"]) {
    const value = item[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "Untitled";
}

function parseTimestamp(input: unknown): string {
  if (typeof input === "string" || typeof input === "number") {
    const d = new Date(input);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function renderValue(value: unknown, vars: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    return value
      .replace(/\{\{cursor\}\}/g, String(vars.cursor ?? ""))
      .replace(/\{\{offset\}\}/g, String(vars.offset ?? 0))
      .replace(/\{\{page\}\}/g, String(vars.page ?? 1));
  }
  if (Array.isArray(value)) return value.map((v) => renderValue(v, vars));
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = renderValue(v, vars);
    }
    return result;
  }
  return value;
}

function renderBody(
  template: Record<string, unknown>,
  vars: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(template)) {
    result[k] = renderValue(v, vars);
  }
  return result;
}

export class RestConnector implements ConnectorAdapter {
  readonly type: ConnectorType = "rest";

  async fetch(
    config: ConnectorConfig,
    state: ConnectorRunState,
    signal?: AbortSignal,
  ): Promise<ConnectorFetchResult> {
    const opts = (config.options ?? { url: "" }) as RestConnectorOptions;
    const url = new URL(opts.url);
    const method = opts.method ?? "GET";
    const pageSize = opts.pageSize ?? 20;
    const pagination = opts.pagination ?? "none";

    let page = state.page ?? 1;
    if (pagination === "offset") {
      page = typeof state.payload?.offset === "number" ? state.payload.offset : 0;
    }
    const cursor = (state.cursor as string | undefined) ?? opts.initialCursor ?? null;

    // Build headers
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    };

    // Auth — only use opts.credential (which should be decrypted by the caller).
    // Do NOT fall back to config.credentialsEncrypted (which is the raw encrypted blob).
    const credential = opts.credential ?? null;
    if (opts.authType === "bearer" && credential) {
      headers["Authorization"] = `Bearer ${credential}`;
    } else if (opts.authType === "basic" && credential) {
      headers["Authorization"] = `Basic ${Buffer.from(credential).toString("base64")}`;
    } else if (opts.authType === "query" && credential && opts.authQueryParam) {
      url.searchParams.set(opts.authQueryParam, credential);
    }

    const vars: Record<string, unknown> = {
      cursor: cursor ?? "",
      offset: page,
      page: typeof page === "number" ? page + 1 : 1,
      pageSize,
    };

    let body: string | undefined;
    if (method === "POST" && opts.bodyTemplate) {
      body = JSON.stringify(renderBody(opts.bodyTemplate, vars));
    }

    if (pagination === "offset") {
      url.searchParams.set("offset", String(vars.offset));
      url.searchParams.set("limit", String(pageSize));
    } else if (pagination === "cursor" && cursor) {
      url.searchParams.set("cursor", cursor);
      url.searchParams.set("limit", String(pageSize));
    } else if (pagination === "none") {
      /* no-op */
    }

    const response = await fetch(url.toString(), {
      method,
      headers,
      body,
      signal,
    });

    if (!response.ok) {
      throw new Error(`REST connector fetch failed: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as unknown;
    const itemsPath = opts.itemsPath ?? "";
    const rawItems = itemsPath ? getByPath(json, itemsPath) : json;
    const array = Array.isArray(rawItems) ? rawItems : [];

    const timestampPath = "created_at";
    const bodyPaths = ["body", "content", "description", "text", "snippet"];
    const idPaths = ["id", "uuid", "_id", "identifier"];

    let idCounter = ITEM_ID_SEED;
    const items: ConnectorItem[] = array.map((raw) => {
      const item = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
      let id = "";
      for (const key of idPaths) {
        const candidate = item[key];
        if (candidate !== undefined && candidate !== null) {
          id = String(candidate);
          break;
        }
      }
      if (!id) {
        id = `rest-${Date.now()}-${idCounter++}`;
      }

      let body = "";
      for (const key of bodyPaths) {
        const candidate = item[key];
        if (typeof candidate === "string" && candidate.length > 0) {
          body = candidate;
          break;
        }
      }
      if (!body) {
        body = JSON.stringify(item).slice(0, 2000);
      }

      const title = inferTitle(item);
      const timestamp = parseTimestamp(item[timestampPath] ?? item["updated_at"] ?? item["date"] ?? null);

      return {
        id,
        sourceType: "rest_item",
        title,
        body,
        timestamp,
        raw: item,
        url: typeof item.url === "string" ? item.url : typeof item.link === "string" ? item.link : null,
      };
    });

    // Determine next cursor / offset / page
    const nextState: ConnectorRunState = { ...state };
    let hasMore = false;

    if (pagination === "cursor") {
      const nextCursor = opts.cursorPath ? getByPath(json, opts.cursorPath) : undefined;
      if (nextCursor !== undefined && nextCursor !== null && nextCursor !== "") {
        nextState.cursor = String(nextCursor);
        hasMore = true;
      }
    } else if (pagination === "offset") {
      const total = opts.totalPath ? Number(getByPath(json, opts.totalPath) ?? 0) : undefined;
      const nextOffset = (typeof page === "number" ? page : 0) + items.length;
      nextState.page = nextOffset;
      if (nextState.payload === null || nextState.payload === undefined) {
        nextState.payload = {};
      }
      nextState.payload.offset = nextOffset;
      if (total === undefined || nextOffset < total) {
        hasMore = items.length > 0 && (total === undefined || nextOffset < total);
      }
    } else if (pagination === "none") {
      hasMore = false;
    }

    nextState.lastItemId = items.length > 0 ? items[items.length - 1]!.id : state.lastItemId;

    return { items, nextState, hasMore };
  }
}
