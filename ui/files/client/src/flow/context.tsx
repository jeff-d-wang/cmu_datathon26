import { createContext, useContext, type Dispatch } from 'react';
import type { Action, FlowState } from './state';

export const FlowCtx = createContext<{ s: FlowState; dispatch: Dispatch<Action> } | null>(null);

export function useFlow() {
  const v = useContext(FlowCtx);
  if (!v) throw new Error('useFlow outside FlowCtx');
  return v;
}
