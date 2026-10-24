import { create } from 'zustand';
import { z } from 'zod';
import type { Language } from '../../shared/types';
import { newId } from '../lib/ids';
import { withTopics } from '../lib/topics';

export { withTopics };
import { KEYS, readJson, readString, remove, writeString } from '../lib/storage';
import { clearSession, hasContent, loadSession, saveSession } from './persist';
import type {
  Answer,
  ClientFlag,
  Gap,
  Interim,
  Line,
  Prep,
  Question,
  Segment,
  Session,
  Speaker,
  Summary,
} from './types';

export type ListenStatus = 'idle' | 'starting' | 'listening' | 'reconnecting' | 'error';

/** Runtime-only state: never persisted. */
type Runtime = {
  interim: Interim;
  listen: ListenStatus;
  listenError: string | null;
  /** A saved session found at load, waiting for the user's "Resume meeting?" answer. */
  pendingResume: Session | null;
  analysis: AnalysisRuntime;
  /** The listener's background for answers (ADR-20). Kept on this device, not in the session. */
  background: string;
  /** Likely questions answered before the meeting (ADR-25). Kept on this device. */
  prep: Prep | null;
  preparing: boolean;
  prepError: string | null;
  /** Question being answered right now, and the last answer error. */
  answeringId: string | null;
  answerError: { id: string; message: string } | null;
};

export type AnalysisError = { code: string; message: string };

export type AnalysisMode = 'watch' | 'summary';

export type AnalysisRuntime = {
  /** a watch call is running */
  running: boolean;
  /** a summary call is running */
  summaryRunning: boolean;
  error: AnalysisError | null;
  /** epoch ms of the last successful update */
  updatedAt: number | null;
  maxCalls: number;
  consecutiveErrors: number;
  retryAt: number;
  /** set by "Analyze now", consumed by the runner */
  manualRequested: boolean;
  /** ids of flags added by the last update, for the highlight and the tab badge */
  newFlagIds: string[];
  /** new flags not yet seen on the Watch list tab (narrow layout) */
  unseenFlags: number;
};

type Actions = {
  resume: () => void;
  startNew: () => void;
  setLanguage: (l: Language) => void;
  setContext: (c: string) => void;
  /** Resets the meeting clock if nothing has happened yet, so timestamps start at 00:00. */
  markStart: () => void;
  addLine: (l: { text: string; origin: Line['origin']; speakerLabel?: string; t?: number }) => void;
  setInterim: (i: Interim) => void;
  addGap: (g: Gap) => void;
  setListen: (s: ListenStatus, error?: string | null) => void;
  setAnalysis: (patch: Partial<AnalysisRuntime>) => void;
  /** Pin, dismiss, mark asked, or back to active (US-04 AC4). */
  setFlagStatus: (id: string, status: ClientFlag['status']) => void;
  clearNewFlags: () => void;
  markFlagsSeen: () => void;
  /** A call starts: counts it and remembers which lines it covers. */
  beginAnalysis: (mode: AnalysisMode, upToLineIndex: number) => void;
  /** A call failed: the lines it covered count as new again, and automatic calls wait. */
  failAnalysis: (r: {
    mode: AnalysisMode;
    sessionId: string;
    prevIndex: number;
    error: AnalysisError | null;
    retryAt: number;
  }) => void;
  /** Applies a watch result, if it belongs to the current session. */
  applyWatch: (r: { sessionId: string; flags: ClientFlag[]; newFlagIds: string[] }) => void;
  /** Topic segments and questions answered in the conversation (ADR-21). */
  applyThreads: (r: {
    sessionId: string;
    segments: Segment[];
    answered: { id: string; quote: string }[];
    at: number;
  }) => void;
  setBackground: (b: string) => void;
  setPrep: (p: Prep | null) => void;
  setPreparing: (preparing: boolean, error?: string | null) => void;
  addQuestions: (r: { sessionId: string; questions: Omit<Question, 't'>[]; at: number }) => void;
  setAnswering: (id: string | null, error?: { id: string; message: string } | null) => void;
  setAnswer: (r: { sessionId: string; id: string; answer: Answer }) => void;
  /** Applies a summary result, if it belongs to the current session. */
  applySummary: (r: { sessionId: string; summary: Summary }) => void;
};

export type SessionState = { session: Session } & Runtime & Actions;

export function lastLanguage(): Language {
  return readString(KEYS.language) === 'ro-RO' ? 'ro-RO' : 'en-US';
}

export function emptySession(language: Language = lastLanguage(), now = Date.now()): Session {
  return {
    id: newId(),
    startedAt: now,
    language,
    context: '',
    lines: [],
    speakers: {},
    gaps: [],
    summary: null,
    flags: [],
    analyzedUpToLineIndex: 0,
    analysisCalls: 0,
    lastAnalysisAt: null,
    summaryUpToLineIndex: 0,
    lastSummaryAt: null,
    questions: [],
    topics: [],
    segments: [],
  };
}

