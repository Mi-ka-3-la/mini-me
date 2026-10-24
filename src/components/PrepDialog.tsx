import { useState } from 'react';
import { prepareMeeting } from '../analysis/runner';
import { useAuth } from '../store/auth';
import { useSession } from '../store/session';
import { Dialog } from './Dialog';
import { AnswerPlan } from './QuestionsView';

/**
 * Prepare for a meeting (ADR-25): the likely questions, answered in advance, so an answer is on
 * screen the moment a matching question is asked. Kept on this device until cleared.
 */
export function PrepDialog({ onClose }: { onClose: () => void }) {
  const prep = useSession((s) => s.prep);
  const preparing = useSession((s) => s.preparing);
  const prepError = useSession((s) => s.prepError);
  const background = useSession((s) => s.background);
  const language = useSession((s) => s.session.language);
  const setPrep = useSession((s) => s.setPrep);
  const canCall = useAuth((s) => !!s.passcode && !s.rejected);
  const [brief, setBrief] = useState(prep?.brief ?? '');

  return (
    <Dialog title="Prepare for a meeting" onClose={onClose}>
      <p>
        Paste what the meeting is about: a job ad, an agenda, notes. The likely questions get
        answers now, built from “My background”, so during the meeting they appear the moment the
        question is asked. One analysis call, about a minute.
      </p>
      <div className="field">
        <label htmlFor="prep-brief">What the meeting is about</label>
        <textarea
          id="prep-brief"
          rows={7}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Job description, agenda, the company, what you want from the meeting…"
        />
        <p className="hint">
          Language: {language === 'ro-RO' ? 'Romanian' : 'English'} (set in Meeting language).{' '}
          {background.trim()
            ? 'Uses My background.'
            : 'My background is empty, so answers will be general. Fill it in first.'}
        </p>
      </div>
      <div className="row">
        <button
          className="btn primary"
          disabled={!canCall || preparing || !brief.trim()}
          onClick={() => void prepareMeeting(brief)}
        >
          {preparing ? 'Preparing… (about a minute)' : prep ? 'Prepare again' : 'Prepare'}
        </button>
        {prep && !preparing && (
          <button className="btn" onClick={() => setPrep(null)}>
            Clear preparation
          </button>
        )}
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
      {!canCall && <p className="hint">Needs the passcode.</p>}
      {prepError && (
        <p className="err" role="alert">
          {prepError}
        </p>
      )}
      {prep && (
        <section className="prep-list" aria-label="Prepared questions">
          <h3>Likely questions ({prep.questions.length})</h3>
          {prep.questions.map((q) => (
            <details key={q.id} className="prep-q">
              <summary>{q.question}</summary>
              {q.likely && <p className="prep-likely">Why it is likely: {q.likely}</p>}
              <AnswerPlan
                a={{
                  question: q.question,
                  trap: q.trap,
                  headline: q.headline,
                  steps: q.steps,
                }}
              />
            </details>
          ))}
          {prep.askBack.length > 0 && (
            <>
              <h3>Questions to ask them</h3>
              <ul className="prep-askback">
                {prep.askBack.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </Dialog>
  );
}
