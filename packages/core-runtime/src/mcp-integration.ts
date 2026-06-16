/**
 * MCP (Model Context Protocol) Integration
 *
 * Control Corridor:
 * - Owns: MCP server connections, tool discovery, resource management
 * - Must NOT own: LLM provider instantiation, workspace internals
 *
 * Provides integration with MCP-compatible tool servers for extending
 * the agent's capabilities with external tools and resources.
 */

import { EventEmitter } from "node:events";
import type { EnterpriseTool, ToolExecutionResult, MCPServerConfig, MCPTool } from "./enterprise-harness.js";

// ---------------------------------------------------------------------------
// MCP Types
// ---------------------------------------------------------------------------

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface MCPServerState {
  id: string;
  config: MCPServerConfig;
  status: "disconnected" | "connecting" | "connected" | "error";
  tools: MCPTool[];
  resources: MCPResource[];
  prompts: MCPPrompt[];
  error?: string;
  lastConnected?: string;
}

// ---------------------------------------------------------------------------
// MCP Client
// ---------------------------------------------------------------------------

export class MCPClient extends EventEmitter {
  private servers: Map<string, MCPServerState> = new Map();
  private connections: Map<string, MCPServerConnection> = new Map();

  async connectServer(config: MCPServerConfig): Promise<void> {
    const state: MCPServerState = {
      id: config.id,
      config,
      status: "connecting",
      tools: [],
      resources: [],
      prompts: [],
    };

    this.servers.set(config.id, state);
    this.emit("server_connecting", { serverId: config.id });

    try {
      const connection = await this.createConnection(config);
      this.connections.set(config.id, connection);

      // Discover capabilities
      const tools = await connection.listTools();
      const resources = await connection.listResources();
      const prompts = await connection.listPrompts();

      state.status = "connected";
      state.tools = tools;
      state.resources = resources;
      state.prompts = prompts;
      state.lastConnected = new Date().toISOString();

      this.emit("server_connected", { serverId: config.id, tools, resources, prompts });
    } catch (err) {
      state.status = "error";
      state.error = err instanceof Error ? err.message : String(err);
      this.emit("server_error", { serverId: config.id, error: state.error });
    }
  }

  async disconnectServer(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId);
    if (connection) {
      await connection.close();
      this.connections.delete(serverId);
    }

    const state = this.servers.get(serverId);
    if (state) {
      state.status = "disconnected";
      this.emit("server_disconnected", { serverId });
    }
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const connection = this.connections.get(serverId);
    if (!connection) {
      throw new Error(`Server ${serverId} not connected`);
    }

    return connection.callTool(toolName, args);
  }

  async readResource(serverId: string, uri: string): Promise<unknown> {
    const connection = this.connections.get(serverId);
    if (!connection) {
      throw new Error(`Server ${serverId} not connected`);
    }

    return connection.readResource(uri);
  }

  async getPrompt(serverId: string, promptName: string, args?: Record<string, string>): Promise<unknown> {
    const connection = this.connections.get(serverId);
    if (!connection) {
      throw new Error(`Server ${serverId} not connected`);
    }

    return connection.getPrompt(promptName, args);
  }

  getServer(serverId: string): MCPServerState | undefined {
    return this.servers.get(serverId);
  }

  getAllServers(): MCPServerState[] {
    return Array.from(this.servers.values());
  }

  getConnectedServers(): MCPServerState[] {
    return Array.from(this.servers.values()).filter((s) => s.status === "connected");
  }

  getAllTools(): Array<MCPTool & { serverId: string }> {
    const tools: Array<MCPTool & { serverId: string }> = [];

    for (const server of this.getConnectedServers()) {
      for (const tool of server.tools) {
        tools.push({ ...tool, serverId: server.id });
      }
    }

    return tools;
  }

  getAllResources(): Array<MCPResource & { serverId: string }> {
    const resources: Array<MCPResource & { serverId: string }> = [];

    for (const server of this.getConnectedServers()) {
      for (const resource of server.resources) {
        resources.push({ ...resource, serverId: server.id });
      }
    }

    return resources;
  }

  private async createConnection(config: MCPServerConfig): Promise<MCPServerConnection> {
    // In production, this would create actual MCP connections
    // For now, return a mock connection
    return new MockMCPConnection(config);
  }
}

