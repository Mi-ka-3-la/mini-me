/**
 * Every localStorage access goes through here, wrapped in try/catch (CLAUDE.md rule).
 * Storage can be missing or throw in private windows, previews or with blocked site data.
 */
export const KEYS = {
  session: 'mc.session.current',
  language: 'mc.language',
  passcode: 'mc.passcode',
  passcodeSkipped: 'mc.passcode.skipped',
  theme: 'mc.theme',
} as const;

export function readString(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeString(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function remove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function readJson(key: string): unknown {
  const raw = readString(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    return writeString(key, JSON.stringify(value));
  } catch {
    return false;
  }
}
