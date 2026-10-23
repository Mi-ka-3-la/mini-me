import { apiFetch } from '../lib/api';
import { useAuth } from '../store/auth';
import { useSession, type AnalysisMode } from '../store/session';
import { buildAnswerRequest, buildSummaryRequest, buildWatchRequest } from './buildRequest';
import { callAnalyze, errorText } from './client';
import { mergeFlags } from './mergeFlags';
import { backoffMs, countWords, decide, decideSummary } from './scheduler';

const TICK_MS = 2000;

/**
 * Decides when to analyse (scheduler.ts), runs one call at a time, and applies the result.
 * New words that arrive during a call are picked up by the next tick after it ends.
 */
export class AnalysisRunner {
  private interval: ReturnType<typeof setInterval> | null = null;
  private ctls = new Set<AbortController>();
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
    for (const c of this.ctls) c.abort();
    this.ctls.clear();
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
    const canCall =
      !!auth.passcode &&
      !auth.rejected &&
      (typeof navigator === 'undefined' || navigator.onLine !== false);
    const progress = (upTo: number, lastAt: number | null) => {
      const fresh = s.lines.slice(upTo);
      const first = fresh[0];
      return {
        newWords: countWords(fresh.map((l) => l.text).join(' ')),
        sinceLastMs: now - (lastAt ?? (first ? s.startedAt + first.t : now)),
      };
    };
    const shared = {
      manual: st.analysis.manualRequested,
      callsUsed: s.analysisCalls,
      maxCalls: st.analysis.maxCalls,
      retryAt: st.analysis.retryAt,
      now,
      canCall,
    };
    const watch = decide({
      ...shared,
      running: st.analysis.running,
      ...progress(s.analyzedUpToLineIndex, s.lastAnalysisAt),
    });
    const summary = decideSummary({
      ...shared,
      running: st.analysis.summaryRunning,
      noSummaryYet: s.summary === null,
      ...progress(s.summaryUpToLineIndex, s.lastSummaryAt),
    });
    if (st.analysis.manualRequested && !watch.run && !summary.run) {
      st.setAnalysis({ manualRequested: false });
    }
    // Decide both before starting either: starting a call clears the manual request.
    if (watch.run) void this.run('watch');
    if (summary.run) void this.run('summary');
  }

  private async run(mode: AnalysisMode): Promise<void> {
    const store = useSession.getState();
    const passcode = useAuth.getState().passcode;
    const busy = mode === 'watch' ? store.analysis.running : store.analysis.summaryRunning;
    if (!passcode || busy) return;
    const s = store.session;
    const prevIndex = mode === 'watch' ? s.analyzedUpToLineIndex : s.summaryUpToLineIndex;
    const body = mode === 'watch' ? buildWatchRequest(s) : buildSummaryRequest(s);
    store.beginAnalysis(mode, s.lines.length);
    const ctl = new AbortController();
    this.ctls.add(ctl);
    const res = await callAnalyze(body, passcode, ctl.signal);
    this.ctls.delete(ctl);
    const now = Date.now();
    const cur = useSession.getState();
    if (res.ok) {
      if ('flags' in res.data) {
        const { flags, newIds } = mergeFlags(cur.session.flags, res.data.flags, now);
        cur.applyWatch({ sessionId: s.id, flags, newFlagIds: newIds });
        cur.addQuestions({ sessionId: s.id, questions: res.data.questions, at: now });
        useSession.getState().applyThreads({
          sessionId: s.id,
          segments: res.data.segments,
          answered: res.data.answered,
          at: now,
        });
      } else if ('tldr' in res.data) {
        cur.applySummary({
          sessionId: s.id,
          summary: { tldr: res.data.tldr, topics: res.data.topics },
        });
      }
      return;
    }
    if (res.error.code === 'aborted') {
      cur.failAnalysis({ mode, sessionId: s.id, prevIndex, error: null, retryAt: 0 });
      return;
    }
    if (res.error.code === 'unauthorized') useAuth.getState().markRejected();
    const wait = backoffMs(cur.analysis.consecutiveErrors + 1, res.error.retryAfterSec);
    cur.failAnalysis({
      mode,
      sessionId: s.id,
      prevIndex,
      error: { code: res.error.code, message: res.error.message },
      retryAt: now + wait,
    });
  }
}

export const analysisRunner = new AnalysisRunner();

/** Answers one question when the listener taps "Answer" (ADR-20). Counts as an analysis call. */
export async function answerQuestion(id: string): Promise<void> {
  const st = useSession.getState();
  const passcode = useAuth.getState().passcode;
  const q = st.session.questions.find((x) => x.id === id);
  if (!q || !passcode || st.answeringId) return;
  const sessionId = st.session.id;
  st.setAnswering(id);
  useSession.setState((cur) => ({
    session: { ...cur.session, analysisCalls: cur.session.analysisCalls + 1 },
  }));
  const res = await callAnalyze(
    buildAnswerRequest(st.session, q, st.background),
    passcode,
    new AbortController().signal,
  );
  const cur = useSession.getState();
  if (res.ok && 'answer' in res.data) {
    cur.setAnswer({ sessionId, id, answer: res.data.answer });
    return;
  }
  if (!res.ok && res.error.code === 'unauthorized') useAuth.getState().markRejected();
  cur.setAnswering(null, {
    id,
    message: res.ok ? 'The answer came back malformed. Try again.' : errorText(res.error, 0),
  });
}