function speakerIdFor(label: string): string {
  return 'm-' + label.trim().toLowerCase().replace(/\s+/g, '-');
}

export const DEFAULT_MAX_CALLS = 150;

const prepSchema = z.object({
  brief: z.string(),
  at: z.number(),
  questions: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      likely: z.string(),
      trap: z.string(),
      headline: z.string(),
      steps: z.array(
        z.object({ label: z.string(), detail: z.string(), why: z.string().optional() }),
      ),
    }),
  ),
  askBack: z.array(z.string()),
});

function loadPrep(): Prep | null {
  const parsed = prepSchema.safeParse(readJson(KEYS.prep));
  return parsed.success ? parsed.data : null;
}

const freshAnalysis = (maxCalls = DEFAULT_MAX_CALLS): AnalysisRuntime => ({
  running: false,
  summaryRunning: false,
  error: null,
  updatedAt: null,
  maxCalls,
  consecutiveErrors: 0,
  retryAt: 0,
  manualRequested: false,
  newFlagIds: [],
  unseenFlags: 0,
});

const saved = loadSession();
const resumable = hasContent(saved) ? saved : null;

export const useSession = create<SessionState>((set, get) => ({
  session: emptySession(),
  interim: null,
  listen: 'idle',
  listenError: null,
  pendingResume: resumable,
  analysis: freshAnalysis(),
  background: readString(KEYS.background) ?? '',
  prep: loadPrep(),
  preparing: false,
  prepError: null,
  answeringId: null,
  answerError: null,

  resume: () => {
    const p = get().pendingResume;
    if (p) set({ session: p, pendingResume: null });
  },
  startNew: () => {
    clearSession();
    const language = get().session.language;
    set((st) => ({
      session: emptySession(language),
      pendingResume: null,
      interim: null,
      analysis: freshAnalysis(st.analysis.maxCalls),
      answeringId: null,
      answerError: null,
    }));
  },
  setLanguage: (language) => {
    writeString(KEYS.language, language);
    set((s) => ({ session: { ...s.session, language } }));
  },
  setContext: (context) => set((s) => ({ session: { ...s.session, context } })),
  markStart: () => {
    const s = get().session;
    if (s.lines.length === 0 && s.summary === null) {
      set({ session: { ...s, startedAt: Date.now(), gaps: [] } });
    }
  },
  addLine: ({ text, origin, speakerLabel, t }) => {
    const clean = text.trim();
    if (!clean) return;
    set((st) => {
      const s = st.session;
      const speakers: Record<string, Speaker> = { ...s.speakers };
      let speakerId: string | undefined;
      if (speakerLabel?.trim()) {
        speakerId = speakerIdFor(speakerLabel);
        speakers[speakerId] ??= { id: speakerId, label: speakerLabel.trim(), source: 'manual' };
      }
      const line: Line = {
        id: newId(),
        t: Math.max(0, (t ?? Date.now()) - s.startedAt),
        text: clean,
        final: true,
        origin,
        ...(speakerId ? { speakerId } : {}),
      };
      return { session: { ...s, lines: [...s.lines, line], speakers } };
    });
  },
  setInterim: (interim) => set({ interim }),
  addGap: (g) => set((st) => ({ session: { ...st.session, gaps: [...st.session.gaps, g] } })),
  setListen: (listen, error = null) => set({ listen, listenError: error }),
  setAnalysis: (patch) => set((st) => ({ analysis: { ...st.analysis, ...patch } })),
  setFlagStatus: (id, status) =>
    set((st) => ({
      session: {
        ...st.session,
        flags: st.session.flags.map((f) => (f.id === id ? { ...f, status } : f)),
      },
    })),
  clearNewFlags: () => set((st) => ({ analysis: { ...st.analysis, newFlagIds: [] } })),
  markFlagsSeen: () => set((st) => ({ analysis: { ...st.analysis, unseenFlags: 0 } })),
  beginAnalysis: (mode, upToLineIndex) =>
    set((st) => ({
      session: {
        ...st.session,
        analysisCalls: st.session.analysisCalls + 1,
        ...(mode === 'watch'
          ? { lastAnalysisAt: Date.now(), analyzedUpToLineIndex: upToLineIndex }
          : { lastSummaryAt: Date.now(), summaryUpToLineIndex: upToLineIndex }),
      },
      analysis: {
        ...st.analysis,
        ...(mode === 'watch' ? { running: true } : { summaryRunning: true }),
        manualRequested: false,
      },
    })),
  failAnalysis: ({ mode, sessionId, prevIndex, error, retryAt }) =>
    set((st) => {
      const flag = mode === 'watch' ? { running: false } : { summaryRunning: false };
      if (st.session.id !== sessionId) return { analysis: { ...st.analysis, ...flag } };
      return {
        session: {
          ...st.session,
          ...(mode === 'watch'
            ? { analyzedUpToLineIndex: prevIndex }
            : { summaryUpToLineIndex: prevIndex }),
        },
        analysis: {
          ...st.analysis,
          ...flag,
          error,
          retryAt,
          consecutiveErrors: error
            ? st.analysis.consecutiveErrors + 1
            : st.analysis.consecutiveErrors,
        },
      };
    }),
  applyWatch: ({ sessionId, flags, newFlagIds }) =>
    set((st) => {
      if (st.session.id !== sessionId) return {};
      return {
        session: {
          ...st.session,
          flags,
          topics: withTopics(
            st.session.topics,
            flags.map((f) => f.topic),
          ),
        },
        analysis: {
          ...st.analysis,
          running: false,
          error: null,
          updatedAt: Date.now(),
          consecutiveErrors: 0,
          retryAt: 0,
          newFlagIds,
          unseenFlags: st.analysis.unseenFlags + newFlagIds.length,
        },
      };
    }),
  applyThreads: ({ sessionId, segments, answered, at }) =>
    set((st) => {
      if (st.session.id !== sessionId) return {};
      const s = st.session;
      const known = new Set(s.segments.map((g) => `${g.t}|${g.topic}`));
      const merged = [
        ...s.segments,
        ...segments.filter((g) => !known.has(`${g.t}|${g.topic}`)),
      ].sort((a, b) => a.t - b.t);
      const byId = new Map(answered.map((a) => [a.id, a.quote]));
      const t = Math.max(0, at - s.startedAt);
      return {
        session: {
          ...s,
          segments: merged,
          topics: withTopics(
            s.topics,
            segments.map((g) => g.topic),
          ),
          questions: s.questions.map((q) =>
            byId.has(q.id) && !q.answeredQuote
              ? { ...q, answeredQuote: byId.get(q.id), answeredAt: t }
              : q,
          ),
        },
      };
    }),
  setBackground: (background) => {
    writeString(KEYS.background, background);
    set({ background });
  },
  setPrep: (prep) => {
    if (prep) writeString(KEYS.prep, JSON.stringify(prep));
    else remove(KEYS.prep);
    set({ prep, prepError: null });
  },
  setPreparing: (preparing, prepError = null) => set({ preparing, prepError }),
  addQuestions: ({ sessionId, questions, at }) =>
    set((st) => {
      if (st.session.id !== sessionId || questions.length === 0) return {};
      const known = new Set(st.session.questions.map((q) => q.id));
      questions = questions.filter((q) => !known.has(q.id));
      if (questions.length === 0) return {};
      const t = Math.max(0, at - st.session.startedAt);
      // A question that matches a prepared one gets its answer at once (ADR-25).
      questions = questions.map((q) => {
        const p = q.prepared ? st.prep?.questions.find((x) => x.id === q.prepared) : undefined;
        if (!p || q.answer) return q.prepared && !p ? { ...q, prepared: undefined } : q;
        const answer: Answer = {
          question: p.question,
          trap: p.trap,
          headline: p.headline,
          steps: p.steps,
          explain: [],
        };
        return { ...q, answer };
      });
      return {
        session: {
          ...st.session,
          questions: [...st.session.questions, ...questions.map((q) => ({ ...q, t }))],
          topics: withTopics(
            st.session.topics,
            questions.map((q) => q.topic),
          ),
        },
      };
    }),
  setAnswering: (answeringId, answerError = null) => set({ answeringId, answerError }),
  setAnswer: ({ sessionId, id, answer }) =>
    set((st) => {
      if (st.session.id !== sessionId) return { answeringId: null };
      return {
        answeringId: null,
        answerError: null,
        session: {
          ...st.session,
          questions: st.session.questions.map((q) => (q.id === id ? { ...q, answer } : q)),
        },
      };
    }),
  applySummary: ({ sessionId, summary }) =>
    set((st) => {
      if (st.session.id !== sessionId) return {};
      return {
        session: {
          ...st.session,
          summary,
          topics: withTopics(
            st.session.topics,
            summary.topics.map((t) => t.topic),
          ),
        },
        analysis: {
          ...st.analysis,
          summaryRunning: false,
          error: null,
          updatedAt: Date.now(),
          consecutiveErrors: 0,
          retryAt: 0,
        },
      };
    }),
}));

/* Persistence: debounced 2 s (docs/02 §4), flushed when the page is hidden. */
let timer: ReturnType<typeof setTimeout> | null = null;
let lastSaved: Session | null = null;

function flush(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  const { session, pendingResume } = useSession.getState();
  // Do not overwrite a session the user has not yet chosen to resume or discard.
  if (pendingResume) return;
  if (session === lastSaved) return;
  lastSaved = session;
  if (hasContent(session) || session.context) saveSession(session);
  else clearSession();
}

useSession.subscribe((state, prev) => {
  if (state.session === prev.session) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, 2000);
});

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

export const __test = { flush };
