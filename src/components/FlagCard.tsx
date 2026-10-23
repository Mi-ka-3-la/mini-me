import { useState } from 'react';
import { KIND } from '../lib/labels';
import { TopicChip } from './TopicChip';
import type { ClientFlag } from '../store/types';

type Props = {
  flag: ClientFlag;
  isNew: boolean;
  onStatus: (status: ClientFlag['status']) => void;
  /** The newest flag: shown as "Ask now", question first, everything open. */
  featured?: boolean;
};

/** One watch-list item (US-04 AC1): type, title, exact quote, why it matters, what to ask, who. */
export function FlagCard({ flag, isNew, onStatus, featured = false }: Props) {
  // While listening, the reader needs the title and the question; "why" is one tap away.
  const [open, setOpen] = useState(false);
  const showWhy = featured || open;
  const cls = `flag ${flag.type}${isNew ? ' new' : ''}${flag.status === 'pinned' ? ' pinned' : ''}${flag.status === 'asked' ? ' asked' : ''}${featured ? ' featured' : ''}`;
  return (
    <article
      className={cls}
      aria-label={`${KIND[flag.type]}: ${flag.title}`}
      data-flag-id={flag.id}
    >
      <div className="kind-row">
        <div className="kind">
          {featured && (
            <span className="ask-now">
              {flag.type === 'important' ? 'Newest · ' : 'Ask now · '}
            </span>
          )}
          {KIND[flag.type]}
          {flag.who && <span className="who"> · {flag.who}</span>}
          {flag.status === 'pinned' && (
            <span className="pin-mark" aria-label="Pinned">
              📌
            </span>
          )}
        </div>
        <TopicChip name={flag.topic} />
      </div>
      <div className="title">{flag.title}</div>
      {flag.ask && (
        <div className="ask">
          <b>Ask:</b> {flag.ask}
        </div>
      )}
      {flag.quote && <q>{flag.quote}</q>}
      {showWhy ? (
        <div className="why">{flag.why}</div>
      ) : (
        <button className="btn link small why-toggle" onClick={() => setOpen(true)}>
          Why?
        </button>
      )}
      <div className="flag-actions">
        {flag.status === 'asked' ? (
          <button className="btn small" onClick={() => onStatus('active')}>
            Move back
          </button>
        ) : (
          <>
            <button
              className="btn small"
              aria-pressed={flag.status === 'pinned'}
              onClick={() => onStatus(flag.status === 'pinned' ? 'active' : 'pinned')}
            >
              {flag.status === 'pinned' ? 'Unpin' : 'Pin'}
            </button>
            <button className="btn small" onClick={() => onStatus('asked')}>
              Mark asked
            </button>
            <button className="btn small" onClick={() => onStatus('dismissed')}>
              Dismiss
            </button>
          </>
        )}
      </div>
    </article>
  );
}
