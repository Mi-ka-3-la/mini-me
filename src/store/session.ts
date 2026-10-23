import { create } from 'zustand';
import type { Language } from '../../shared/types';
import { newId } from '../lib/ids';
import { KEYS, readString, writeString } from '../lib/storage';
import { clearSession, hasContent, loadSession, saveSession } from './persist';
import type { ClientFlag, Gap, Interim, Line, Session, Speaker, Summary } from './types';

export type ListenStatus = 'idle' | 'starting' | 'listening' | 'reconnecting' | 'error';

/** Runtime-only state: never persisted. */
type Runtime = {
  interim: Interim;
  listen: ListenStatus;
  listenError: string | null;
  /** A saved session found at load, waiting for the user's "Resume meeting?" answer. */
  pendingResume: Session | null;
  analysis: AnalysisRuntime;
};

export type AnalysisError = { code: string; message: string };

export type AnalysisRuntime = {
  running: boolean;
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
  beginAnalysis: (upToLineIndex: number) => void;
  /** A call failed: the lines it covered count as new again, and automatic calls wait. */
  failAnalysis: (r: {
    sessionId: string;
    prevIndex: number;
    error: AnalysisError | null;
    retryAt: number;
  }) => void;
  /** Applies a successful result, if it belongs to the current session. */
  applyAnalysis: (r: {
    sessionId: string;
    upToLineIndex: number;
    summary: Summary;
    flags: ClientFlag[];
    newFlagIds: string[];
  }) => void;
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
  };
}

function speakerIdFor(label: string): string {
  return 'm-' + label.trim().toLowerCase().replace(/\s+/g, '-');
}

export const DEFAULT_MAX_CALLS = 150;

const freshAnalysis = (maxCalls = DEFAULT_MAX_CALLS): AnalysisRuntime => ({
  running: false,
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
  beginAnalysis: (upToLineIndex) =>
    set((st) => ({
      session: {
        ...st.session,
        analysisCalls: st.session.analysisCalls + 1,
        lastAnalysisAt: Date.now(),
        analyzedUpToLineIndex: upToLineIndex,
      },
      analysis: { ...st.analysis, running: true, manualRequested: false },
    })),
  failAnalysis: ({ sessionId, prevIndex, error, retryAt }) =>
    set((st) => {
      if (st.session.id !== sessionId) return { analysis: { ...st.analysis, running: false } };
      return {
        session: { ...st.session, analyzedUpToLineIndex: prevIndex },
        analysis: {
          ...st.analysis,
          running: false,
          error,
          retryAt,
          consecutiveErrors: error
            ? st.analysis.consecutiveErrors + 1
            : st.analysis.consecutiveErrors,
        },
      };
    }),
  applyAnalysis: ({ sessionId, summary, flags, newFlagIds }) =>
    set((st) => {
      if (st.session.id !== sessionId) return {};
      return {
        session: { ...st.session, summary, flags },
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
