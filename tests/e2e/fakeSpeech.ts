import type { Page } from '@playwright/test';

/**
 * Replaces the browser speech engine with a scriptable fake, because headless Chromium
 * has no speech service. Tests drive it through window.__speech.
 */
export async function installFakeSpeech(page: Page, mode: 'ok' | 'denied' | 'none' = 'ok') {
  await page.addInitScript((m) => {
    const w = window as unknown as Record<string, unknown>;
    delete w.SpeechRecognition;
    delete w.webkitSpeechRecognition;
    if (m === 'none') return;
    class FakeRec {
      lang = '';
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      results: { transcript: string; isFinal: boolean }[] = [];
      start() {
        (w as { __rec?: FakeRec }).__rec = this;
        setTimeout(() => {
          if (m === 'denied') {
            this.onerror?.({ error: 'not-allowed' });
            this.onend?.();
            return;
          }
          this.onstart?.();
        }, 20);
      }
      stop() {
        setTimeout(() => this.onend?.(), 10);
      }
      abort() {}
      emit() {
        const list = this.results.map((r) =>
          Object.assign([{ transcript: r.transcript }], { isFinal: r.isFinal }),
        );
        this.onresult?.({ resultIndex: 0, results: Object.assign(list, { length: list.length }) });
      }
    }
    w.webkitSpeechRecognition = FakeRec;
    w.__speech = {
      interim(text: string) {
        const r = (w as { __rec?: FakeRec }).__rec!;
        r.results = r.results.filter((x) => x.isFinal);
        r.results.push({ transcript: text, isFinal: false });
        r.emit();
      },
      final(text: string) {
        const r = (w as { __rec?: FakeRec }).__rec!;
        r.results = r.results.filter((x) => x.isFinal);
        r.results.push({ transcript: text, isFinal: true });
        r.emit();
      },
      end() {
        (w as { __rec?: FakeRec }).__rec!.onend?.();
      },
      lang() {
        return (w as { __rec?: FakeRec }).__rec!.lang;
      },
    };
  }, mode);
}

export async function skipGate(page: Page) {
  await page.getByRole('button', { name: 'Continue without analysis' }).click();
}
