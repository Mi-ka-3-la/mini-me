// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseScript, SCRIPTS } from '../../src/demo/scripts';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('simulation', () => {
  it('parses scripts with speakers and times', () => {
    expect(parseScript('[01:05] Dan (Tech lead): Salut.\n\n[01:10] fara nume')).toEqual([
      { t: 65_000, speaker: 'Dan (Tech lead)', text: 'Salut.' },
      { t: 70_000, text: 'fara nume' },
    ]);
    expect(SCRIPTS.every((s) => s.lines.length > 20)).toBe(true);
  });

  it('plays lines word by word, then as final lines, and stops at the end', async () => {
    const { simulator, useSimulation } = await import('../../src/demo/simulator');
    const { useSession } = await import('../../src/store/session');
    const script = {
      id: 't',
      title: 'T',
      language: 'ro-RO' as const,
      lines: [
        { t: 0, speaker: 'Ana', text: 'unu doi trei' },
        { t: 4000, text: 'patru' },
      ],
    };
    simulator.start(script, { speed: 2, speakers: true });
    expect(useSession.getState().listen).toBe('listening');
    expect(useSession.getState().session.language).toBe('ro-RO');
    vi.advanceTimersByTime(250);
    expect(useSession.getState().interim?.text).toBe('unu doi');
    vi.advanceTimersByTime(400);
    const s = useSession.getState().session;
    expect(s.lines.map((l) => l.text)).toEqual(['unu doi trei']);
    expect(s.speakers[s.lines[0]!.speakerId!]?.label).toBe('Ana');
    vi.advanceTimersByTime(5000);
    expect(useSession.getState().session.lines).toHaveLength(2);
    expect(useSimulation.getState().running).toBeNull();
    expect(useSession.getState().listen).toBe('idle');
  });
});
