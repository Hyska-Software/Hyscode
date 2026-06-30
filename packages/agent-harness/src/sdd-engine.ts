// ─── SDD Engine ─────────────────────────────────────────────────────────────
// Spec-Driven Development workflow: describe → spec → plan → execute → review.

import type {
  SddSession,
  SddTask,
  SddStatus,
  SddTaskStatus,
  HarnessEventHandler,
} from './types';

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

type RawPlanTask = {
  title: string;
  description: string;
  files: string[];
  dependencies: number[];
};

function parsePlanTasks(response: string): RawPlanTask[] {
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Plan response does not contain a JSON array.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('Plan response contains malformed JSON.');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Plan must be a non-empty JSON array.');
  }

  return parsed.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Plan task ${index} must be an object.`);
    }
    const task = value as Record<string, unknown>;
    if (typeof task.title !== 'string' || !task.title.trim()) {
      throw new Error(`Plan task ${index} requires a non-empty title.`);
    }
    if (typeof task.description !== 'string' || !task.description.trim()) {
      throw new Error(`Plan task ${index} requires a non-empty description.`);
    }
    if (!Array.isArray(task.files) || !task.files.every((file) => typeof file === 'string')) {
      throw new Error(`Plan task ${index} files must be an array of strings.`);
    }
    if (!Array.isArray(task.dependencies) || !task.dependencies.every(Number.isInteger)) {
      throw new Error(`Plan task ${index} dependencies must be an array of integer indices.`);
    }
    const dependencies = task.dependencies as number[];
    if (dependencies.some((dependency) => dependency < 0 || dependency >= parsed.length || dependency === index)) {
      throw new Error(`Plan task ${index} contains an invalid dependency index.`);
    }
    return {
      title: task.title,
      description: task.description,
      files: task.files as string[],
      dependencies,
    };
  });
}

// ─── Database Interface ─────────────────────────────────────────────────────
// Abstraction over SQLite calls via Tauri.

export interface SddDatabase {
  createSession(session: SddSession): Promise<void>;
  updateSession(id: string, updates: Partial<SddSession>): Promise<void>;
  getSession(id: string): Promise<SddSession | null>;
  listSessions(projectId: string): Promise<SddSession[]>;

  createTask(task: SddTask): Promise<void>;
  updateTask(id: string, updates: Partial<SddTask>): Promise<void>;
  getTasksForSession(sessionId: string): Promise<SddTask[]>;
}

// ─── Plan Manager ───────────────────────────────────────────────────────────
// Manages SDD task state and persistence.

export class PlanManager {
  private db: SddDatabase;

  constructor(db: SddDatabase) {
    this.db = db;
  }

  async createSession(projectId: string, conversationId: string, description: string): Promise<SddSession> {
    const session: SddSession = {
      id: generateId(),
      projectId,
      conversationId,
      description,
      spec: null,
      specApproved: false,
      tasks: [],
      status: 'describing',
      createdAt: now(),
      updatedAt: now(),
    };
    await this.db.createSession(session);
    return session;
  }

  async getSession(id: string): Promise<SddSession | null> {
    const session = await this.db.getSession(id);
    if (session) {
      session.tasks = await this.db.getTasksForSession(id);
    }
    return session;
  }

  async updateSpec(sessionId: string, spec: string): Promise<void> {
    await this.db.updateSession(sessionId, {
      spec,
      status: 'specifying',
      updatedAt: now(),
    });
  }

  async approveSpec(sessionId: string): Promise<void> {
    await this.db.updateSession(sessionId, {
      specApproved: true,
      status: 'planning',
      updatedAt: now(),
    });
  }

  async setTasks(sessionId: string, tasks: Array<{ title: string; description: string; files: string[]; dependencies: string[] }>): Promise<SddTask[]> {
    const sddTasks: SddTask[] = tasks.map((t, i) => ({
      id: generateId(),
      sessionId,
      ordinal: i + 1,
      title: t.title,
      description: t.description,
      files: t.files,
      dependencies: t.dependencies,
      status: 'pending' as SddTaskStatus,
      agentOutput: null,
      toolCalls: [],
      createdAt: now(),
      updatedAt: now(),
    }));

    for (const task of sddTasks) {
      await this.db.createTask(task);
    }

    await this.db.updateSession(sessionId, {
      status: 'planning',
      updatedAt: now(),
    });

    return sddTasks;
  }

  async approvePlan(sessionId: string): Promise<void> {
    await this.db.updateSession(sessionId, {
      status: 'executing',
      updatedAt: now(),
    });
  }

  async updateTaskStatus(taskId: string, status: SddTaskStatus, agentOutput?: string): Promise<void> {
    await this.db.updateTask(taskId, {
      status,
      agentOutput: agentOutput ?? undefined,
      updatedAt: now(),
    });
  }

  async updateTask(taskId: string, updates: Partial<SddTask>): Promise<void> {
    await this.db.updateTask(taskId, { ...updates, updatedAt: now() });
  }

  /** Persist resolved dependencies for a task */
  async updateTaskDependencies(taskId: string, dependencies: string[]): Promise<void> {
    await this.db.updateTask(taskId, {
      dependencies,
      updatedAt: now(),
    });
  }

  async completeSession(sessionId: string): Promise<void> {
    await this.db.updateSession(sessionId, {
      status: 'completed',
      updatedAt: now(),
    });
  }

  async markReviewing(sessionId: string): Promise<void> {
    await this.db.updateSession(sessionId, { status: 'reviewing', updatedAt: now() });
  }

  async cancelSession(sessionId: string): Promise<void> {
    await this.db.updateSession(sessionId, {
      status: 'cancelled',
      updatedAt: now(),
    });
  }

  /** Get the next executable task (all dependencies completed) */
  async getNextTask(sessionId: string): Promise<SddTask | null> {
    const tasks = await this.db.getTasksForSession(sessionId);
    const completedIds = new Set(
      tasks.filter((t) => t.status === 'completed' || t.status === 'skipped').map((t) => t.id),
    );

    for (const task of tasks) {
      if (task.status !== 'pending') continue;
      const depsReady = task.dependencies.every((dep) => completedIds.has(dep));
      if (depsReady) return task;
    }

    return null;
  }

  /** Check if all tasks are done */
  async isComplete(sessionId: string): Promise<boolean> {
    const tasks = await this.db.getTasksForSession(sessionId);
    return tasks.every((t) => t.status === 'completed' || t.status === 'skipped');
  }
}

// ─── SDD Engine ─────────────────────────────────────────────────────────────
// Orchestrates the full SDD lifecycle.

export interface SddEngineConfig {
  db: SddDatabase;
  eventHandler?: HarnessEventHandler;
  /** Called to run an agent turn (returns the text response) */
  runAgentTurn: (systemPromptAddon: string, userMessage: string, agentTypeOverride?: import('./types').AgentType) => Promise<import('./types').TurnOutcome>;
  /** Optional: called when the spec is approved to persist the plan to disk */
  savePlanFile?: (sessionId: string, spec: string, tasks: import('./types').SddTask[]) => Promise<void>;
}

export class SddEngine {
  private planManager: PlanManager;
  private config: SddEngineConfig;
  private _paused = false;
  private _failedTask: SddTask | null = null;

  constructor(config: SddEngineConfig) {
    this.config = config;
    this.planManager = new PlanManager(config.db);
  }

  get paused(): boolean {
    return this._paused;
  }

  get failedTask(): SddTask | null {
    return this._failedTask;
  }

  pause(): void {
    this._paused = true;
  }

  resume(): void {
    this._paused = false;
  }

  async cancel(sessionId: string): Promise<void> {
    this._paused = true;
    await this.planManager.cancelSession(sessionId);
    this.emitPhaseChange('cancelled');
  }

  // ─── Phase 1: Describe ──────────────────────────────────────────────

  async startSession(projectId: string, conversationId: string, description: string): Promise<SddSession> {
    const session = await this.planManager.createSession(projectId, conversationId, description);
    this.emitPhaseChange('describing');
    return session;
  }

  // ─── Phase 2: Spec ──────────────────────────────────────────────────

  async generateSpec(sessionId: string, feedback?: string): Promise<string> {
    const session = await this.planManager.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    this.emitPhaseChange('specifying');

    const prompt = `Generate a detailed specification document for the following feature request.

