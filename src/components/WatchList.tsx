import { useEffect, useState } from 'react';
import type { FlagType } from '../../shared/types';
import { useAuth } from '../store/auth';
import { useSession } from '../store/session';
import { Column } from './Column';
import { FlagCard } from './FlagCard';

type Filter = 'all' | FlagType;
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'trap', label: 'Traps' },
  { id: 'logic', label: 'Logic errors' },
  { id: 'question', label: 'Questions' },
];
const HIGHLIGHT_MS = 4000;

/** Watch list (US-04): newest first, filters, Pin / Dismiss / Mark asked, asked items at the bottom. */
export function WatchList({ hidden }: { hidden: boolean }) {
  const flags = useSession((s) => s.session.flags);
  const newIds = useSession((s) => s.analysis.newFlagIds);
  const setStatus = useSession((s) => s.setFlagStatus);
  const clearNew = useSession((s) => s.clearNewFlags);
  const canCall = useAuth((s) => !!s.passcode && !s.rejected);
  const [filter, setFilter] = useState<Filter>('all');
  const [undo, setUndo] = useState<{ id: string; title: string } | null>(null);

  useEffect(() => {
    if (!newIds.length) return;
    const t = setTimeout(clearNew, HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [newIds, clearNew]);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(t);
  }, [undo]);

  const live = flags
    .filter((f) => f.status === 'active' || f.status === 'pinned')
    .sort((a, b) => b.firstSeenAt - a.firstSeenAt);
  const asked = flags
    .filter((f) => f.status === 'asked')
    .sort((a, b) => b.firstSeenAt - a.firstSeenAt);
  const shown = live.filter((f) => filter === 'all' || f.type === filter);

  const onStatus = (id: string, title: string) => (status: (typeof flags)[number]['status']) => {
    setStatus(id, status);
    if (status === 'dismissed') setUndo({ id, title });
  };

  return (
    <Column
      id="watch"
      title="Watch list"
      count={live.length ? `${live.length} flagged` : ''}
      hidden={hidden}
      headExtra={
        <div className="filters" role="group" aria-label="Filter">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className="chip"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="scroll">
        {undo && (
          <div className="banner info" role="status">
            Dismissed “{undo.title}”. It will not be raised again.
            <button
              className="btn small"
              onClick={() => {
                setStatus(undo.id, 'active');
                setUndo(null);
              }}
            >
              Undo
            </button>
          </div>
        )}
        {shown.length === 0 ? (
          <div className="empty">
            {live.length
              ? 'Nothing in this category yet.'
              : canCall
                ? 'Traps, logic errors and questions worth asking appear here, each with the exact words that triggered it.'
                : 'Analysis is off on this device. Open Menu → Enter passcode to get the watch list.'}
          </div>
        ) : (
          shown.map((f, i) => (
            <FlagCard
              featured={i === 0 && filter === 'all' && f.status !== 'pinned'}
              key={f.id}
              flag={f}
              isNew={newIds.includes(f.id)}
              onStatus={onStatus(f.id, f.title)}
            />
          ))
        )}
        {asked.length > 0 && (
          <details className="asked-section">
            <summary>Asked ({asked.length})</summary>
            {asked.map((f) => (
              <FlagCard key={f.id} flag={f} isNew={false} onStatus={onStatus(f.id, f.title)} />
            ))}
          </details>
        )}
      </div>
    </Column>
  );
}
