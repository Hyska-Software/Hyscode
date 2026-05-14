// ─── Memory Context Provider ─────────────────────────────────────────────────
// Injects relevant memories into the agent context window as a system prompt block.

import type { MemoryManager } from './memory-manager';

/** Max fraction of the available token budget consumed by memory injection. */
const MEMORY_BUDGET_FRACTION = 0.10;

export class MemoryContextProvider {
  private manager: MemoryManager;
  private projectId: string;

  constructor(manager: MemoryManager, projectId: string) {
    this.manager = manager;
    this.projectId = projectId;
  }

  /**
   * Build a `<memories>` block for injection into the system prompt.
   *
   * @param contextHint  Text from the current user message used to guide FTS5 retrieval.
   * @param tokenBudget  Total available input token budget (memories consume 10% of this).
   * @returns Formatted XML block, or null if no memories are available.
   */
  async getContextBlock(
    contextHint: string,
    tokenBudget = 4096,
  ): Promise<string | null> {
    try {
      const charBudget = Math.floor(tokenBudget * MEMORY_BUDGET_FRACTION) * 4;

      const memories = await this.manager.getRelevant(
        this.projectId,
        contextHint,
        8,   // max candidates to fetch
        0.2, // min relevance to include
      );

      if (memories.length === 0) return null;

      const parts: string[] = [];
      let usedChars = 0;

      for (const m of memories) {
        const body = (m.summary || m.content).slice(0, 250);
        const entry = `  <memory id="${m.id}" type="${m.type}" relevance="${m.relevanceScore.toFixed(2)}">\n    <title>${escapeXml(m.title)}</title>\n    <content>${escapeXml(body)}</content>${m.tags.length ? `\n    <tags>${m.tags.join(', ')}</tags>` : ''}\n  </memory>`;
        if (usedChars + entry.length > charBudget) break;
        parts.push(entry);
        usedChars += entry.length;
      }

      if (parts.length === 0) return null;

      return `<memories count="${parts.length}">\n${parts.join('\n')}\n</memories>`;
    } catch {
      // Never surface provider errors to the harness — memories are optional
      return null;
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
