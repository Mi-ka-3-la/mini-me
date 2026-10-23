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
const flush = () => new Promise((r) => setTimeout(r, 0));

function okResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('AnalysisRunner', () => {
  it('runs one call at a time and picks up words that arrived during it', async () => {
    const { useSession, runner } = await setup();
    let release: (r: Response) => void = () => {};
    const fetchMock = vi.fn(() => new Promise<Response>((res) => (release = res)));
    vi.stubGlobal('fetch', fetchMock);
    const st = useSession.getState();
    st.addLine({ text: words(160), origin: 'stt' });
    runner.tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useSession.getState().analysis.running).toBe(true);
    // words keep arriving during the call
    useSession.getState().addLine({ text: words(160), origin: 'stt' });
    runner.tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(okResponse({ ...EXAMPLE_OUTPUT, flags: [] }));
    await flush();
    await flush();
    expect(useSession.getState().analysis.running).toBe(false);
    expect(useSession.getState().session.summary?.tldr).toContain('Go-live');
    runner.tick();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useSession.getState().session.analysisCalls).toBe(2);
  });

  it('on failure keeps the screen, counts the words as new again and backs off', async () => {
    const { useSession, runner } = await setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'upstream_error', message: 'x' }), { status: 502 }),
      ),
    );
    useSession.getState().addLine({ text: words(160), origin: 'stt' });
    runner.tick();
    await flush();
    await flush();
    const st = useSession.getState();
    expect(st.analysis.error?.code).toBe('upstream_error');
    expect(st.session.analyzedUpToLineIndex).toBe(0);
    expect(st.analysis.retryAt).toBeGreaterThan(Date.now());
    runner.tick();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1); // waiting for back-off
  });

  it('a 401 pauses analysis until a new passcode is entered', async () => {
    const { useSession, useAuth, runner } = await setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'unauthorized', message: 'x' }), { status: 401 }),
      ),
    );
    useSession.getState().addLine({ text: words(160), origin: 'stt' });
    runner.tick();
    await flush();
    await flush();
    expect(useAuth.getState().rejected).toBe(true);
    useSession.getState().addLine({ text: words(200), origin: 'stt' });
    useSession.getState().setAnalysis({ retryAt: 0 });
    runner.tick();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('ignores a result that arrives after New meeting', async () => {
    const { useSession, runner } = await setup();
    let release: (r: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((res) => (release = res))),
    );
    useSession.getState().addLine({ text: words(160), origin: 'stt' });
    runner.tick();
    useSession.getState().startNew();
    release(okResponse(EXAMPLE_OUTPUT));
    await flush();
    await flush();
    expect(useSession.getState().session.summary).toBeNull();
    expect(useSession.getState().analysis.running).toBe(false);
  });

  it('sends the passcode header and the context', async () => {
    const { useSession, runner } = await setup();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      okResponse(EXAMPLE_OUTPUT),
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
