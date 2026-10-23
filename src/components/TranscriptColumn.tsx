import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { parseManual } from '../lib/parseManual';
import { mmss } from '../lib/time';
import { useSession } from '../store/session';
import type { Gap, Line } from '../store/types';
import { Column } from './Column';

type Item = { kind: 'line'; line: Line } | { kind: 'gap'; gap: Gap };

function interleave(lines: Line[], gaps: Gap[]): Item[] {
  const items: Item[] = lines.map((line) => ({ kind: 'line', line }));
  for (const gap of gaps) {
    let i = items.findIndex((it) => it.kind === 'line' && it.line.t > gap.t);
    if (i < 0) i = items.length;
    items.splice(i, 0, { kind: 'gap', gap });
  }
  return items;
}

export function TranscriptColumn({ hidden }: { hidden: boolean }) {
  const lines = useSession((s) => s.session.lines);
  const gaps = useSession((s) => s.session.gaps);
  const speakers = useSession((s) => s.session.speakers);
  const interim = useSession((s) => s.interim);
  const addLine = useSession((s) => s.addLine);
  const markStart = useSession((s) => s.markStart);
  const [draft, setDraft] = useState('');
  const [stick, setStick] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);

  // Auto-scroll to the newest line unless the user scrolled up to read (US-02 AC3).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick) el.scrollTop = el.scrollHeight;
  }, [lines.length, interim, stick, hidden]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  function add() {
    const parsed = parseManual(draft);
    if (!parsed.length) return;
    markStart();
    const now = Date.now();
    for (const p of parsed)
      addLine({ text: p.text, origin: 'manual', speakerLabel: p.speaker, t: now });
    setDraft('');
    setStick(true);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      add();
    }
  }

  const items = interleave(lines, gaps);
  return (
    <Column
      id="transcript"
      title="Live transcript"
      count={lines.length ? `${lines.length} lines` : ''}
      hidden={hidden}
    >
      <div className="scroll" ref={scroller} data-testid="transcript-scroll">
        {items.length === 0 && !interim?.text ? (
          <div className="empty">
            Nothing yet. Press <b>Start listening</b>, or paste captions below. Speakers are kept
            when a line starts with “Name:”.
          </div>
        ) : (
          items.map((it) =>
            it.kind === 'gap' ? (
              <div className="gap" key={`g-${it.gap.t}`}>
                — not listening for {Math.round(it.gap.ms / 1000)} s at {mmss(it.gap.t)} —
              </div>
            ) : (
              <Fragment key={it.line.id}>
                <div className={`line${it.line.origin === 'manual' ? ' manual' : ''}`}>
                  <span className="ts">{mmss(it.line.t)}</span>
                  <span className="txt">
                    {it.line.speakerId && speakers[it.line.speakerId] && (
                      <span className="spk">{speakers[it.line.speakerId]?.label}</span>
                    )}
                    {it.line.text}
                  </span>
                </div>
              </Fragment>
            ),
          )
        )}
        {interim?.text && (
          <div className="line interim" aria-live="off">
            <span className="ts">…</span>
            <span className="txt">{interim.text}</span>
          </div>
        )}
      </div>
      {!stick && (
        <button
          className="btn small primary jump"
          onClick={() => {
            setStick(true);
            const el = scroller.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
        >
          Jump to live
        </button>
      )}
      <div className="feed">
        <label htmlFor="feed" className="sr-only">
          Paste captions or type notes
        </label>
        <textarea
          id="feed"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder={
            'Paste captions (Teams / Zoom / Meet) or type what was said.\nUse “Name: text” per line to keep speakers.'
          }
        />
        <div className="feedrow">
          <button className="btn primary" onClick={add} disabled={!draft.trim()}>
            Add to transcript
          </button>
          <span className="hint">Ctrl/Cmd + Enter adds. Only new lines are needed each time.</span>
        </div>
      </div>
    </Column>
  );
}
