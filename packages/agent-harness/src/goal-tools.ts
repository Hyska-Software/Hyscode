import type { ToolCallRecord, ToolCategory, ToolHandler, ToolResult } from './types';
import {
  bounded,
  GOAL_LIMITS,
  text,
  type GoalCompletionRequest,
  type GoalCriterionInput,
  type GoalToolRuntime,
  type GoalValidator,
} from './goal-types';

const { MAX_OBJECTIVE_LENGTH, MAX_TEXT_LENGTH } = GOAL_LIMITS;

/** Tool-output metadata marker for a deferred completion request. */
export const GOAL_COMPLETION_ACTION = 'goal_completion_requested';

/**
 * Scans a turn's tool history (newest first) for the `complete_goal` marker
 * and projects it onto the real harness turn id. The harness calls this once
 * per turn so every consumer reads a typed field instead of scraping
 * tool-output metadata.
 */
export function extractGoalCompletionRequest(
  turnId: string,
  toolCalls: readonly ToolCallRecord[],
): GoalCompletionRequest | null {
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    const metadata = toolCalls[index]?.output.metadata;
    if (!metadata || metadata.action !== GOAL_COMPLETION_ACTION) continue;
    const summary = typeof metadata.summary === 'string' ? metadata.summary.trim() : '';
    if (!summary) return null;
    return {
      summary,
      evidence: typeof metadata.evidence === 'string' ? metadata.evidence : undefined,
      turnId,
    };
  }
  return null;
}

/**
 * Single Build-mode + main-agent gate applied to every goal tool. Sub-agents
 * inherit the tool definitions but always fail this gate: goal state is a
 * main-agent control plane, so neither reading nor writing it is meaningful
 * at delegation depth > 0.
 */
export function goalToolError(context: {
  agentType?: string;
  delegationLevel?: number;
}): string | null {
  if (context.agentType !== undefined && context.agentType !== 'build') return 'Goal mode is available in Build mode only.';
  if ((context.delegationLevel ?? 0) > 0) return 'Only the main agent may use persistent goal tools.';
  return null;
}

export function createDefaultGoalValidator(invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T>): GoalValidator {
  return async (criterion, context) => {
    if (criterion.kind === 'file_exists') {
      const filePath = text(criterion.config.path);
      if (!filePath || !invoke) return { passed: false, verified: false, summary: 'A file path validator is not configured.' };
      try {
        await invoke('stat_path', { path: filePath });
        return { passed: true, verified: true, summary: `Path exists: ${filePath}` };
      } catch (error) {
        return { passed: false, verified: true, summary: `Path does not exist: ${filePath}`, details: error instanceof Error ? error.message : String(error) };
      }
    }
    if (criterion.kind === 'command') {
      const expected = text(criterion.config.command);
      const call = [...context.toolCalls].reverse().find((candidate) => candidate.toolName === 'run_terminal_command' && (!expected || text(candidate.input.command) === expected));
      if (!call) return { passed: false, verified: false, summary: `Command was not observed: ${expected || '(any command)'}` };
      return call.output.success
        ? { passed: true, verified: true, summary: `Command succeeded: ${text(call.input.command)}` }
        : { passed: false, verified: true, summary: `Command failed: ${text(call.input.command)}`, details: call.output.error };
    }
    if (criterion.kind === 'tool_success') {
      const expected = text(criterion.config.toolName);
      const call = [...context.toolCalls].reverse().find((candidate) => candidate.toolName === expected && candidate.output.success);
      return call
        ? { passed: true, verified: true, summary: `Tool succeeded: ${expected}` }
        : { passed: false, verified: false, summary: `Successful tool call was not observed: ${expected}` };
    }
    return { passed: false, verified: false, summary: 'Human review is required for this criterion.' };
  };
}

function goalTool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  execute: (input: Record<string, unknown>, context: Parameters<ToolHandler['execute']>[1]) => Promise<ToolResult>,
  canUseGoal?: () => boolean,
): ToolHandler {
  return {
    definition: { name, description, inputSchema: { type: 'object', properties, required } },
    category: 'meta' as ToolCategory,
    requiresApproval: false,
    riskLevel: 'safe',
    execute: async (input, context) => {
      const gateError = goalToolError({ agentType: context.agentType, delegationLevel: context.delegationLevel });
      if (gateError) return { success: false, output: '', error: gateError };
      if (canUseGoal && !canUseGoal()) return { success: false, output: '', error: 'Goal mode is available in Build mode only.' };
      return execute(input, context);
    },
  };
}

function parseCriteria(value: unknown): GoalCriterionInput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): GoalCriterionInput[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const record = candidate as Record<string, unknown>;
    const description = bounded(record.description, MAX_TEXT_LENGTH);
    if (!description) return [];
    const kind = record.kind === 'file_exists' || record.kind === 'command' || record.kind === 'tool_success' || record.kind === 'review'
      ? record.kind : 'review';
    return [{ description, kind, config: record.config && typeof record.config === 'object' ? record.config as Record<string, unknown> : {}, required: record.required !== false }];
  });
}

