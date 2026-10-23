import { answerQuestion } from '../analysis/runner';
import { mmss } from '../lib/time';
import { TopicChip } from './TopicChip';
import { useAuth } from '../store/auth';
import { useSession } from '../store/session';
import type { Question } from '../store/types';

/** One answer, laid out as a chain of short steps that can be read at a glance (ADR-20). */
function AnswerPlan({ q }: { q: Question }) {
  const a = q.answer;
  if (!a) return null;
  return (
    <div className="answer" aria-label="Suggested answer">
      {a.trap && (
        <div className="answer-trap">
          <b>Trap</b> {a.trap}
        </div>
      )}
      <div className="answer-headline">{a.headline}</div>
      <ol className="answer-steps">
        {a.steps.map((st, i) => (
          <li key={i}>
            <span className="step-no" aria-hidden="true">
              {i + 1}
            </span>
            <span className="step-body">
              <b>{st.label}</b>
              <span>{st.detail}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Questions asked in the meeting, newest first. Answers are prepared only on tap. */
export function QuestionsView() {
  const questions = useSession((s) => s.session.questions);
  const answeringId = useSession((s) => s.answeringId);
  const answerError = useSession((s) => s.answerError);
  const background = useSession((s) => s.background);
  const canCall = useAuth((s) => !!s.passcode && !s.rejected);
  const list = [...questions].reverse();

  if (list.length === 0) {
    return (
      <div className="empty">
        Questions asked in the meeting appear here, rewritten clearly. Tap <b>Answer</b> to get a
        short plan to answer it, with any trap in the question named.
        {!background.trim() && (
          <p>
            Add a few lines about yourself in “My background” above, so answers use your experience.
          </p>
        )}
      </div>
    );
  }
  return (
    <>
      {list.map((q, i) => (
        <article
          key={q.id}
          className={`question${i === 0 ? ' latest' : ''}${q.answeredQuote ? ' answered-in-talk' : ''}`}
          aria-label={`Question: ${q.question}`}
        >
          <div className="kind-row">
            <div className="kind">
              Question <span className="who">· {mmss(q.t)}</span>
              <span className={`q-status ${q.answeredQuote ? 'answered' : 'open'}`}>
                {q.answeredQuote ? 'Answered' : 'Open'}
              </span>
            </div>
            <TopicChip name={q.topic} />
          </div>
          <div className="question-text">{q.question}</div>
          <q>{q.quote}</q>
          {q.answeredQuote && (
            <div className="answered-quote">
              <b>Answered{q.answeredAt !== undefined ? ` at ${mmss(q.answeredAt)}` : ''}:</b> “
              {q.answeredQuote}”
            </div>
          )}
          {q.answer ? (
            <AnswerPlan q={q} />
          ) : (
            <div className="row">
              <button
                className="btn small primary"
                disabled={!canCall || answeringId !== null}
                onClick={() => void answerQuestion(q.id)}
              >
                {answeringId === q.id ? 'Preparing answer…' : 'Answer'}
              </button>
              {!canCall && <span className="hint">Needs the passcode.</span>}
            </div>
          )}
          {answerError?.id === q.id && (
            <p className="err" role="alert">
              {answerError.message}
            </p>
          )}
        </article>
      ))}
    </>
  );
}
