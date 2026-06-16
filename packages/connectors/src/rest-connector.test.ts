import { describe, it, expect, vi } from "vitest";
import { RestConnector } from "./rest-connector.js";

describe("RestConnector", () => {
  it("fetches items from a JSON response with default GET", async () => {
    const connector = new RestConnector();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          items: [
            { id: "1", title: "First", body: "Body one", created_at: "2025-01-01T00:00:00Z" },
            { id: "2", name: "Second", content: "Body two" },
          ],
        },
      }),
    } as unknown as Response);

    const result = await connector.fetch(
      {
        id: "conn-rest-1",
        name: "test",
        workspaceId: "ws-1",
        type: "rest",
        enabled: true,
        options: {
          url: "https://example.com/api/items",
          itemsPath: "data.items",
          pagination: "none",
        },
      },
      {},
    );

    expect(global.fetch).toHaveBeenCalledWith(
      "https://example.com/api/items",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.title).toBe("First");
    expect(result.items[1]?.body).toBe("Body two");
    expect(result.hasMore).toBe(false);
  });

  it("paginates with a cursor path", async () => {
    const connector = new RestConnector();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{ id: "x", title: "X" }],
        nextCursor: "cursor-2",
      }),
    } as unknown as Response);

    const result = await connector.fetch(
      {
        id: "conn-rest-2",
        name: "test",
        workspaceId: "ws-1",
        type: "rest",
        enabled: true,
        options: {
          url: "https://example.com/api/items",
          itemsPath: "items",
          pagination: "cursor",
          cursorPath: "nextCursor",
        },
      },
      {},
    );

    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(true);
    expect(result.nextState?.cursor).toBe("cursor-2");
  });

  it("throws on non-ok fetch responses", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Server Error",
    } as unknown as Response);

    const connector = new RestConnector();
    await expect(
      connector.fetch(
        {
          id: "conn-rest-3",
          name: "test",
          workspaceId: "ws-1",
          type: "rest",
          enabled: true,
          options: { url: "https://example.com/broken", pagination: "none" },
        },
        {},
      ),
    ).rejects.toThrow("500");
  });
});
