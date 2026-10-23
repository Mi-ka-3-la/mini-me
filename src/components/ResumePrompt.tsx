import { clockTime } from '../lib/time';
import { useSession } from '../store/session';
import { Dialog } from './Dialog';

export function ResumePrompt() {
  const pending = useSession((s) => s.pendingResume);
  const resume = useSession((s) => s.resume);
  const startNew = useSession((s) => s.startNew);
  if (!pending) return null;
  const lines = pending.lines.length;
  return (
    <Dialog title="Resume meeting?">
      <p>
        A meeting started at {clockTime(pending.startedAt)} is saved on this device ({lines}{' '}
        {lines === 1 ? 'line' : 'lines'}
        {pending.flags.length ? `, ${pending.flags.length} flags` : ''}).
      </p>
      <div className="row">
        <button className="btn primary" onClick={resume}>
          Resume
        </button>
        <button className="btn" onClick={startNew}>
          Start a new meeting
        </button>
      </div>
    </Dialog>
  );
}