## Feature Description
${session.description}
${feedback ? `\n## Revision Feedback\n${feedback}` : ''}

## Required Output Format
Write a Markdown specification document with these sections:
1. **Purpose**: What this feature does and why it's needed
2. **Acceptance Criteria**: Concrete, testable criteria for completion
3. **Affected Files**: List of files that will be created or modified
4. **Technical Approach**: How it should be implemented
5. **Edge Cases**: Potential issues and how to handle them
6. **Out of Scope**: What is explicitly NOT part of this feature

Be specific and actionable. This spec will be used to generate an implementation plan.`;

    const specOutcome = await this.config.runAgentTurn(
      'You are generating a specification document for a software feature. Be thorough and precise.',
      prompt,
    );
    if (specOutcome.status !== 'complete') {
      throw new Error(specOutcome.response || `Specification generation stopped with status ${specOutcome.status}.`);
    }
    const spec = specOutcome.response;

    await this.planManager.updateSpec(sessionId, spec);
    return spec;
  }

  async approveSpec(sessionId: string): Promise<void> {
    await this.planManager.approveSpec(sessionId);
  }

  // ─── Phase 3: Plan ──────────────────────────────────────────────────

  async generatePlan(sessionId: string): Promise<SddTask[]> {
    const session = await this.planManager.getSession(sessionId);
    if (!session || !session.spec) throw new Error('Session has no approved spec');

    this.emitPhaseChange('planning');

    const prompt = `Based on the following specification, create a step-by-step implementation plan.

