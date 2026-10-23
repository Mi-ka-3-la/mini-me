import { listening } from '../audio/controller';
import { useSession } from '../store/session';

export const LISTEN_LABEL = {
  idle: 'Ready',
  starting: 'Starting…',
  listening: 'Listening',
  reconnecting: 'Reconnecting…',
  error: 'Not listening',
} as const;

export function ListenIndicator({ secondary = false }: { secondary?: boolean }) {
  const status = useSession((s) => s.listen);
  const on = status === 'listening';
  const warn = status === 'reconnecting' || status === 'starting';
  return (
    <>
      <span
        className={`live${on ? ' on' : ''}${warn ? ' warn' : ''}`}
        aria-hidden="true"
        data-testid={secondary ? undefined : 'live-dot'}
      />
      {!secondary && <span className="sr-only">Status:</span>}
    </>
  );
}

export function ListenStatusText({ secondary = false }: { secondary?: boolean }) {
  const status = useSession((s) => s.listen);
  return (
    <span
      className="status"
      {...(secondary ? {} : { role: 'status', 'aria-live': 'polite' as const })}
    >
      {LISTEN_LABEL[status]}
    </span>
  );
}

export function StartStopButton() {
  const status = useSession((s) => s.listen);
  const active = status === 'listening' || status === 'reconnecting' || status === 'starting';
  return active ? (
    <button className="btn danger" onClick={() => void listening.stop()}>
      Stop
    </button>
  ) : (
    <button className="btn primary" onClick={() => void listening.start()}>
      Start listening
    </button>
  );
}