// ---------------------------------------------------------------------------
// MCP Server Connection Interface
// ---------------------------------------------------------------------------

interface MCPServerConnection {
  listTools(): Promise<MCPTool[]>;
  listResources(): Promise<MCPResource[]>;
  listPrompts(): Promise<MCPPrompt[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  readResource(uri: string): Promise<unknown>;
  getPrompt(name: string, args?: Record<string, string>): Promise<unknown>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Mock MCP Connection (for development/testing)
// ---------------------------------------------------------------------------

class MockMCPConnection implements MCPServerConnection {
  constructor(_config: MCPServerConfig) {
    // Config stored for future use
  }

  async listTools(): Promise<MCPTool[]> {
    // Return empty for now - real implementation would query the server
    return [];
  }

  async listResources(): Promise<MCPResource[]> {
    return [];
  }

  async listPrompts(): Promise<MCPPrompt[]> {
    return [];
  }

  async callTool(_name: string, _args: Record<string, unknown>): Promise<unknown> {
    return { error: "Mock connection - not implemented" };
  }

  async readResource(_uri: string): Promise<unknown> {
    return { error: "Mock connection - not implemented" };
  }

  async getPrompt(_name: string, _args?: Record<string, string>): Promise<unknown> {
    return { error: "Mock connection - not implemented" };
  }

  async close(): Promise<void> {
    // Cleanup
  }
}

// ---------------------------------------------------------------------------
// MCP Tool Adapter
// ---------------------------------------------------------------------------

export class MCPToolAdapter {
  private client: MCPClient;

  constructor(client: MCPClient) {
    this.client = client;
  }

  /**
   * Convert MCP tools to Enterprise tools for harness integration
   */
  toEnterpriseTools(): EnterpriseTool[] {
    const tools: EnterpriseTool[] = [];

    for (const mcpTool of this.client.getAllTools()) {
      tools.push({
        name: `mcp_${mcpTool.serverId}_${mcpTool.name}`,
        description: mcpTool.description,
        category: "mcp",
        inputSchema: mcpTool.inputSchema,
        timeout: 30000,
        permissions: ["mcp"],
      });
    }

    return tools;
  }

  /**
   * Create an executor that routes MCP tool calls through the client
   */
  createExecutor(): (tool: EnterpriseTool, input: Record<string, unknown>) => Promise<ToolExecutionResult> {
    return async (tool, input) => {
      if (!tool.name.startsWith("mcp_")) {
        return { success: false, output: null, error: "Not an MCP tool" };
      }

      const parts = tool.name.split("_");
      const serverId = parts[1];
      const toolName = parts.slice(2).join("_");

      if (!serverId || !toolName) {
        return { success: false, output: null, error: "Invalid MCP tool name format" };
      }

      try {
        const result = await this.client.callTool(serverId, toolName, input);
        return { success: true, output: result };
      } catch (err) {
        return {
          success: false,
          output: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    };
  }
}

// ---------------------------------------------------------------------------
// MCP Discovery Service
// ---------------------------------------------------------------------------

export interface MCPDiscoveryConfig {
  maxServers?: number;
  timeout?: number;
  knownServers?: MCPServerConfig[];
}

export class MCPDiscoveryService {
  private config: Required<MCPDiscoveryConfig>;
  private client: MCPClient;
  private discoveredServers: Map<string, MCPServerConfig> = new Map();

  constructor(client: MCPClient, config: MCPDiscoveryConfig = {}) {
    this.client = client;
    this.config = {
      maxServers: 10,
      timeout: 5000,
      knownServers: [],
      ...config,
    };

    // Register known servers
    for (const server of this.config.knownServers) {
      this.discoveredServers.set(server.id, server);
    }
  }

  async discoverServers(): Promise<MCPServerConfig[]> {
    const servers: MCPServerConfig[] = [];

    // Connect to known servers
    for (const [id, config] of this.discoveredServers) {
      if (!this.client.getServer(id)) {
        try {
          await this.client.connectServer(config);
          servers.push(config);
        } catch {
          // Server not available
        }
      }
    }

    return servers;
  }

  addServer(config: MCPServerConfig): void {
    this.discoveredServers.set(config.id, config);
  }

  removeServer(id: string): boolean {
    return this.discoveredServers.delete(id);
  }

  getDiscoveredServers(): MCPServerConfig[] {
    return Array.from(this.discoveredServers.values());
  }
}