## Specification
${session.spec}

## Required Output Format
Return a JSON array of tasks. Each task has:
- "title": Short task title (imperative, e.g., "Create user model")
- "description": What to do in this task (2-3 sentences)
- "files": Array of file paths that will be affected
- "dependencies": Array of task indices (0-based) this task depends on

Return ONLY the JSON array, no other text.
Order tasks so dependencies come first.`;

    const planOutcome = await this.config.runAgentTurn(
      'You are a project planner. Generate a precise, ordered task list as JSON.',
      prompt,
    );
    if (planOutcome.status !== 'complete') {
      throw new Error(planOutcome.response || `Plan generation stopped with status ${planOutcome.status}.`);
    }
    const planResponse = planOutcome.response;

    const rawTasks = parsePlanTasks(planResponse);

    // Convert index-based dependencies to ID-based
    const tasks = await this.planManager.setTasks(
      sessionId,
      rawTasks.map((t) => ({
        title: t.title,
        description: t.description,
        files: t.files || [],
        dependencies: [], // Will be resolved after IDs are assigned
      })),
    );

    // Resolve dependencies
    for (let i = 0; i < rawTasks.length; i++) {
      const deps = (rawTasks[i].dependencies || [])
        .filter((idx) => idx >= 0 && idx < tasks.length && idx !== i)
        .map((idx) => tasks[idx].id);

      if (deps.length > 0) {
        tasks[i].dependencies = deps;
        // Persist resolved dependencies back to DB
        await this.planManager.updateTaskDependencies(tasks[i].id, deps);
      }
    }

    // Persist plan to disk if callback provided
    if (this.config.savePlanFile && session.spec) {
      try {
        await this.config.savePlanFile(sessionId, session.spec, tasks);
      } catch {
        // Non-critical: continue even if file write fails
      }
    }

    return tasks;
  }

  async approvePlan(sessionId: string): Promise<void> {
    await this.planManager.approvePlan(sessionId);
  }

  // ─── Phase 4: Execute ───────────────────────────────────────────────

  async execute(sessionId: string): Promise<'completed' | 'paused' | 'failed' | 'cancelled'> {
    this.emitPhaseChange('executing');
    this._paused = false;
    this._failedTask = null;

    const session = await this.planManager.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    while (!this._paused) {
      const task = await this.planManager.getNextTask(sessionId);
      if (!task) {
        // All tasks done
        break;
      }

      this.config.eventHandler?.({ type: 'sdd_task_start', task });
      await this.planManager.updateTaskStatus(task.id, 'in_progress');

      // Build rich context: spec + completed tasks + current task
      const completedTasks = session.tasks.filter((t) => t.status === 'completed' || t.status === 'skipped');
      const completedSummary = completedTasks
        .map((t) => `- [${t.status}] ${t.title}: ${t.agentOutput ? t.agentOutput.slice(0, 200) : 'No output yet'}`)
        .join('\n');

      const systemAddon = `You are executing a task from an implementation plan.