/**
 * Budget edits are user-owned: the model may never raise its own limits, so
 * `edit_goal` only defines acceptance criteria while `/goal budget` and the
 * goal card edit the budget through the user control plane.
 */
export function createGoalTools(
  runtime: GoalToolRuntime,
  projectId?: string,
  canUseGoal?: () => boolean,
): ToolHandler[] {
  return [
    goalTool('get_goal', 'Read the persistent goal, acceptance criteria, evidence, blockers, and usage for this conversation.', {}, [], async (_input, context) => {
      const state = await runtime.getState(context.conversationId);
      return state ? { success: true, output: JSON.stringify(state, null, 2), metadata: { action: 'goal_read', goalId: state.goal.id } } : { success: true, output: 'No persistent goal is active for this conversation.', metadata: { action: 'goal_read' } };
    }, canUseGoal),
    goalTool('create_goal', 'Create one persistent goal for this conversation from the user-provided objective. The agent defines all criteria and execution metadata after creation.', {
      objective: { type: 'string' },
    }, ['objective'], async (input, context) => {
      try {
        const state = await runtime.createGoal(context.conversationId, context.projectId ?? projectId ?? '', bounded(input.objective, MAX_OBJECTIVE_LENGTH));
        return { success: true, output: `Persistent goal created: ${state.goal.objective}`, metadata: { action: 'goal_created', goalId: state.goal.id } };
      } catch (error) {
        return { success: false, output: '', error: error instanceof Error ? error.message : String(error) };
      }
    }, canUseGoal),
    goalTool('edit_goal', 'Define or replace the acceptance criteria for the active persistent goal. The user supplies only the objective; the agent owns these criteria and must make them concrete and testable.', {
      criteria: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            kind: { type: 'string', enum: ['command', 'file_exists', 'tool_success', 'review'] },
            config: { type: 'object' },
            required: { type: 'boolean' },
          },
          required: ['description'],
        },
      },
    }, ['criteria'], async (input, context) => {
      try {
        const state = await runtime.defineCriteria(context.conversationId, parseCriteria(input.criteria), context.turnId ?? null);
        return { success: true, output: `Goal criteria defined: ${state.criteria.length} acceptance criteria.`, metadata: { action: 'goal_criteria_defined', goalId: state.goal.id } };
      } catch (error) {
        return { success: false, output: '', error: error instanceof Error ? error.message : String(error) };
      }
    }, canUseGoal),
    goalTool('report_goal_progress', 'Record a concrete checkpoint and optional agent evidence for the active persistent goal.', {
      summary: { type: 'string' },
      checkpoint: { type: 'string' },
      criterionId: { type: 'string' },
      evidenceDetails: { type: 'string' },
    }, ['summary'], async (input, context) => {
      try {
        const state = await runtime.reportProgress(context.conversationId, bounded(input.summary, MAX_TEXT_LENGTH), bounded(input.checkpoint, MAX_TEXT_LENGTH) || undefined, text(input.criterionId) || undefined, bounded(input.evidenceDetails, MAX_TEXT_LENGTH) || undefined, context.turnId ?? null);
        return { success: true, output: `Progress recorded. Checkpoint: ${state.goal.checkpoint}`, metadata: { action: 'goal_progress', goalId: state.goal.id } };
      } catch (error) {
        return { success: false, output: '', error: error instanceof Error ? error.message : String(error) };
      }
    }, canUseGoal),
    goalTool('complete_goal', 'Request completion of the persistent goal after all acceptance criteria are actually satisfied. The runtime validates the request after the turn.', {
      summary: { type: 'string' },
      evidence: { type: 'string' },
    }, ['summary'], async (input, context) => {
      const summary = bounded(input.summary, MAX_TEXT_LENGTH);
      if (!summary) return { success: false, output: '', error: 'Completion summary is required.' };
      return {
        success: true,
        output: 'Completion request recorded. The runtime will validate the goal criteria after this turn.',
        metadata: { action: GOAL_COMPLETION_ACTION, summary, evidence: bounded(input.evidence, MAX_TEXT_LENGTH) || summary, toolCallId: context.toolCallId },
      };
    }, canUseGoal),
    goalTool('report_goal_blocker', 'Report a real blocker. The runtime requires the same blocker fingerprint across three consecutive goal turns before entering blocked status.', {
      summary: { type: 'string' },
      fingerprint: { type: 'string' },
      details: { type: 'string' },
    }, ['summary'], async (input, context) => {
      try {
        const state = await runtime.reportBlocker(context.conversationId, bounded(input.summary, MAX_TEXT_LENGTH), text(input.fingerprint) || undefined, bounded(input.details, MAX_TEXT_LENGTH) || undefined, context.turnId ?? null);
        return { success: true, output: `Blocker recorded. The goal is currently ${state.goal.status}.`, metadata: { action: 'goal_blocker', goalId: state.goal.id, status: state.goal.status } };
      } catch (error) {
        return { success: false, output: '', error: error instanceof Error ? error.message : String(error) };
      }
    }, canUseGoal),
  ];
}
