// ─── Memory Extractor ────────────────────────────────────────────────────────
// Analyzes completed agent turns and extracts persistent knowledge candidates.

import type { MemoryExtraction } from './types';
import type { MemoryManager } from './memory-manager';

// ─── Extractor Interface ─────────────────────────────────────────────────────

interface Extractor {
  name: string;
  extract(userMessage: string, assistantText: string, toolNames: string[]): MemoryExtraction[];
}

// ─── Individual Extractors ───────────────────────────────────────────────────

/** Extract error → solution pairs from debugging turns. */
const errorSolutionExtractor: Extractor = {
  name: 'ErrorSolution',
  extract(userMessage, assistantText, toolNames) {
    const results: MemoryExtraction[] = [];

    const hasErrorInUser = /error|exception|fail|crash|bug|issue|problem/i.test(userMessage);
    const hasErrorInTool = toolNames.includes('get_diagnostics');
    if (!hasErrorInUser && !hasErrorInTool) return results;

    const hasFixInAssistant = /fix|resolv|solv|workaround|solution/i.test(assistantText);
    if (!hasFixInAssistant) return results;

    const errorMatch = userMessage.match(/(?:error|exception|issue)[:\s]+([^\n.]{5,120})/i);
    const errorDesc = (errorMatch?.[1] ?? userMessage.slice(0, 80)).trim();

    const solutionMatch = assistantText.match(/(?:the (?:fix|solution) is|to fix|resolve this)[^\n]*\n?([^\n]{30,300})/i)
      ?? assistantText.match(/(?:fix|solution|resolv)[^\n]*\n?([^\n]{30,})/i);
    const solution = (solutionMatch?.[1] ?? assistantText.slice(0, 300)).trim();

    if (solution.length < 20) return results;

    results.push({
      type: 'error_solution',
      title: `Fix: ${errorDesc.slice(0, 60)}`,
      content: `Problem: ${errorDesc}\n\nSolution: ${solution}`,
      summary: `${errorDesc.slice(0, 100)} → ${solution.slice(0, 100)}`,
      tags: ['error', 'fix'],
      confidence: 0.65,
      sourceSignature: `err:${errorDesc.slice(0, 40).toLowerCase().replace(/\W+/g, '')}`,
    });
    return results;
  },
};

/** Extract coding conventions established during code-writing turns. */
const conventionExtractor: Extractor = {
  name: 'Convention',
  extract(_userMessage, assistantText, toolNames) {
    const results: MemoryExtraction[] = [];

    const isWritingCode = toolNames.some(t => ['write_file', 'edit_file', 'create_file'].includes(t));
    if (!isWritingCode) return results;

    const conventionPatterns = [
      /we (?:use|prefer|always|follow) ([^\n.]{15,200})/gi,
      /convention[:\s]+([^\n.]{15,200})/gi,
      /coding (?:style|pattern|standard)[:\s]+([^\n.]{15,200})/gi,
    ];

    for (const pattern of conventionPatterns) {
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(assistantText)) !== null) {
        const convention = m[1]?.trim();
        if (convention && convention.length > 15 && convention.length < 200) {
          results.push({
            type: 'convention',
            title: `Convention: ${convention.slice(0, 60)}`,
            content: convention,
            summary: convention.slice(0, 200),
            tags: ['convention', 'code-style'],
            confidence: 0.62,
            sourceSignature: `conv:${convention.slice(0, 30).toLowerCase().replace(/\W+/g, '')}`,
          });
        }
      }
    }
    return results.slice(0, 2);
  },
};

/** Extract architectural and technical decisions. */
const decisionExtractor: Extractor = {
  name: 'Decision',
  extract(userMessage, assistantText) {
    const results: MemoryExtraction[] = [];

    if (!/\b(?:decided?|chose|choosing|went with|will use|should use|adopted)\b/i.test(assistantText)) return results;

    const patterns = [
      /(?:decided?|chose|choosing|went with|will use|adopted) (?:to )?([^\n.]{15,150})/gi,
      /(?:best (?:approach|option|choice) is) ([^\n.]{15,150})/gi,
    ];

    for (const pattern of patterns) {
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(assistantText)) !== null) {
        const decision = m[1]?.trim();
        if (decision && decision.length > 15) {
          const context = userMessage.slice(0, 100).trim();
          results.push({
            type: 'decision',
            title: `Decision: ${decision.slice(0, 60)}`,
            content: context ? `Context: ${context}\n\nDecision: ${decision}` : decision,
            summary: decision.slice(0, 200),
            tags: ['decision', 'architecture'],
            confidence: 0.68,
            sourceSignature: `dec:${decision.slice(0, 30).toLowerCase().replace(/\W+/g, '')}`,
          });
        }
      }
    }
    return results.slice(0, 2);
  },
};

