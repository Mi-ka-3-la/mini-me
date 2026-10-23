// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EXAMPLE_OUTPUT } from '../fixtures/example';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('mc.passcode', 'pc');
  vi.resetModules();
});

async function setup() {
  const { useSession } = await import('../../src/store/session');
  const { useAuth } = await import('../../src/store/auth');
  const { AnalysisRunner } = await import('../../src/analysis/runner');
  return { useSession, useAuth, runner: new AnalysisRunner() };
}

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const WATCH = { flags: EXAMPLE_OUTPUT.flags.map((f, i) => ({ ...f, id: `f-${i}` })) };
const SUMMARY = { tldr: EXAMPLE_OUTPUT.tldr, topics: EXAMPLE_OUTPUT.topics };
const modeOf = (init?: RequestInit) => (JSON.parse(String(init?.body)) as { mode: string }).mode;

describe('AnalysisRunner', () => {
  it('runs watch and summary side by side, one of each at a time', async () => {
    const { useSession, runner } = await setup();
    const pending: Record<string, (r: Response) => void> = {};
    const fetchMock = vi.fn(
      (_u: string, init?: RequestInit) =>
        new Promise<Response>((res) => (pending[modeOf(init)] = res)),
    );
    vi.stubGlobal('fetch', fetchMock);
    useSession.getState().addLine({ text: words(160), origin: 'stt' });
    runner.tick();
    expect(fetchMock.mock.calls.map((c) => modeOf(c[1]))).toEqual(['watch', 'summary']);
    useSession.getState().addLine({ text: words(160), origin: 'stt' });
    runner.tick();
    expect(fetchMock).toHaveBeenCalledTimes(2); // both busy
    pending.watch!(json(WATCH));
    await flush();
    expect(useSession.getState().session.flags).toHaveLength(2);
    expect(useSession.getState().analysis.summaryRunning).toBe(true);
    runner.tick();
    expect(fetchMock.mock.calls.map((c) => modeOf(c[1]))).toEqual(['watch', 'summary', 'watch']);
    pending.summary!(json(SUMMARY));
    await flush();
    expect(useSession.getState().session.summary?.tldr).toContain('Go-live');
    // the summary waits 3 minutes before running again
    runner.tick();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('on failure keeps the screen, counts the words as new again and backs off', async () => {
    const { useSession, runner } = await setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'upstream_error', message: 'x' }, 502)),
    );
    useSession.getState().addLine({ text: words(160), origin: 'stt' });
    runner.tick();
    await flush();
    const st = useSession.getState();
    expect(st.analysis.error?.code).toBe('upstream_error');
    expect(st.session.analyzedUpToLineIndex).toBe(0);
    expect(st.session.summaryUpToLineIndex).toBe(0);
    expect(st.analysis.retryAt).toBeGreaterThan(Date.now());
    runner.tick();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2); // waiting for back-off
  });

  it('a 401 pauses analysis until a new passcode is entered', async () => {
    const { useSession, useAuth, runner } = await setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'unauthorized', message: 'x' }, 401)),
    );
    useSession.getState().addLine({ text: words(160), origin: 'stt' });
    runner.tick();
    await flush();
    expect(useAuth.getState().rejected).toBe(true);
    const calls = vi.mocked(fetch).mock.calls.length;
    useSession.getState().addLine({ text: words(200), origin: 'stt' });
    useSession.getState().setAnalysis({ retryAt: 0 });
    runner.tick();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(calls);
  });

  it('ignores a result that arrives after New meeting', async () => {
    const { useSession, runner } = await setup();
    const pending: ((r: Response) => void)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((res) => pending.push(res))),
    );
    useSession.getState().addLine({ text: words(160), origin: 'stt' });
    runner.tick();
    useSession.getState().startNew();
    pending[0]!(json(WATCH));
    pending[1]!(json(SUMMARY));
    await flush();
    expect(useSession.getState().session.summary).toBeNull();
    expect(useSession.getState().session.flags).toHaveLength(0);
  });

  it('sends the passcode header and the context', async () => {
    const { useSession, runner } = await setup();
    const fetchMock = vi.fn(async (_u: string, init?: RequestInit) =>
      json(modeOf(init) === 'watch' ? WATCH : SUMMARY),
    );
    vi.stubGlobal('fetch', fetchMock);
    useSession.getState().setContext('Need an owner for tax rules');
    useSession.getState().addLine({ text: words(160), origin: 'stt' });
    runner.tick();
    await flush();
    const init = fetchMock.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)['x-app-passcode']).toBe('pc');
    expect(JSON.parse(String(init.body)).context).toBe('Need an owner for tax rules');
  });
});
