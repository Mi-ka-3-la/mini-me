// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

async function load() {
  return import('../../src/store/session');
}

describe('session store', () => {
  it('adds lines with meeting-relative time and keeps manual speakers', async () => {
    const { useSession } = await load();
    const s0 = useSession.getState().session;
    useSession.getState().addLine({ text: ' hello ', origin: 'stt', t: s0.startedAt + 5000 });
    useSession.getState().addLine({ text: 'yes', origin: 'manual', speakerLabel: 'Client PM' });
    const s = useSession.getState().session;
    expect(s.lines[0]).toMatchObject({ text: 'hello', t: 5000, origin: 'stt' });
    expect(s.lines[1]?.speakerId).toBe('m-client-pm');
    expect(s.speakers['m-client-pm']?.label).toBe('Client PM');
  });

  it('ignores empty lines', async () => {
    const { useSession } = await load();
    useSession.getState().addLine({ text: '   ', origin: 'manual' });
    expect(useSession.getState().session.lines).toHaveLength(0);
  });

  it('persists and offers resume after reload', async () => {
    const first = await load();
    first.useSession.getState().setContext('Need a go-live owner');
    first.useSession.getState().addLine({ text: 'We go live on the 15th', origin: 'stt' });
    first.__test.flush();
    vi.resetModules();
    const second = await load();
    const st = second.useSession.getState();
    expect(st.pendingResume?.lines[0]?.text).toBe('We go live on the 15th');
    expect(st.session.lines).toHaveLength(0);
    st.resume();
    expect(second.useSession.getState().session.context).toBe('Need a go-live owner');
  });

  it('new meeting clears the saved session', async () => {
    const first = await load();
    first.useSession.getState().addLine({ text: 'x', origin: 'stt' });
    first.__test.flush();
    vi.resetModules();
    const second = await load();
    second.useSession.getState().startNew();
    expect(localStorage.getItem('mc.session.current')).toBeNull();
    vi.resetModules();
    const third = await load();
    expect(third.useSession.getState().pendingResume).toBeNull();
  });

  it('remembers the last language', async () => {
    const first = await load();
    first.useSession.getState().setLanguage('ro-RO');
    vi.resetModules();
    const second = await load();
    expect(second.useSession.getState().session.language).toBe('ro-RO');
  });

  it('survives storage that throws', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const { useSession, __test } = await load();
    useSession.getState().addLine({ text: 'still works', origin: 'stt' });
    expect(() => __test.flush()).not.toThrow();
    spy.mockRestore();
  });

  it('discards a corrupted saved session', async () => {
    localStorage.setItem('mc.session.current', '{"v":1,"session":{"id":3}}');
    const { useSession } = await load();
    expect(useSession.getState().pendingResume).toBeNull();
  });
});
