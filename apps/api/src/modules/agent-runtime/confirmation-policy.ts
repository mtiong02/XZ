import type { AgentToolContract, ConfirmationMode } from './agent-runtime.types';

export interface ConfirmationContext {
  explicitUserConfirmation?: boolean;
  hasExternalSideEffect?: boolean;
}

export function confirmationForTool(
  tool: AgentToolContract,
  context: ConfirmationContext = {},
): ConfirmationMode {
  if (context.hasExternalSideEffect || tool.risk === 'EXTERNAL_SIDE_EFFECT') return 'STRONG';
  if (tool.risk === 'REVERSIBLE_WRITE') return context.explicitUserConfirmation ? 'NONE' : 'SOFT';
  return 'NONE';
}
