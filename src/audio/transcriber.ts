import type { Language } from '../../shared/types';

export type TranscriberStatus = 'listening' | 'reconnecting' | 'stopped' | 'error';

/** Why the transcriber stopped with an error. The UI maps each code to help text. */
export type TranscriberErrorCode =
  'unsupported' | 'permission' | 'no-mic' | 'language' | 'start-failed';

export type TranscriberEvents = {
  interim: (i: { text: string; speakerId?: string }) => void;
  final: (l: { text: string; speakerId?: string; t: number }) => void;
  status: (s: TranscriberStatus, detail?: TranscriberErrorCode | 'network') => void;
  /** Recognition was not running for `ms` milliseconds, starting at epoch time `t` (US-02 AC4). */
  gap: (g: { t: number; ms: number }) => void;
};

/** docs/02-architecture.md §7. Phase 1 adds a cloud implementation behind the same interface. */
export interface Transcriber {
  start(opts: { language: Language; deviceId?: string }): Promise<void>;
  stop(): Promise<void>;
  on<E extends keyof TranscriberEvents>(ev: E, cb: TranscriberEvents[E]): () => void;
}

/** Small typed event emitter shared by implementations. */
export class Emitter {
  private handlers: { [E in keyof TranscriberEvents]: Set<TranscriberEvents[E]> } = {
    interim: new Set(),
    final: new Set(),
    status: new Set(),
    gap: new Set(),
  };
  on<E extends keyof TranscriberEvents>(ev: E, cb: TranscriberEvents[E]): () => void {
    this.handlers[ev].add(cb);
    return () => this.handlers[ev].delete(cb);
  }
  emit<E extends keyof TranscriberEvents>(ev: E, ...args: Parameters<TranscriberEvents[E]>): void {
    for (const h of this.handlers[ev])
      (h as (...a: Parameters<TranscriberEvents[E]>) => void)(...args);
  }
}
