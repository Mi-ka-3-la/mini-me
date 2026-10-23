import { create } from 'zustand';
import { useSession } from '../store/session';
import type { Script } from './scripts';

type SimState = {
  running: { title: string; index: number; total: number; speed: number } | null;
};

export const useSimulation = create<SimState>(() => ({ running: null }));

/** Words appear at roughly speaking pace (150 words per minute), faster with speed. */
const WORDS_PER_SEC = 2.5;

/**
 * Plays a script into the transcript line by line, the way live recognition would:
 * words appear as interim text, then the line becomes final. The real analysis runs on it.
 */
class Simulator {
  private timers: ReturnType<typeof setTimeout>[] = [];

  start(script: Script, opts: { speed: number; speakers: boolean }): void {
    this.stop();
    const store = useSession.getState();
    store.startNew();
    store.setLanguage(script.language);
    store.markStart();
    store.setListen('listening');
    useSimulation.setState({
      running: { title: script.title, index: 0, total: script.lines.length, speed: opts.speed },
    });
    const startedAt = Date.now();
    useSession.setState((st) => ({ session: { ...st.session, startedAt } }));

    script.lines.forEach((line, i) => {
      const lineStart = line.t / opts.speed;
      const words = line.text.split(/\s+/);
      const wordMs = 1000 / (WORDS_PER_SEC * opts.speed);
      words.forEach((_, w) => {
        this.at(lineStart + w * wordMs, () =>
          useSession.getState().setInterim({ text: words.slice(0, w + 1).join(' ') }),
        );
      });
      this.at(lineStart + words.length * wordMs, () => {
        const st = useSession.getState();
        st.setInterim(null);
        st.addLine({
          text: line.text,
          origin: 'stt',
          t: startedAt + line.t / opts.speed,
          ...(opts.speakers && line.speaker ? { speakerLabel: line.speaker } : {}),
        });
        useSimulation.setState((s) =>
          s.running ? { running: { ...s.running, index: i + 1 } } : s,
        );
        if (i === script.lines.length - 1) this.finish();
      });
    });
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (useSimulation.getState().running) this.finish();
  }

  private finish(): void {
    useSimulation.setState({ running: null });
    const st = useSession.getState();
    st.setInterim(null);
    st.setListen('idle');
  }

  private at(ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms));
  }
}

export const simulator = new Simulator();