## Feature Specification
${session.spec ?? 'No spec available'}

## Completed Tasks So Far
${completedSummary || 'None yet — this is the first task.'}

## Current Task
- Title: ${task.title}
- Description: ${task.description}
- Affected Files: ${task.files.join(', ') || 'Not specified'}

Guidelines:
- Stay focused on this task only.
- Read files before modifying them.
- When done, provide a brief summary of what you did.
- If you encounter an unexpected issue that blocks this task, explain the blocker clearly.`;

      const taskPrompt = `Execute the following task:

## Task: ${task.title}
${task.description}

## Files to modify
${task.files.join('\n') || 'Not specified'}

Complete this task by using the available tools. Read files before modifying them.
When done, provide a brief summary of what you did.`;

      try {
        const outcome = await this.config.runAgentTurn(systemAddon, taskPrompt);
        if (outcome.status === 'cancelled') {
          await this.planManager.updateTaskStatus(task.id, 'pending');
          this._paused = true;
          return 'cancelled';
        }
        if (outcome.status !== 'complete') {
          throw new Error(outcome.response || `Task stopped with status ${outcome.status}`);
        }
        const output = outcome.response;

        await this.planManager.updateTaskStatus(task.id, 'completed', output);
        await this.planManager.updateTask(task.id, { toolCalls: outcome.toolCalls });

        const updatedTask = { ...task, status: 'completed' as SddTaskStatus, agentOutput: output };
        this.config.eventHandler?.({ type: 'sdd_task_complete', task: updatedTask });

        // Refresh session.tasks so completedSummary is accurate for next iteration
        const refreshed = await this.planManager.getSession(sessionId);
        if (refreshed) session.tasks = refreshed.tasks;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await this.planManager.updateTaskStatus(task.id, 'failed', errorMsg);

        // Emit task failure event with full context for potential debug delegation
        const failedTask: SddTask = { ...task, status: 'failed', agentOutput: errorMsg };
        this._failedTask = failedTask;
        this.config.eventHandler?.({ type: 'sdd_task_complete', task: failedTask });

        // Pause execution — user can choose to debug or skip
        this._paused = true;
        return 'failed';
      }
    }

    if (this._paused) return 'paused';
    return await this.planManager.isComplete(sessionId) ? 'completed' : 'paused';
  }

  /** Skip a specific task */
  async skipTask(taskId: string): Promise<void> {
    await this.planManager.updateTaskStatus(taskId, 'skipped');
  }

  async retryTask(taskId: string): Promise<void> {
    await this.planManager.updateTaskStatus(taskId, 'pending');
    if (this._failedTask?.id === taskId) this._failedTask = null;
  }

  // ─── Phase 5: Review ───────────────────────────────────────────────

  async review(sessionId: string): Promise<string> {
    const session = await this.planManager.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.status === 'completed') throw new Error(`Session ${sessionId} has already been reviewed.`);
    if (!await this.planManager.isComplete(sessionId)) {
      throw new Error('Cannot review an SDD session before every task is completed or skipped.');
    }

    await this.planManager.markReviewing(sessionId);
    this.emitPhaseChange('reviewing');

    const taskSummaries = session.tasks
      .map((t) => `- [${t.status}] ${t.title}: ${t.agentOutput || 'No output'}`)
      .join('\n');

    const prompt = `Review the implementation of the following feature.

## Original Description
${session.description}

## Specification
${session.spec}

## Task Results
${taskSummaries}

## Review Checklist
1. Do the changes match the specification?
2. Are there any missing pieces?
3. Are there potential bugs or issues?
4. Does the code follow project conventions?

Provide a summary of the implementation and any issues found.`;

    const reviewOutcome = await this.config.runAgentTurn(
      'You are reviewing a completed implementation. Be thorough but fair.',
      prompt,
      'review',
    );

    if (reviewOutcome.status !== 'complete') {
      throw new Error(reviewOutcome.response || `Review stopped with status ${reviewOutcome.status}`);
    }

    await this.planManager.completeSession(sessionId);
    this.emitPhaseChange('completed');

    return reviewOutcome.response;
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private emitPhaseChange(phase: SddStatus): void {
    this.config.eventHandler?.({ type: 'sdd_phase_change', phase });
  }
}
