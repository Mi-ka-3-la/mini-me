/** Keeps the screen on while listening (ADR-16). Re-acquired when the page becomes visible. */
type Sentinel = { release(): Promise<void>; addEventListener(t: 'release', cb: () => void): void };
type WakeLockApi = { request(type: 'screen'): Promise<Sentinel> };

export function isWakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

export class ScreenWakeLock {
  private sentinel: Sentinel | null = null;
  private wanted = false;
  private onVisible = () => {
    if (this.wanted && document.visibilityState === 'visible' && !this.sentinel)
      void this.acquire();
  };

  async enable(): Promise<boolean> {
    this.wanted = true;
    document.addEventListener('visibilitychange', this.onVisible);
    return this.acquire();
  }

  async disable(): Promise<void> {
    this.wanted = false;
    document.removeEventListener('visibilitychange', this.onVisible);
    const s = this.sentinel;
    this.sentinel = null;
    try {
      await s?.release();
    } catch {
      /* ignore */
    }
  }

  private async acquire(): Promise<boolean> {
    if (!isWakeLockSupported()) return false;
    try {
      const api = (navigator as unknown as { wakeLock: WakeLockApi }).wakeLock;
      const s = await api.request('screen');
      this.sentinel = s;
      s.addEventListener('release', () => {
        if (this.sentinel === s) this.sentinel = null;
      });
      return true;
    } catch {
      return false;
    }
  }
}
