import { KEYS, readString, writeString } from './storage';

export type Theme = 'system' | 'light' | 'dark';

export function getTheme(): Theme {
  const t = readString(KEYS.theme);
  return t === 'light' || t === 'dark' ? t : 'system';
}

export function setTheme(t: Theme): void {
  writeString(KEYS.theme, t);
  applyTheme(t);
}

export function applyTheme(t: Theme): void {
  const el = document.documentElement;
  if (t === 'system') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', t);
}

export function applyStoredTheme(): void {
  applyTheme(getTheme());
}
