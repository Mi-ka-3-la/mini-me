import { useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../store/auth';

/** First-run screen (US-09). Validates the code with /api/ping before saving it (ADR-15). */
export function PasscodeGate() {
  const save = useAuth((s) => s.save);
  const skip = useAuth((s) => s.skip);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const code = value.trim();
    if (!code) return;
    setBusy(true);
    setError(null);
    const res = await apiFetch<{ ok: boolean }>('/api/ping', { passcode: code });
    setBusy(false);
    if (res.ok) {
      save(code);
      return;
    }
    const { code: err } = res.error;
    if (err === 'unauthorized') setError('That passcode is not right. Try again.');
    else if (err === 'server_misconfigured')
      setError('The server has no passcode set. Add APP_PASSCODE in Vercel and redeploy.');
    else if (err === 'rate_limited') setError('Too many attempts. Wait a minute, then try again.');
    else setError('Could not reach the server. Check the connection and try again.');
  }

  return (
    <div className="gate">
      <form className="dialog" onSubmit={submit} aria-labelledby="gate-title">
        <h2 id="gate-title">Meeting Copilot</h2>
        <p>Enter the passcode to turn on the summary and watch list. It is kept on this device.</p>
        <div className="field">
          <label htmlFor="passcode">Passcode</label>
          <input
            id="passcode"
            type="password"
            autoComplete="current-password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        </div>
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy || !value.trim()}>
            {busy ? 'Checking…' : 'Unlock'}
          </button>
          <button className="btn" type="button" onClick={skip}>
            Continue without analysis
          </button>
        </div>
        <p className="hint">
          Without the passcode, transcription still works, but nothing is sent for analysis.
        </p>
      </form>
    </div>
  );
}
