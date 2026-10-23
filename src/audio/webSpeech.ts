import type { Language } from '../../shared/types';
import { Emitter, type Transcriber, type TranscriberEvents } from './transcriber';

/* Minimal typings for the Web Speech API (vendor-prefixed in Chrome and Safari). */
type RecAlternative = { transcript: string };
type RecResult = { isFinal: boolean; length: number; [i: number]: RecAlternative };
type RecResultList = { length: number; [i: number]: RecResult };
export type RecResultEvent = { resultIndex: number; results: RecResultList };
export type RecErrorEvent = { error: string };
export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((e: RecResultEvent) => void) | null;
  onerror: ((e: RecErrorEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type RecognitionCtor = new () => RecognitionLike;

export function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isWebSpeechSupported(): boolean {
  return getRecognitionCtor() !== null;
}

type Deps = {
  Ctor?: RecognitionCtor | null;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  isHidden?: () => boolean;
};

const QUICK_RESTART_MS = 250;
const MAX_BACKOFF_MS = 5000;
const GAP_REPORT_MS = 1500;
const DEDUP_WINDOW_MS = 5000;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Phase 0 transcriber on the browser speech engine (docs/02 §7).
 * Browsers end recognition sessions on their own; this restarts them until stop() is called.
 */
export class WebSpeechTranscriber implements Transcriber {
  private em = new Emitter();
  private rec: RecognitionLike | null = null;
  private wanted = false;
  private running = false;
  private failures = 0;
  private restartHandle: unknown = null;
  private endedAt: number | null = null;
  private emittedFinals = -1;
  private interimStartedAt: number | null = null;
  private lastInterim = '';
  private lastFinal: { norm: string; at: number } | null = null;
  private gotResultThisRun = false;
  private runStartedAt = 0;
  private stopResolve: (() => void) | null = null;
  private readonly Ctor: RecognitionCtor | null;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;
  private readonly isHidden: () => boolean;

  constructor(deps: Deps = {}) {
    this.Ctor = deps.Ctor === undefined ? getRecognitionCtor() : deps.Ctor;
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.isHidden =
      deps.isHidden ?? (() => typeof document !== 'undefined' && document.hidden === true);
  }

  on<E extends keyof TranscriberEvents>(ev: E, cb: TranscriberEvents[E]): () => void {
    return this.em.on(ev, cb);
  }

  async start({ language }: { language: Language; deviceId?: string }): Promise<void> {
    // deviceId is ignored: Web Speech always uses the default microphone (docs/02 §7).
    if (!this.Ctor) {
      this.em.emit('status', 'error', 'unsupported');
      return;
    }
    this.wanted = true;
    this.failures = 0;
    this.endedAt = null;
    // One instance for the whole session; iOS is reported to chime on every new instance.
    const rec = this.rec ?? new this.Ctor();
    rec.lang = language;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = () => this.handleStart();
    rec.onend = () => this.handleEnd();
    rec.onresult = (e) => this.handleResult(e);
    rec.onerror = (e) => this.handleError(e.error);
    this.rec = rec;
    this.launch();
  }

  async stop(): Promise<void> {
    this.wanted = false;
    if (this.restartHandle) this.clearTimer(this.restartHandle);
    this.restartHandle = null;
    if (!this.rec || !this.running) {
      this.flushInterim();
      this.em.emit('status', 'stopped');
      return;
    }
    await new Promise<void>((resolve) => {
      this.stopResolve = resolve;
      try {
        this.rec?.stop();
      } catch {
        resolve();
      }
      this.setTimer(() => resolve(), 1500);
    });
    this.stopResolve = null;
    this.flushInterim();
    this.em.emit('status', 'stopped');
  }

  /** Called by the app when the page becomes visible again (iOS ends recognition in the background). */
  resumeIfNeeded(): void {
    if (this.wanted && !this.running && !this.restartHandle) this.launch();
  }

  private launch(): void {
    this.restartHandle = null;
    if (!this.wanted || !this.rec) return;
    if (this.isHidden()) return; // resumeIfNeeded() restarts it when visible
    this.gotResultThisRun = false;
    try {
      this.rec.start();
    } catch (err) {
      // InvalidStateError: already started. Anything else counts as a failure.
      if (err instanceof Error && err.name === 'InvalidStateError') return;
      this.failures++;
      this.scheduleRestart();
    }
  }

  private handleStart(): void {
    this.running = true;
    this.runStartedAt = this.now();
    this.emittedFinals = -1; // each recognition session starts a new results list
    if (this.endedAt !== null) {
      const ms = this.now() - this.endedAt;
      if (ms >= GAP_REPORT_MS) this.em.emit('gap', { t: this.endedAt, ms });
    }
    this.endedAt = null;
    this.em.emit('status', 'listening');
  }

  private handleEnd(): void {
    this.running = false;
    this.flushInterim();
    if (this.stopResolve) {
      this.stopResolve();
      return;
    }
    if (!this.wanted) return;
    this.endedAt ??= this.now();
    // A run that ends at once without results is a failure; a long silent run is the
    // browser's normal silence timeout and restarts quickly.
    const short = this.now() - this.runStartedAt < 1000;
    if (!this.gotResultThisRun && short) this.failures++;
    else if (!this.gotResultThisRun) this.failures = 0;
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    if (!this.wanted || this.restartHandle) return;
    const delay =
      this.failures <= 1
        ? QUICK_RESTART_MS
        : Math.min(MAX_BACKOFF_MS, 500 * 2 ** (this.failures - 2));
    if (delay > QUICK_RESTART_MS) this.em.emit('status', 'reconnecting', 'network');
    this.restartHandle = this.setTimer(() => this.launch(), delay);
  }

  private handleError(code: string): void {
    switch (code) {
      case 'not-allowed':
      case 'service-not-allowed':
        return this.fatal('permission');
      case 'audio-capture':
        return this.fatal('no-mic');
      case 'language-not-supported':
        return this.fatal('language');
      case 'network':
        this.failures = Math.max(this.failures, 2);
        this.em.emit('status', 'reconnecting', 'network');
        return; // onend follows and restarts with back-off
      default:
        return; // no-speech, aborted: onend restarts
    }
  }

  private fatal(code: 'permission' | 'no-mic' | 'language'): void {
    this.wanted = false;
    if (this.restartHandle) this.clearTimer(this.restartHandle);
    this.restartHandle = null;
    try {
      this.rec?.abort();
    } catch {
      /* ignore */
    }
    this.em.emit('status', 'error', code);
  }

  private handleResult(e: RecResultEvent): void {
    this.gotResultThisRun = true;
    this.failures = 0;
    let interim = '';
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      if (!r) continue;
      const text = r[0]?.transcript ?? '';
      if (r.isFinal) {
        if (i > this.emittedFinals && i >= e.resultIndex) {
          this.emittedFinals = i;
          this.emitFinal(text);
        }
      } else {
        interim += text;
      }
    }
    interim = interim.trim();
    if (interim && this.interimStartedAt === null) this.interimStartedAt = this.now();
    if (interim !== this.lastInterim) {
      this.lastInterim = interim;
      this.em.emit('interim', { text: interim });
    }
  }

  private emitFinal(raw: string): void {
    let text = raw.trim();
    const at = this.now();
    const t = this.interimStartedAt ?? at;
    this.interimStartedAt = null;
    if (!text) return;
    // Some engines (reported on Android Chrome) repeat a final result, or resend it extended.
    const n = norm(text);
    const last = this.lastFinal;
    if (last && at - last.at < DEDUP_WINDOW_MS) {
      if (n === last.norm) return;
      if (n.startsWith(last.norm + ' ')) {
        const skip = last.norm.split(' ').length;
        text = text.split(/\s+/).slice(skip).join(' ');
      }
    }
    this.lastFinal = { norm: n, at };
    if (text) this.em.emit('final', { text, t });
  }

  private flushInterim(): void {
    if (this.lastInterim) {
      const text = this.lastInterim;
      this.lastInterim = '';
      this.emitFinal(text);
      this.em.emit('interim', { text: '' });
    }
    this.interimStartedAt = null;
  }
}
