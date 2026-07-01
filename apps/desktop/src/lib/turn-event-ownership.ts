import type { HarnessEvent } from '@hyscode/agent-harness';

export type ActiveTurnOwner = {
  tabId: string;
  conversationId: string;
  turnId: string | null;
};

export function eventBelongsToOwner(
  event: HarnessEvent,
  owner: ActiveTurnOwner | null,
  activeTabId: string,
): boolean {
  if (!owner) return true;
  if (activeTabId !== owner.tabId) return false;
  if (event.conversationId && event.conversationId !== owner.conversationId) return false;
  if (owner.turnId && event.turnId && event.turnId !== owner.turnId) return false;
  return true;
}
