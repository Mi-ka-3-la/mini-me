import { useEffect, useState } from 'react';
import { analysisRunner } from '../analysis/runner';
import { errorText } from '../analysis/client';
import { clockTime } from '../lib/time';
import { useAuth } from '../store/auth';
import { useSession } from '../store/session';

/** "Analyze now" and the visible per-session call counter (docs/01 §7 Cost). */
export function AnalysisControls() {
  const running = useSession((s) => s.analysis.running);
  const calls = useSession((s) => s.session.analysisCalls);
  const max = useSession((s) => s.analysis.maxCalls);
  const canCall = useAuth((s) => !!s.passcode && !s.rejected);
  const hasText = useSession((s) => s.session.lines.length > s.session.analyzedUpToLineIndex);
  return (
    <>
      <span className="counter" title="Analysis calls this meeting" data-testid="call-counter">
        {calls}/{max}
        <span className="wide-only"> analyses</span>
      </span>
      <button
        className="btn"
        onClick={() => analysisRunner.requestNow()}
        disabled={!canCall || running || !hasText}
        title={
          !canCall ? 'Enter the passcode to analyze' : !hasText ? 'Nothing new to analyze' : ''
        }
      >
        {running ? 'Analyzing…' : 'Analyze now'}
      </button>
    </>
  );
}

export function AnalysisStatus() {
  const updatedAt = useSession((s) => s.analysis.updatedAt);
  const running = useSession((s) => s.analysis.running);
  if (running) return <span className="status wide-only">· analyzing…</span>;
  if (!updatedAt) return null;
  return <span className="status wide-only">· updated {clockTime(updatedAt)}</span>;
}

function useSecondsUntil(at: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (at <= now) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [at, now]);
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/** Analysis errors never clear the screen (NFR reliability); this says what happened. */
export function AnalysisBanner() {
  const error = useSession((s) => s.analysis.error);
  const retryAt = useSession((s) => s.analysis.retryAt);
  const calls = useSession((s) => s.session.analysisCalls);
  const max = useSession((s) => s.analysis.maxCalls);
  const rejected = useAuth((s) => s.rejected);
  const reopenGate = useAuth((s) => s.reopenGate);
  const secs = useSecondsUntil(retryAt);
  if (rejected) {
    return (
      <div className="banner error" role="alert">
        The passcode was refused. Analysis is paused; the transcript keeps running.
        <button className="btn small" onClick={reopenGate}>
          Enter passcode
        </button>
      </div>
    );
  }
  if (error) {
    return (
      <div className="banner error" role="alert">
        {errorText({ status: 0, ...error }, secs)}
      </div>
    );
  }
  if (calls >= max) {
    return (
      <div className="banner" role="note">
        Automatic analysis stopped after {max} calls this meeting. “Analyze now” still works.
      </div>
    );
  }
  return null;
}