/** Extract multi-step workflows and processes. */
const workflowExtractor: Extractor = {
  name: 'Workflow',
  extract(userMessage, assistantText, toolNames) {
    const results: MemoryExtraction[] = [];

    const stepsCount = (assistantText.match(/^\s*(?:\d+\.|[-*•])\s/gm) ?? []).length;
    const hasTerminal = toolNames.includes('run_terminal_command');

    if (stepsCount < 3 && !hasTerminal) return results;

    const hasWorkflowIntent = /\b(?:workflow|process|steps?|procedure|how to|to (?:run|build|deploy|test|set up))\b/i.test(userMessage + assistantText);
    if (!hasWorkflowIntent) return results;

    const steps = assistantText.match(/(?:^\s*(?:\d+\.|[-*•])\s.+$)/gm);
    if (!steps || steps.length < 3) return results;

    const desc = userMessage.slice(0, 80).trim();
    const stepsText = steps.slice(0, 8).join('\n');

    results.push({
      type: 'workflow',
      title: `Workflow: ${desc.slice(0, 60)}`,
      content: `${desc}\n\nSteps:\n${stepsText}`,
      summary: stepsText.slice(0, 250),
      tags: ['workflow', 'process'],
      confidence: 0.70,
      sourceSignature: `wf:${desc.slice(0, 30).toLowerCase().replace(/\W+/g, '')}`,
    });
    return results;
  },
};

/** Extract factual information about the project. */
const factExtractor: Extractor = {
  name: 'Fact',
  extract(_userMessage, assistantText) {
    const results: MemoryExtraction[] = [];

    const patterns = [
      /the (?:project|app|codebase|system) (?:uses?|is|has|runs?|relies? on) ([^\n.]{20,150})/gi,
      /this (?:database|api|service|component|module) (?:is|uses?) ([^\n.]{20,100})/gi,
      /(?:stack|tech|technologies?)(?:\s+(?:includes?|is|are|used))[:\s]+([^\n.]{20,200})/gi,
    ];

    for (const pattern of patterns) {
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(assistantText)) !== null) {
        const fact = m[0]?.trim();
        if (fact && fact.length > 20 && fact.length < 300) {
          results.push({
            type: 'fact',
            title: `Fact: ${fact.slice(0, 60)}`,
            content: fact,
            summary: fact.slice(0, 200),
            tags: ['fact', 'project-info'],
            confidence: 0.60,
            sourceSignature: `fact:${fact.slice(0, 30).toLowerCase().replace(/\W+/g, '')}`,
          });
        }
      }
    }
    return results.slice(0, 2);
  },
};

/** Extract explicit user preferences from the user's messages. */
const preferenceExtractor: Extractor = {
  name: 'Preference',
  extract(userMessage) {
    const results: MemoryExtraction[] = [];

    const patterns = [
      /(?:i|user) (?:prefer|like|want|always|don't like|dislike|hate) ([^\n.]{10,120})/gi,
      /(?:please always|never|always) ([^\n.]{10,100})/gi,
      /(?:i want you to always|make sure to always) ([^\n.]{10,100})/gi,
    ];

    for (const pattern of patterns) {
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(userMessage)) !== null) {
        const pref = m[0]?.trim();
        if (pref && pref.length > 10 && pref.length < 200) {
          results.push({
            type: 'user_preference',
            title: `Preference: ${pref.slice(0, 60)}`,
            content: pref,
            summary: pref.slice(0, 200),
            tags: ['preference', 'user'],
            confidence: 0.72,
            sourceSignature: `pref:${pref.slice(0, 30).toLowerCase().replace(/\W+/g, '')}`,
          });
        }
      }
    }
    return results.slice(0, 2);
  },
};

// ─── MemoryExtractor ─────────────────────────────────────────────────────────

const ALL_EXTRACTORS: Extractor[] = [
  errorSolutionExtractor,
  conventionExtractor,
  decisionExtractor,
  workflowExtractor,
  factExtractor,
  preferenceExtractor,
];

export class MemoryExtractor {
  /** Dedup within a session to avoid re-storing the same extraction. */
  private recentSignatures = new Set<string>();

  /**
   * Run all extractors against a completed turn.
   * Returns deduplicated extraction candidates, capped at 5 per turn.
   */
  extract(
    userMessage: string,
    assistantText: string,
    toolNames: string[],
  ): MemoryExtraction[] {
    const all: MemoryExtraction[] = [];

    for (const extractor of ALL_EXTRACTORS) {
      try {
        all.push(...extractor.extract(userMessage, assistantText, toolNames));
      } catch {
        // Never let extractor failures surface to caller
      }
    }

    const deduped: MemoryExtraction[] = [];
    for (const m of all) {
      if (m.sourceSignature && this.recentSignatures.has(m.sourceSignature)) continue;
      if (m.sourceSignature) this.recentSignatures.add(m.sourceSignature);
      deduped.push(m);
    }

    return deduped.slice(0, 5);
  }

  /**
   * Extract memories from a completed turn and persist them.
   * Skips extractions below minConfidence (default 0.6).
   * Returns the count of saved memories.
   */
  async extractAndPersist(
    manager: MemoryManager,
    userMessage: string,
    assistantText: string,
    toolNames: string[],
    projectId: string,
    conversationId: string,
    minConfidence = 0.6,
  ): Promise<number> {
    const extractions = this.extract(userMessage, assistantText, toolNames);
    if (extractions.length === 0) return 0;

    const saved = await manager.persistExtractions(
      extractions,
      projectId,
      conversationId,
      minConfidence,
    );
    return saved.length;
  }

  /** Reset deduplication cache — call at session start or per-conversation. */
  reset(): void {
    this.recentSignatures.clear();
  }
}
