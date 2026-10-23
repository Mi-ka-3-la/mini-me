import { useOnline } from '../lib/useOnline';
import { useSession } from '../store/session';

/** Offline state (T0.13). Chrome's speech engine needs the network, so speech in this gap is lost. */
export function OfflineBanner() {
  const online = useOnline();
  const listening = useSession((s) => s.listen !== 'idle' && s.listen !== 'error');
  if (online) return null;
  return (
    <div className="banner error" role="alert">
      You are offline.{' '}
      {listening
        ? 'Listening resumes when the connection is back; speech in between may be lost. '
        : ''}
      Analysis waits for the connection. Typed notes still work.
    </div>
  );
}
