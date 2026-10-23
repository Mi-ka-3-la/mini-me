import { useAuth } from '../store/auth';
import { useSession } from '../store/session';
import { Column } from './Column';
import { topicSlot } from '../lib/topics';

function Items({ items, tag, label }: { items: string[]; tag?: string; label?: string }) {
  return (
    <>
      {items.map((x, i) => (
        <li key={`${tag ?? 'p'}-${i}`}>
          {tag && <span className={`tag ${tag}`}>{label}</span>}
          {x}
        </li>
      ))}
    </>
  );
}

/**
 * Running summary (US-03). The last good summary stays until the next one arrives,
 * so there is no flicker and no empty state between updates (AC5).
 */
export function SummaryColumn({ hidden }: { hidden: boolean }) {
  const summary = useSession((s) => s.session.summary);
  const topics = useSession((s) => s.session.topics);
  const running = useSession((s) => s.analysis.summaryRunning);
  const lang = useSession((s) => s.session.language);
  const canCall = useAuth((s) => !!s.passcode && !s.rejected);
  const empty = !summary || (!summary.tldr && summary.topics.length === 0);
  const count = summary?.topics.length
    ? `${summary.topics.length} ${summary.topics.length === 1 ? 'topic' : 'topics'}`
    : '';
  return (
    <Column
      id="summary"
      title="Running summary"
      count={running ? `${count}${count ? ' · ' : ''}updating…` : count}
      hidden={hidden}
    >
      <div className="scroll" lang={lang.slice(0, 2)} aria-busy={running}>
        {empty ? (
          <div className="empty">
            {canCall
              ? 'The summary builds here by topic once there is something to summarize: what was said, decisions, actions and what is still open.'
              : 'Analysis is off on this device. Open Menu → Enter passcode to get a running summary.'}
          </div>
        ) : (
          <>
            {summary.tldr && (
              <div className="tldr">
                <b>So far</b>
                {summary.tldr}
              </div>
            )}
            {summary.topics.map((t, i) => (
              <div
                className="topic"
                key={`${i}-${t.topic}`}
                data-topic={topicSlot(topics, t.topic) ?? undefined}
              >
                <h3>{t.topic}</h3>
                <ul>
                  <Items items={t.points} />
                  <Items items={t.decisions} tag="dec" label="Decided" />
                  <Items items={t.actions} tag="act" label="Action" />
                  <Items items={t.open} tag="open" label="Open" />
                </ul>
              </div>
            ))}
          </>
        )}
      </div>
    </Column>
  );
}
