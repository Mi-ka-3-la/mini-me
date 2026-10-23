import { useEffect, useRef, useState } from 'react';
import { getTheme, setTheme, type Theme } from '../lib/theme';
import { useAuth } from '../store/auth';

export function Menu() {
  const [open, setOpen] = useState(false);
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const ref = useRef<HTMLDivElement>(null);
  const passcode = useAuth((s) => s.passcode);
  const signOut = useAuth((s) => s.signOut);
  const reopenGate = useAuth((s) => s.reopenGate);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (t: Theme) => {
    setTheme(t);
    setThemeState(t);
  };
  const next: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };

  return (
    <div className="menu" ref={ref}>
      <button
        className="btn"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Menu
      </button>
      {open && (
        <div className="menu-list" role="menu">
          <button role="menuitem" onClick={() => pick(next[theme])}>
            Theme: {theme === 'system' ? 'System' : theme === 'light' ? 'Light' : 'Dark'}
          </button>
          {passcode ? (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                signOut();
              }}
            >
              Sign out
            </button>
          ) : (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                reopenGate();
              }}
            >
              Enter passcode
            </button>
          )}
        </div>
      )}
    </div>
  );
}
