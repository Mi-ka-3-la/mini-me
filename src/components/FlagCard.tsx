import type { FlagType } from '../../shared/types';
import type { ClientFlag } from '../store/types';

export const KIND: Record<FlagType, string> = {
  trap: 'Trap',
  logic: 'Logic error',
  question: 'Ask this',
};

type Props = {
  flag: ClientFlag;
  isNew: boolean;
  onStatus: (status: ClientFlag['status']) => void;
};

/** One watch-list item (US-04 AC1): type, title, exact quote, why it matters, what to ask, who. */
export function FlagCard({ flag, isNew, onStatus }: Props) {
  const cls = `flag ${flag.type}${isNew ? ' new' : ''}${flag.status === 'pinned' ? ' pinned' : ''}${flag.status === 'asked' ? ' asked' : ''}`;
  return (
    <article
      className={cls}
      aria-label={`${KIND[flag.type]}: ${flag.title}`}
      data-flag-id={flag.id}
    >
      <div className="kind">
        {KIND[flag.type]}
        {flag.who && <span className="who"> · {flag.who}</span>}
        {flag.status === 'pinned' && (
          <span className="pin-mark" aria-label="Pinned">
            📌
          </span>
        )}
      </div>
      <div className="title">{flag.title}</div>
      {flag.quote && <q>{flag.quote}</q>}
      <div className="why">{flag.why}</div>
      {flag.ask && (
        <div className="ask">
          <b>Ask:</b> {flag.ask}
        </div>
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
