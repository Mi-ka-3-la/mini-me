import { useState } from 'react';
import { SCRIPTS } from '../demo/scripts';
import { simulator, useSimulation } from '../demo/simulator';
import { Dialog } from './Dialog';

/** Lets the listener watch a sample conversation unfold step by step, with real analysis. */
export function SimulationDialog({ onClose }: { onClose: () => void }) {
  const [scriptId, setScriptId] = useState(SCRIPTS[0]?.id ?? '');
  const [speed, setSpeed] = useState(1);
  const [speakers, setSpeakers] = useState(true);
  const start = () => {
    const script = SCRIPTS.find((s) => s.id === scriptId);
    if (script) simulator.start(script, { speed, speakers });
    onClose();
  };
  return (
    <Dialog title="Simulate a meeting" onClose={onClose}>
      <p>
        A sample conversation is played into the transcript line by line, as if it were being heard.
        The real analysis runs on it, so it uses analysis calls. The current meeting on screen is
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
        </select>
      </div>
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
        <button className="btn primary" onClick={start}>
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
