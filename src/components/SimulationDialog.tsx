import { useMemo, useState } from 'react';
import type { Language } from '../../shared/types';
import { parsePasted, SCRIPTS } from '../demo/scripts';
import { simulator, useSimulation } from '../demo/simulator';
import { Dialog } from './Dialog';

const OWN = 'own';

/** Lets the listener watch a conversation unfold step by step, with real analysis. */
export function SimulationDialog({ onClose }: { onClose: () => void }) {
  const [scriptId, setScriptId] = useState(SCRIPTS[0]?.id ?? '');
  const [speed, setSpeed] = useState(1);
  const [speakers, setSpeakers] = useState(true);
  const [ownText, setOwnText] = useState('');
  const [ownLang, setOwnLang] = useState<Language>('en-US');
  const own = scriptId === OWN;
  const ownLines = useMemo(() => (own ? parsePasted(ownText) : []), [own, ownText]);
  const last = ownLines[ownLines.length - 1];
  const ownMinutes = last ? Math.max(1, Math.round(last.t / 60_000)) : 0;

  const loadFile = async (file: File | undefined) => {
    if (file) setOwnText(await file.text());
  };

  const start = () => {
    const script = own
      ? { id: OWN, title: 'Your transcript', language: ownLang, lines: ownLines }
      : SCRIPTS.find((s) => s.id === scriptId);
    if (!script || script.lines.length === 0) return;
    simulator.start(script, { speed, speakers });
    onClose();
  };

  return (
    <Dialog title="Simulate a meeting" onClose={onClose}>
      <p>
        A conversation is played into the transcript line by line, as if it were being heard. The
        real analysis runs on it, so it uses analysis calls. The current meeting on screen is
        cleared.
      </p>
      <div className="field">
        <label htmlFor="sim-script">Conversation</label>
        <select id="sim-script" value={scriptId} onChange={(e) => setScriptId(e.target.value)}>
          {SCRIPTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
          <option value={OWN}>My own transcript (paste or load a file)</option>
        </select>
      </div>
      {own && (
        <>
          <div className="field">
            <label htmlFor="sim-own">Transcript to play</label>
            <textarea
              id="sim-own"
              rows={8}
              value={ownText}
              onChange={(e) => setOwnText(e.target.value)}
              placeholder={
                'One line per turn, for example:\nThem: How has your week been?\nMe: Busy, but good.'
              }
            />
            <p className="hint">
              {ownLines.length > 0
                ? `${ownLines.length} lines, about ${ownMinutes} min at real time.`
                : 'Accepts “Name: text” lines, with or without [mm:ss] times.'}{' '}
              It stays in this browser; nothing is uploaded except to the analysis.
            </p>
          </div>
          <div className="field">
            <label htmlFor="sim-file">Or load a .txt file</label>
            <input
              id="sim-file"
              type="file"
              accept=".txt,text/plain"
              onChange={(e) => void loadFile(e.target.files?.[0])}
            />
          </div>
          <div className="field">
            <label htmlFor="sim-lang">Meeting language</label>
            <select
              id="sim-lang"
              value={ownLang}
              onChange={(e) => setOwnLang(e.target.value as Language)}
            >
              <option value="en-US">English</option>
              <option value="ro-RO">Romanian</option>
            </select>
          </div>
        </>
      )}
      <div className="field">
        <label htmlFor="sim-speed">Speed</label>
        <select id="sim-speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          <option value={1}>Real time</option>
          <option value={2}>2× faster</option>
          <option value={4}>4× faster</option>
        </select>
      </div>
      <label className="row">
        <input type="checkbox" checked={speakers} onChange={(e) => setSpeakers(e.target.checked)} />
        Show speaker names (as with meeting captions; the microphone alone has none)
      </label>
      <div className="row">
        <button className="btn primary" onClick={start} disabled={own && ownLines.length === 0}>
          Start simulation
        </button>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

export function SimulationBanner() {
  const running = useSimulation((s) => s.running);
  if (!running) return null;
  return (
    <div className="banner info" role="status">
      Simulation: {running.title} · line {running.index} of {running.total}
      {running.speed > 1 ? ` · ${running.speed}×` : ''}
      <button className="btn small" onClick={() => simulator.stop()}>
        Stop simulation
      </button>
    </div>
  );
}
