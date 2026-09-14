import { useLayoutStore } from '@/stores/layout-store';
import { useProjectStore } from '@/stores/project-store';
import { HarnessBridge } from './harness-bridge';
import { vortexSessionRuntimeManager } from './vortex-session-runtime';
import type { AgentMode } from '@/stores/agent-store';
import type { GoalEditInput, GoalState } from '@hyscode/agent-harness';

function isVortexLayout(): boolean {
  return useLayoutStore.getState().workspaceMode === 'agent';
}

export function getActiveAgentBridge(): HarnessBridge {
  if (isVortexLayout()) {
    const focused = vortexSessionRuntimeManager.getFocusedBridge();
    if (focused) return focused;
  }
  return HarnessBridge.get();
}

export async function sendActiveAgentMessage(
  userMessage: string,
  options: { hidden?: boolean; excludeLastAssistantFromHistory?: boolean } = {},
): Promise<void> {
  if (isVortexLayout()) {
    await vortexSessionRuntimeManager.sendFocusedMessage(userMessage, options);
    return;
  }
  await HarnessBridge.get().sendMessage(userMessage, options);
}

export async function retryActiveAgentTurn(): Promise<void> {
  if (isVortexLayout()) {
    await vortexSessionRuntimeManager.retryFocusedSession();
    return;
  }
  await HarnessBridge.get().retryTurn();
}

export async function continueActiveAgentTurn(): Promise<void> {
  if (isVortexLayout()) {
    await vortexSessionRuntimeManager.continueFocusedSession();
    return;
  }
  await HarnessBridge.get().continuePartialTurn();
}

export function cancelActiveAgentRun(): void {
  if (isVortexLayout()) {
    const snapshot = vortexSessionRuntimeManager.getFocusedSnapshot();
    const projectPath = useProjectStore.getState().rootPath;
    if (snapshot && projectPath) {
      vortexSessionRuntimeManager.cancelSession(projectPath, snapshot.conversationId);
      return;
    }
  }
  HarnessBridge.get().cancel();
}

export function setActiveAgentType(mode: AgentMode): void {
  if (isVortexLayout()) {
    void vortexSessionRuntimeManager.setFocusedAgentType(mode);
    return;
  }
  HarnessBridge.get().setAgentType(mode);
}

export async function createActiveGoal(objective: string): Promise<GoalState> {
  const bridge = getActiveAgentBridge();
  const state = await bridge.createGoal(objective);
  void bridge.startGoalExecution().catch(() => undefined);
  return state;
}

export async function pauseActiveGoal(): Promise<GoalState> {
  return getActiveAgentBridge().pauseGoal();
}

export async function resumeActiveGoal(): Promise<GoalState> {
  const bridge = getActiveAgentBridge();
  const state = await bridge.resumeGoal();
  void bridge.startGoalExecution().catch(() => undefined);
  return state;
}

export async function editActiveGoal(updates: GoalEditInput): Promise<GoalState> {
  return getActiveAgentBridge().editGoal(updates);
}

export async function cancelActiveGoal(): Promise<GoalState> {
  return getActiveAgentBridge().cancelGoal();
}

export async function clearActiveGoal(): Promise<void> {
  await getActiveAgentBridge().clearGoal();
}
