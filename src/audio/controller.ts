import { useSession } from '../store/session';
import type { Transcriber, TranscriberErrorCode } from './transcriber';
import { WebSpeechTranscriber } from './webSpeech';
import { ScreenWakeLock } from './wakeLock';

/**
 * Connects the transcriber to the session store. One instance for the app.
 * Keeps the screen awake while listening and restarts recognition when the page comes back.
 */
export class ListeningController {
  private transcriber: (Transcriber & { resumeIfNeeded?: () => void }) | null = null;
  private offs: (() => void)[] = [];
  private wake = new ScreenWakeLock();
  wakeLockActive = false;

  constructor(
    private readonly make: () => Transcriber & { resumeIfNeeded?: () => void } = () =>
      new WebSpeechTranscriber(),
  ) {}

  private onVisible = () => {
    if (document.visibilityState === 'visible') this.transcriber?.resumeIfNeeded?.();
  };

  async start(): Promise<void> {
    const store = useSession.getState();
    if (store.listen === 'listening' || store.listen === 'starting') return;
    store.markStart();
    store.setListen('starting');
    const t = this.make();
    this.transcriber = t;
    this.offs.push(
      t.on('final', ({ text, t: at }) =>
        useSession.getState().addLine({ text, origin: 'stt', t: at }),
      ),
      t.on('interim', ({ text }) => useSession.getState().setInterim(text ? { text } : null)),
      t.on('gap', ({ t: at, ms }) => {
        const s = useSession.getState().session;
        useSession.getState().addGap({ t: Math.max(0, at - s.startedAt), ms });
      }),
      t.on('status', (st, detail) => {
        const set = useSession.getState().setListen;
        if (st === 'listening') set('listening');
        else if (st === 'reconnecting') set('reconnecting');
        else if (st === 'stopped') set('idle');
        else {
          set('error', (detail as TranscriberErrorCode | undefined) ?? 'start-failed');
          void this.cleanup();
        }
      }),
    );
    document.addEventListener('visibilitychange', this.onVisible);
    this.wakeLockActive = await this.wake.enable();
    await t.start({ language: useSession.getState().session.language });
  }

  async stop(): Promise<void> {
    const t = this.transcriber;
    if (!t) return;
    await t.stop();
    await this.cleanup();
    useSession.getState().setListen('idle');
    useSession.getState().setInterim(null);
  }

  private async cleanup(): Promise<void> {
    for (const off of this.offs) off();
    this.offs = [];
    this.transcriber = null;
    document.removeEventListener('visibilitychange', this.onVisible);
    await this.wake.disable();
    this.wakeLockActive = false;
  }
}

export const listening = new ListeningController();
