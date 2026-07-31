import type { Harness } from './harness';
import type { ChildHarnessOptions } from './environment';
import type {
  AgentType,
  EnvironmentContext,
  HarnessConfig,
  HarnessEventHandler,
  Rule,
  Skill,
  ToolHandler,
  TurnOutcome,
} from './types';

export const SUB_AGENT_PREAMBLE = `[SUB-AGENT CONTEXT]
You are running as an autonomous sub-agent. Rules:
1. You CANNOT use ask_user — if information is missing, make reasonable assumptions and proceed.
2. Do NOT spawn additional sub-agents.
3. Complete your task fully and return a comprehensive, detailed result as your final text response.

Your task:

`;

export type DelegatedRunnerOptions = {
  parentHarness: Harness;
  mode: AgentType;
  config: Partial<HarnessConfig>;
  conversationId: string;
  environmentContext?: EnvironmentContext;
  delegationChain?: ReadonlyArray<{ fromMode: string; toMode: string; reason: string }>;
  activeSkills?: Skill[];
  activeRules?: Rule[];
  externalTools?: ToolHandler[];
  onEvent?: HarnessEventHandler;
};

/**
 * Package-level lifecycle for delegated turns. The desktop adapter remains
 * responsible for presentation, but child creation, environment inheritance,
 * and parent conversation identity live behind this module boundary.
 */
export class DelegatedRunner {
  private readonly harness: Harness;
  private readonly conversationId: string;
  private readonly environmentContext?: EnvironmentContext;
  private readonly delegationChain: ReadonlyArray<{
    fromMode: string;
    toMode: string;
    reason: string;
  }>;

  constructor(options: DelegatedRunnerOptions) {
    const childOptions: ChildHarnessOptions = {
      agentType: options.mode,
      config: options.config,
      externalTools: options.externalTools,
      onEvent: options.onEvent,
    };
    this.harness = options.parentHarness.createChild(childOptions);
    this.conversationId = options.conversationId;
    this.environmentContext = options.environmentContext;
    this.delegationChain = options.delegationChain ?? [];
    this.harness.setActiveSkills(options.activeSkills ?? options.parentHarness.getActiveSkills());
    this.harness.setActiveRules(options.activeRules ?? options.parentHarness.getActiveRules());
    this.harness.setDelegationChain(this.delegationChain);
  }

  async run(task: string): Promise<TurnOutcome> {
    this.harness.setConversationId(this.conversationId);
    if (this.environmentContext) this.harness.injectEnvironmentContext(this.environmentContext);
    return this.harness.run(SUB_AGENT_PREAMBLE + task, []);
  }

  cancel(): void {
    this.harness.cancel();
  }

  trustTool(toolName: string): void {
    this.harness.getToolRouter().trustToolForSession(toolName);
  }

  getHarness(): Harness {
    return this.harness;
  }
}
