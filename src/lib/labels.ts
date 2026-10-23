import type { FlagType } from '../../shared/types';

/** Flag type labels used on cards and in exported notes. */
export const KIND: Record<FlagType, string> = {
  trap: 'Trap',
  logic: 'Logic error',
  question: 'Ask this',
  important: 'Important',
};
