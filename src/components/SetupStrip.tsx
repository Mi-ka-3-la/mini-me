import { LANGUAGES, type Language } from '../../shared/types';
import { isWakeLockSupported } from '../audio/wakeLock';
import { isWebSpeechSupported } from '../audio/webSpeech';
import { useSession } from '../store/session';

export const CONTEXT_MAX = 2000;

/** Language, meeting context and the reminders shown before and during a session (US-01, US-06). */
export function SetupStrip() {
  const language = useSession((s) => s.session.language);
  const context = useSession((s) => s.session.context);
  const status = useSession((s) => s.listen);
  const setLanguage = useSession((s) => s.setLanguage);
  const setContext = useSession((s) => s.setContext);
  const active = status === 'listening' || status === 'reconnecting' || status === 'starting';
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
      {isWebSpeechSupported() && !isWakeLockSupported() && (
        <span className="hint">
          This browser cannot keep the screen on. Keep it awake yourself.
        </span>
      )}
    </section>
  );
}
