import { beforeEach, describe, expect, it } from 'vitest';
import {
  WebSpeechTranscriber,
  type RecErrorEvent,
  type RecResultEvent,
  type RecognitionLike,
} from '../../src/audio/webSpeech';

class FakeRec implements RecognitionLike {
  static last: FakeRec | null = null;
  static instances = 0;
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onresult: ((e: RecResultEvent) => void) | null = null;
  onerror: ((e: RecErrorEvent) => void) | null = null;
  starts = 0;
  running = false;
  constructor() {
    FakeRec.last = this;
    FakeRec.instances++;
  }
  start() {
    if (this.running) {
      const e = new Error('already');
      e.name = 'InvalidStateError';
      throw e;
    }
    this.starts++;
  }
  /** Test helpers */
  fireStart() {
    this.running = true;
    this.onstart?.();
  }
  fireEnd() {
    this.running = false;
    this.onend?.();
  }
  result(items: [string, boolean][], resultIndex = 0) {
    const results = Object.assign(
      items.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f })),
      { length: items.length },
    );
    this.onresult?.({ resultIndex, results } as unknown as RecResultEvent);
  }
  stop() {
    queueMicrotask(() => this.fireEnd());
  }
  abort() {
    this.running = false;
  }
}

function setup() {
  let now = 1_000_000;
  const timers: { fn: () => void; at: number }[] = [];
  const t = new WebSpeechTranscriber({
    Ctor: FakeRec,
    now: () => now,
    setTimer: (fn, ms) => {
      const h = { fn, at: now + ms };
      timers.push(h);
      return h;
    },
    clearTimer: (h) => {
      const i = timers.indexOf(h as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
    isHidden: () => false,
  });
  const log = {
    finals: [] as { text: string; t: number }[],
    interims: [] as string[],
    statuses: [] as string[],
    gaps: [] as number[],
  };
  t.on('final', (f) => log.finals.push(f));
  t.on('interim', (i) => log.interims.push(i.text));
  t.on('status', (s, d) => log.statuses.push(d ? `${s}:${d}` : s));
  t.on('gap', (g) => log.gaps.push(g.ms));
  const advance = (ms: number) => {
    now += ms;
    for (const h of [...timers].sort((a, b) => a.at - b.at)) {
      if (h.at <= now) {
        timers.splice(timers.indexOf(h), 1);
        h.fn();
      }
    }
  };
  return { t, log, advance, timers };
}

beforeEach(() => {
  FakeRec.last = null;
  FakeRec.instances = 0;
});

describe('WebSpeechTranscriber', () => {
  it('reports unsupported browsers', async () => {
    const t = new WebSpeechTranscriber({ Ctor: null });
    const statuses: string[] = [];
    t.on('status', (s, d) => statuses.push(`${s}:${d}`));
    await t.start({ language: 'en-US' });
    expect(statuses).toEqual(['error:unsupported']);
  });

  it('configures continuous interim recognition in the chosen language', async () => {
    const { t } = setup();
    await t.start({ language: 'ro-RO' });
    const r = FakeRec.last!;
    expect([r.lang, r.continuous, r.interimResults, r.starts]).toEqual(['ro-RO', true, true, 1]);
  });

  it('emits interim then final, timestamped at the start of the utterance', async () => {
    const { t, log, advance } = setup();
    await t.start({ language: 'en-US' });
    const r = FakeRec.last!;
    r.fireStart();
    r.result([['we go', false]]);
    advance(1200);
    r.result([['we go live on the 15th', true]]);
    expect(log.interims).toContain('we go');
    expect(log.finals).toEqual([{ text: 'we go live on the 15th', t: 1_000_000 }]);
  });

  it('restarts on its own after the browser ends a session, reusing one instance', async () => {
    const { t, log, advance } = setup();
    await t.start({ language: 'en-US' });
    const r = FakeRec.last!;
    r.fireStart();
    advance(8000); // long silent run: normal timeout
    r.fireEnd();
    advance(250);
    expect(r.starts).toBe(2);
    expect(FakeRec.instances).toBe(1);
    expect(log.statuses.filter((s) => s.startsWith('reconnecting'))).toHaveLength(0);
  });

  it('backs off on repeated immediate failures and reports reconnecting, then a gap', async () => {
    const { t, log, advance } = setup();
    await t.start({ language: 'en-US' });
    const r = FakeRec.last!;
    r.fireStart();
    r.onerror?.({ error: 'network' });
    r.fireEnd();
    expect(log.statuses).toContain('reconnecting:network');
    advance(400);
    expect(r.starts).toBe(1); // backed off beyond 250 ms
    advance(600);
    expect(r.starts).toBe(2);
    advance(1000);
    r.fireStart();
    expect(log.gaps[0]).toBeGreaterThanOrEqual(1500);
    expect(log.statuses.at(-1)).toBe('listening');
  });

  it('caps back-off at 5 s', async () => {
    const delays: number[] = [];
    const t = new WebSpeechTranscriber({
      Ctor: FakeRec,
      now: () => 0,
      setTimer: (_fn, ms) => {
        delays.push(ms);
        return {};
      },
      clearTimer: () => {},
      isHidden: () => false,
    });
    await t.start({ language: 'en-US' });
    const r = FakeRec.last!;
    for (let i = 0; i < 8; i++) {
      r.fireStart();
      r.fireEnd();
      (t as unknown as { restartHandle: unknown }).restartHandle = null; // timer "fired"
    }
    expect(delays.slice(0, 4)).toEqual([250, 500, 1000, 2000]);
    expect(Math.max(...delays)).toBe(5000);
  });

  it('stops for good on permission errors', async () => {
    const { t, log, advance } = setup();
    await t.start({ language: 'en-US' });
    const r = FakeRec.last!;
    r.onerror?.({ error: 'not-allowed' });
    r.fireEnd();
    advance(10_000);
    expect(log.statuses).toContain('error:permission');
    expect(r.starts).toBe(1);
  });

  it('drops repeated and cumulative finals (Android pattern)', async () => {
    const { t, log } = setup();
    await t.start({ language: 'en-US' });
    const r = FakeRec.last!;
    r.fireStart();
    r.result([['hello there', true]]);
    r.fireEnd();
    r.fireStart();
    r.result([['hello there', true]]);
    r.fireEnd();
    r.fireStart();
    r.result([['hello there how are you', true]]);
    expect(log.finals.map((f) => f.text)).toEqual(['hello there', 'how are you']);
  });

  it('stop() ends listening, keeps pending interim text and does not restart', async () => {
    const { t, log, advance } = setup();
    await t.start({ language: 'en-US' });
    const r = FakeRec.last!;
    r.fireStart();
    r.result([['unfinished thought', false]]);
    await t.stop();
    advance(10_000);
    expect(log.finals.map((f) => f.text)).toEqual(['unfinished thought']);
    expect(log.statuses.at(-1)).toBe('stopped');
    expect(r.starts).toBe(1);
  });
});
