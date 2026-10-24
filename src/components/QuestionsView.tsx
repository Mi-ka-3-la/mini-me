import { answerQuestion } from '../analysis/runner';
import { mmss } from '../lib/time';
import { TopicChip } from './TopicChip';
import { useAuth } from '../store/auth';
import { useSession } from '../store/session';
import type { Answer } from '../store/types';

/** One answer, laid out as a chain of short steps that can be read at a glance (ADR-20). */
export function AnswerPlan({ a }: { a: Answer }) {
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
              {st.why && <span className="step-why">Why: {st.why}</span>}
            </span>
          </li>
        ))}
      </ol>
      {a.explain && a.explain.length > 0 && (
        <details className="explain">
          <summary>Understand it</summary>
          {a.explain.map((x, i) => (
            <section key={i} className="explain-section">
              <div className="explain-label">{x.label}</div>
              <h4>{x.title}</h4>
              <p>{x.body}</p>
            </section>
          ))}
        </details>
      )}
    </div>
  );
}

/** Questions asked in the meeting, newest first. Answers are prepared only on tap. */
export function QuestionsView() {
  const questions = useSession((s) => s.session.questions);
  const answeringId = useSession((s) => s.answeringId);
  const answerError = useSession((s) => s.answerError);
  const background = useSession((s) => s.background);
  const prepCount = useSession((s) => s.prep?.questions.length ?? 0);
  const canCall = useAuth((s) => !!s.passcode && !s.rejected);
  const list = [...questions].reverse();

  if (list.length === 0) {
    return (
      <div className="empty">
        Questions asked in the meeting appear here, rewritten clearly. Tap <b>Answer</b> to get a
        short plan to answer it, with any trap in the question named.
        {prepCount > 0 && (
          <p>
            {prepCount} prepared answers are ready. When one of those questions is asked, its answer
            shows here at once.
          </p>
        )}
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
              {q.prepared && <span className="q-status prepared">Prepared</span>}
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
            <>
              <AnswerPlan a={q.answer} />
              {q.prepared && !q.answer.explain?.length && (
                <div className="row">
                  <button
                    className="btn small"
                    disabled={!canCall || answeringId !== null}
                    onClick={() => void answerQuestion(q.id)}
                  >
                    {answeringId === q.id ? 'Explaining…' : 'Explain it'}
                  </button>
                  <span className="hint">
                    Answers it again with this conversation and “Understand it”.
                  </span>
                </div>
              )}
            </>
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
