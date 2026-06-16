/**
 * Parallel Execution Engine
 *
 * Control Corridor:
 * - Owns: Concurrent agent execution, resource pooling, load balancing
 * - Must NOT own: LLM provider instantiation, workspace internals
 *
 * Enterprise-grade parallel execution with:
 * - Dynamic worker pool management
 * - Resource-aware scheduling
 * - Deadlock detection and prevention
 * - Progress aggregation
 * - Timeout management per task
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { AgentTask, AgentTaskResult, AgentRole } from "./enterprise-harness.js";

// ---------------------------------------------------------------------------
// Worker Pool
// ---------------------------------------------------------------------------

export interface WorkerConfig {
  id: string;
  maxConcurrent: number;
  roles: AgentRole[];
  priority: number;
}

export interface WorkerState {
  id: string;
  config: WorkerConfig;
  currentTasks: Set<string>;
  completedTasks: number;
  failedTasks: number;
  totalDuration: number;
}

// ---------------------------------------------------------------------------
// Execution Queue
// ---------------------------------------------------------------------------

export interface QueuedTask {
  id: string;
  task: AgentTask;
  enqueuedAt: string;
  startedAt?: string;
  workerId?: string;
  status: "queued" | "assigned" | "running" | "completed" | "failed";
}

// ---------------------------------------------------------------------------
// Parallel Execution Engine
// ---------------------------------------------------------------------------

export interface ParallelExecutionConfig {
  maxWorkers: number;
  maxConcurrent: number;
  taskTimeout: number;
  enableLoadBalancing: boolean;
  enableDeadlockDetection: boolean;
}

export interface ExecutionMetrics {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageDuration: number;
  maxDuration: number;
  minDuration: number;
  throughput: number;
  activeWorkers: number;
  queuedTasks: number;
}

export class ParallelExecutionEngine extends EventEmitter {
  private config: ParallelExecutionConfig;
  private workers: Map<string, WorkerState> = new Map();
  private queue: QueuedTask[] = [];
  private running: Map<string, QueuedTask> = new Map();
  private completed: Map<string, AgentTaskResult> = new Map();
  private taskHandlers: Map<AgentRole, TaskHandler> = new Map();
  private executionTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(config: ParallelExecutionConfig) {
    super();
    this.config = config;
    this.initializeWorkers();
  }

  // ---------------------------------------------------------------------------
  // Worker Management
  // ---------------------------------------------------------------------------

  private initializeWorkers(): void {
    for (let i = 0; i < this.config.maxWorkers; i++) {
      const workerId = `worker-${i}`;
      this.workers.set(workerId, {
        id: workerId,
        config: {
          id: workerId,
          maxConcurrent: Math.ceil(this.config.maxConcurrent / this.config.maxWorkers),
          roles: [],
          priority: 0,
        },
        currentTasks: new Set(),
        completedTasks: 0,
        failedTasks: 0,
        totalDuration: 0,
      });
    }
  }

  addWorker(config: WorkerConfig): void {
    this.workers.set(config.id, {
      id: config.id,
      config,
      currentTasks: new Set(),
      completedTasks: 0,
      failedTasks: 0,
      totalDuration: 0,
    });
    this.emit("worker_added", { workerId: config.id });
  }

  removeWorker(workerId: string): boolean {
    const worker = this.workers.get(workerId);
    if (!worker) return false;

    if (worker.currentTasks.size > 0) {
      // Can't remove busy worker
      return false;
    }

    this.workers.delete(workerId);
    this.emit("worker_removed", { workerId });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Task Handler Registration
  // ---------------------------------------------------------------------------

  registerTaskHandler(role: AgentRole, handler: TaskHandler): void {
    this.taskHandlers.set(role, handler);
  }

  // ---------------------------------------------------------------------------
  // Task Submission
  // ---------------------------------------------------------------------------

  async submitTask(task: AgentTask): Promise<string> {
    const taskId = task.id || randomUUID();
    const queuedTask: QueuedTask = {
      id: taskId,
      task: { ...task, id: taskId },
      enqueuedAt: new Date().toISOString(),
      status: "queued",
    };

    this.queue.push(queuedTask);
    this.emit("task_enqueued", { taskId, role: task.role });

    // Try to schedule immediately
    await this.scheduleTasks();

    return taskId;
  }

  async submitTasks(tasks: AgentTask[]): Promise<string[]> {
    const taskIds: string[] = [];

    for (const task of tasks) {
      const id = await this.submitTask(task);
      taskIds.push(id);
    }

    return taskIds;
  }

  // ---------------------------------------------------------------------------
  // Scheduling
  // ---------------------------------------------------------------------------

  private async scheduleTasks(): Promise<void> {
    // Sort queue by priority (descending)
    this.queue.sort((a, b) => b.task.priority - a.task.priority);

    for (const queuedTask of [...this.queue]) {
      if (this.running.size >= this.config.maxConcurrent) {
        break;
      }

      const worker = this.findAvailableWorker(queuedTask.task.role);
      if (!worker) {
        continue;
      }

      // Check dependencies
      if (queuedTask.task.dependencies?.length) {
        const allDepsMet = queuedTask.task.dependencies.every((depId) => {
          const depResult = this.completed.get(depId);
          return depResult?.success;
        });

        if (!allDepsMet) {
          continue;
        }
      }

      // Assign to worker
      this.assignTask(queuedTask, worker);
    }
  }

  private findAvailableWorker(role: AgentRole): WorkerState | undefined {
    let bestWorker: WorkerState | undefined;
    let bestScore = -1;

    for (const worker of this.workers.values()) {
      if (worker.currentTasks.size >= worker.config.maxConcurrent) {
        continue;
      }

      // Score based on load and role match
      let score = 100 - (worker.currentTasks.size / worker.config.maxConcurrent) * 100;

      if (worker.config.roles.length === 0 || worker.config.roles.includes(role)) {
        score += 50;
      }

      if (worker.config.priority > bestScore) {
        score += worker.config.priority;
      }

      if (score > bestScore) {
        bestScore = score;
        bestWorker = worker;
      }
    }

    return bestWorker;
  }

  private async assignTask(queuedTask: QueuedTask, worker: WorkerState): Promise<void> {
    // Remove from queue
    const queueIdx = this.queue.indexOf(queuedTask);
    if (queueIdx >= 0) {
      this.queue.splice(queueIdx, 1);
    }

    // Update state
    queuedTask.status = "assigned";
    queuedTask.workerId = worker.id;
    queuedTask.startedAt = new Date().toISOString();
    worker.currentTasks.add(queuedTask.id);
    this.running.set(queuedTask.id, queuedTask);

    this.emit("task_assigned", { taskId: queuedTask.id, workerId: worker.id });

    // Execute with timeout
    this.executeWithTimeout(queuedTask, worker);
  }

  private async executeWithTimeout(queuedTask: QueuedTask, worker: WorkerState): Promise<void> {
    const timeout = queuedTask.task.timeout || this.config.taskTimeout;

    const timer = setTimeout(() => {
      this.handleTaskTimeout(queuedTask.id);
    }, timeout);

    this.executionTimers.set(queuedTask.id, timer);

    try {
      const handler = this.taskHandlers.get(queuedTask.task.role);
      if (!handler) {
        throw new Error(`No handler registered for role: ${queuedTask.task.role}`);
      }

      queuedTask.status = "running";
      const result = await handler(queuedTask.task);

      // Clear timeout
      clearTimeout(timer);
      this.executionTimers.delete(queuedTask.id);

      // Update worker stats
      const duration = Date.now() - new Date(queuedTask.startedAt!).getTime();
      worker.completedTasks++;
      worker.totalDuration += duration;

      // Store result
      this.completed.set(queuedTask.id, {
        ...result,
        taskId: queuedTask.id,
        agentId: worker.id,
        duration,
      });

      this.completeTask(queuedTask, "completed");
    } catch (err) {
      // Clear timeout
      clearTimeout(timer);
      this.executionTimers.delete(queuedTask.id);

      // Update worker stats
      worker.failedTasks++;

      // Store error result
      this.completed.set(queuedTask.id, {
        taskId: queuedTask.id,
        agentId: worker.id,
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
        duration: 0,
      });

      this.completeTask(queuedTask, "failed");
    }
  }

  private handleTaskTimeout(taskId: string): void {
    const queuedTask = this.running.get(taskId);
    if (!queuedTask) return;

    // Update state
    this.completeTask(queuedTask, "failed");

    // Clean up
    this.executionTimers.delete(taskId);

    this.emit("task_timeout", { taskId });
  }

  private completeTask(queuedTask: QueuedTask, status: "completed" | "failed"): void {
    // Remove from running
    this.running.delete(queuedTask.id);

    // Update worker
    if (queuedTask.workerId) {
      const worker = this.workers.get(queuedTask.workerId);
      if (worker) {
        worker.currentTasks.delete(queuedTask.id);
      }
    }

    queuedTask.status = status;

    this.emit(`task_${status}`, {
      taskId: queuedTask.id,
      workerId: queuedTask.workerId,
    });

    // Schedule more tasks
    this.scheduleTasks();
  }

  // ---------------------------------------------------------------------------
  // Task Retrieval
  // ---------------------------------------------------------------------------

  getTaskResult(taskId: string): AgentTaskResult | undefined {
    return this.completed.get(taskId);
  }

  getTaskStatus(taskId: string): QueuedTask["status"] | undefined {
    const queued = this.queue.find((t) => t.id === taskId);
    if (queued) return queued.status;

    const running = this.running.get(taskId);
    if (running) return running.status;

    const completed = this.completed.get(taskId);
    if (completed) return completed.success ? "completed" : "failed";

    return undefined;
  }

  getAllResults(): AgentTaskResult[] {
    return Array.from(this.completed.values());
  }

  // ---------------------------------------------------------------------------
  // Metrics
  // ---------------------------------------------------------------------------

  getMetrics(): ExecutionMetrics {
    const results = Array.from(this.completed.values());
    const durations = results.map((r) => r.duration).filter((d) => d > 0);

    const totalTasks = results.length;
    const completedTasks = results.filter((r) => r.success).length;
    const failedTasks = results.filter((r) => !r.success).length;
    const averageDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;
    const minDuration = durations.length > 0 ? Math.min(...durations) : 0;

    // Throughput: tasks completed per second
    const now = Date.now();
    const oldestCompletion = results.length > 0
      ? Math.min(...results.map((r) => now - r.duration))
      : now;
    const timeWindow = (now - oldestCompletion) / 1000;
    const throughput = timeWindow > 0 ? completedTasks / timeWindow : 0;

    let activeWorkers = 0;
    for (const worker of this.workers.values()) {
      if (worker.currentTasks.size > 0) {
        activeWorkers++;
      }
    }

    return {
      totalTasks,
      completedTasks,
      failedTasks,
      averageDuration,
      maxDuration,
      minDuration,
      throughput,
      activeWorkers,
      queuedTasks: this.queue.length,
    };
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  async shutdown(): Promise<void> {
    // Clear all timers
    for (const timer of this.executionTimers.values()) {
      clearTimeout(timer);
    }
    this.executionTimers.clear();

    // Cancel running tasks
    for (const task of this.running.values()) {
      task.status = "failed";
    }
    this.running.clear();

    // Clear queue
    this.queue = [];

    this.emit("shutdown");
  }
}

// ---------------------------------------------------------------------------
// Task Handler Type
// ---------------------------------------------------------------------------

export type TaskHandler = (task: AgentTask) => Promise<AgentTaskResult>;

// ---------------------------------------------------------------------------
// Dependency Graph
// ---------------------------------------------------------------------------

export class DependencyGraph {
  private nodes: Map<string, Set<string>> = new Map();
  private reverseNodes: Map<string, Set<string>> = new Map();

  addNode(id: string): void {
    if (!this.nodes.has(id)) {
      this.nodes.set(id, new Set());
      this.reverseNodes.set(id, new Set());
    }
  }

  addEdge(from: string, to: string): void {
    this.addNode(from);
    this.addNode(to);
    this.nodes.get(from)!.add(to);
    this.reverseNodes.get(to)!.add(from);
  }

  removeNode(id: string): void {
    const deps = this.nodes.get(id);
    if (deps) {
      for (const dep of deps) {
        this.reverseNodes.get(dep)?.delete(id);
      }
    }

    const dependents = this.reverseNodes.get(id);
    if (dependents) {
      for (const dependent of dependents) {
        this.nodes.get(dependent)?.delete(id);
      }
    }

    this.nodes.delete(id);
    this.reverseNodes.delete(id);
  }

  getDependencies(id: string): string[] {
    return Array.from(this.nodes.get(id) ?? []);
  }

  getDependents(id: string): string[] {
    return Array.from(this.reverseNodes.get(id) ?? []);
  }

  hasCycle(): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (node: string): boolean => {
      visited.add(node);
      recursionStack.add(node);

      const deps = this.nodes.get(node) ?? new Set();
      for (const dep of deps) {
        if (!visited.has(dep)) {
          if (dfs(dep)) return true;
        } else if (recursionStack.has(dep)) {
          return true;
        }
      }

      recursionStack.delete(node);
      return false;
    };

    for (const node of this.nodes.keys()) {
      if (!visited.has(node)) {
        if (dfs(node)) return true;
      }
    }

    return false;
  }

  topologicalSort(): string[] {
    const visited = new Set<string>();
    const result: string[] = [];

    const dfs = (node: string): void => {
      visited.add(node);
      const deps = this.nodes.get(node) ?? new Set();
      for (const dep of deps) {
        if (!visited.has(dep)) {
          dfs(dep);
        }
      }
      result.unshift(node);
    };

    for (const node of this.nodes.keys()) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    return result;
  }
}

// ---------------------------------------------------------------------------
// Resource Pool
// ---------------------------------------------------------------------------

export interface Resource {
  id: string;
  type: string;
  available: boolean;
  owner?: string;
}

export class ResourcePool {
  private resources: Map<string, Resource> = new Map();
  private waitQueue: Array<{ resourceId: string; resolve: (resource: Resource) => void }> = [];

  addResource(resource: Resource): void {
    this.resources.set(resource.id, resource);
  }

  removeResource(id: string): boolean {
    return this.resources.delete(id);
  }

  async acquire(resourceId: string, owner: string, timeout = 30000): Promise<Resource | null> {
    const resource = this.resources.get(resourceId);
    if (!resource) return null;

    if (resource.available) {
      resource.available = false;
      resource.owner = owner;
      return resource;
    }

    // Wait for resource
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.waitQueue.findIndex((w) => w.resourceId === resourceId && w.resolve === resolve);
        if (idx >= 0) {
          this.waitQueue.splice(idx, 1);
        }
        resolve(null);
      }, timeout);

      this.waitQueue.push({
        resourceId,
        resolve: (r) => {
          clearTimeout(timer);
          r.owner = owner;
          resolve(r);
        },
      });
    });
  }

  release(resourceId: string, owner: string): boolean {
    const resource = this.resources.get(resourceId);
    if (!resource || resource.owner !== owner) return false;

    resource.available = true;
    resource.owner = undefined;

    // Check wait queue
    const waiting = this.waitQueue.find((w) => w.resourceId === resourceId);
    if (waiting) {
      this.waitQueue = this.waitQueue.filter((w) => w !== waiting);
      waiting.resolve(resource);
    }

    return true;
  }

  getStatus(): Array<Resource & { waiting: number }> {
    return Array.from(this.resources.values()).map((r) => ({
      ...r,
      waiting: this.waitQueue.filter((w) => w.resourceId === r.id).length,
    }));
  }
}
