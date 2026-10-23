import { apiFetch } from '../lib/api';
import { useAuth } from '../store/auth';
import { useSession } from '../store/session';
import { buildAnalyzeRequest } from './buildRequest';
import { callAnalyze } from './client';
import { mergeFlags } from './mergeFlags';
import { backoffMs, countWords, decide } from './scheduler';

const TICK_MS = 2000;

/**
 * Decides when to analyse (scheduler.ts), runs one call at a time, and applies the result.
 * New words that arrive during a call are picked up by the next tick after it ends.
 */
export class AnalysisRunner {
  private interval: ReturnType<typeof setInterval> | null = null;
  private ctl: AbortController | null = null;
  private unsubs: (() => void)[] = [];

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => this.tick(), TICK_MS);
    this.unsubs.push(
      useSession.subscribe((st, prev) => {
        if (
          st.session.lines.length !== prev.session.lines.length ||
          (st.analysis.manualRequested && !prev.analysis.manualRequested)
        ) {
          this.tick();
        }
        if (st.session.id !== prev.session.id) this.abort();
      }),
      useAuth.subscribe((st, prev) => {
        if (st.passcode && st.passcode !== prev.passcode) void this.loadConfig();
      }),
    );
    void this.loadConfig();
    window.addEventListener('online', this.onOnline);
  }

  /** Back online: retry at once instead of waiting out the back-off. */
  private onOnline = () => {
    useSession.getState().setAnalysis({ retryAt: 0 });
    this.tick();
  };

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    for (const u of this.unsubs) u();
    this.unsubs = [];
    window.removeEventListener('online', this.onOnline);
    this.abort();
  }

  abort(): void {
    this.ctl?.abort();
    this.ctl = null;
  }

  requestNow(): void {
    useSession.getState().setAnalysis({ manualRequested: true });
  }

  async loadConfig(): Promise<void> {
    const passcode = useAuth.getState().passcode;
    if (!passcode) return;
    const res = await apiFetch<{ maxCallsPerSession?: number }>('/api/config', { passcode });
    if (res.ok && typeof res.data.maxCallsPerSession === 'number') {
      useSession.getState().setAnalysis({ maxCalls: res.data.maxCallsPerSession });
    } else if (!res.ok && res.error.code === 'unauthorized') {
      useAuth.getState().markRejected();
    }
  }

  tick(now = Date.now()): void {
    const st = useSession.getState();
    if (st.pendingResume) return;
    const auth = useAuth.getState();
    const s = st.session;
    const fresh = s.lines.slice(s.analyzedUpToLineIndex);
    const newWords = countWords(fresh.map((l) => l.text).join(' '));
    const firstFresh = fresh[0];
    const since = s.lastAnalysisAt ?? (firstFresh ? s.startedAt + firstFresh.t : now);
    const d = decide({
      running: st.analysis.running,
      newWords,
      sinceLastMs: now - since,
      manual: st.analysis.manualRequested,
      callsUsed: s.analysisCalls,
      maxCalls: st.analysis.maxCalls,
      retryAt: st.analysis.retryAt,
      now,
      canCall:
        !!auth.passcode &&
        !auth.rejected &&
        (typeof navigator === 'undefined' || navigator.onLine !== false),
    });
    if (st.analysis.manualRequested && !d.run && d.reason !== 'running') {
      st.setAnalysis({ manualRequested: false });
    }
    if (d.run) void this.run();
  }

  private async run(): Promise<void> {
    const store = useSession.getState();
    const passcode = useAuth.getState().passcode;
    if (!passcode || store.analysis.running) return;
    const s = store.session;
    const prevIndex = s.analyzedUpToLineIndex;
    const body = buildAnalyzeRequest(s);
    store.beginAnalysis(s.lines.length);
    const ctl = new AbortController();
    this.ctl = ctl;
    const res = await callAnalyze(body, passcode, ctl.signal);
    if (this.ctl === ctl) this.ctl = null;
    const now = Date.now();
    const cur = useSession.getState();
    if (res.ok) {
      const { flags, newIds } = mergeFlags(cur.session.flags, res.data.flags, now);
      cur.applyAnalysis({
        sessionId: s.id,
        upToLineIndex: s.lines.length,
        summary: { tldr: res.data.tldr, topics: res.data.topics },
        flags,
        newFlagIds: newIds,
      });
      return;
    }
    if (res.error.code === 'aborted') {
      cur.failAnalysis({ sessionId: s.id, prevIndex, error: null, retryAt: 0 });
      return;
    }
    if (res.error.code === 'unauthorized') useAuth.getState().markRejected();
    const wait = backoffMs(cur.analysis.consecutiveErrors + 1, res.error.retryAfterSec);
    cur.failAnalysis({
      sessionId: s.id,
      prevIndex,
      error: { code: res.error.code, message: res.error.message },
      retryAt: now + wait,
    });
  }
}

export const analysisRunner = new AnalysisRunner();
