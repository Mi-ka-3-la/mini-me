import { LANGUAGES, type Language } from '../../shared/types';
import { MAX_BACKGROUND } from '../../shared/schema';
import { isWakeLockSupported } from '../audio/wakeLock';
import { isWebSpeechSupported } from '../audio/webSpeech';
import { useState } from 'react';
import { NARROW, useMediaQuery } from '../lib/useMediaQuery';
import { useSession } from '../store/session';

export const CONTEXT_MAX = 2000;

/** Language, meeting context and the reminders shown before and during a session (US-01, US-06). */
export function SetupStrip() {
  const language = useSession((s) => s.session.language);
  const context = useSession((s) => s.session.context);
  const status = useSession((s) => s.listen);
  const setLanguage = useSession((s) => s.setLanguage);
  const setContext = useSession((s) => s.setContext);
  const background = useSession((s) => s.background);
  const setBackground = useSession((s) => s.setBackground);
  const active = status === 'listening' || status === 'reconnecting' || status === 'starting';
  const narrow = useMediaQuery(NARROW);
  const [expanded, setExpanded] = useState(false);
  // While listening on a tablet or phone, the setup collapses to one line to leave room for the columns.
  if (narrow && active && !expanded) {
    return (
      <section className="setup compact" aria-label="Meeting setup">
        <span className="hint">
          {LANGUAGES.find((l) => l.id === language)?.label}
          {context.trim() ? ' · context set' : ''}
        </span>
        <button className="btn small" onClick={() => setExpanded(true)}>
          Show setup
        </button>
        <span className="reminder">Let participants know this meeting is being transcribed.</span>
      </section>
    );
  }
  return (
    <section className="setup" aria-label="Meeting setup">
      <div className="field">
        <label htmlFor="language">Meeting language</label>
        <select
          id="language"
          value={language}
          disabled={active}
          onChange={(e) => setLanguage(e.target.value as Language)}
        >
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <span className="hint">One language per meeting. Mixed speech is transcribed poorly.</span>
      </div>
      <div className="field grow">
        <label htmlFor="context">Context (optional)</label>
        <textarea
          id="context"
          rows={1}
          maxLength={CONTEXT_MAX}
          placeholder="Goal, agenda, what you care about. E.g. “I need a firm go-live date and owner for tax rules.”"
          value={context}
          onChange={(e) => setContext(e.target.value)}
        />
        <span className="reminder">Let participants know this meeting is being transcribed.</span>
      </div>
      <div className="field grow">
        <label htmlFor="background">My background (for answers)</label>
        <textarea
          id="background"
          rows={1}
          maxLength={MAX_BACKGROUND}
          placeholder="A few lines about you: roles, projects, strengths. Used only when you tap Answer on a question. Kept on this device."
          value={background}
          onChange={(e) => setBackground(e.target.value)}
        />
      </div>
      {narrow && active && (
        <button className="btn small" onClick={() => setExpanded(false)}>
          Hide setup
        </button>
      )}
      {isWebSpeechSupported() && !isWakeLockSupported() && (
        <span className="hint">
          This browser cannot keep the screen on. Keep it awake yourself.
        </span>
      )}
    </section>
  );
}
