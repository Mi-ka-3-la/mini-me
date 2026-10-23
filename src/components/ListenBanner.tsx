import { isWebSpeechSupported } from '../audio/webSpeech';
import { useSession } from '../store/session';

const HELP: Record<string, string> = {
  permission:
    'Microphone access is blocked. Allow the microphone for this site (the icon next to the address bar, or the browser’s site settings), then press Start listening again. Pasting text below still works.',
  'no-mic': 'No microphone was found. Connect one, then press Start listening again.',
  language:
    'This browser cannot recognize the chosen language. Try Chrome on a laptop, or paste captions below.',
  unsupported: 'This browser cannot transcribe. Use Chrome or Edge, or paste captions.',
  'start-failed': 'Listening could not start. Press Start listening to try again.',
};

/** Explains why listening is not running, and keeps manual input as the way forward. */
export function ListenBanner() {
  const status = useSession((s) => s.listen);
  const error = useSession((s) => s.listenError);
  if (!isWebSpeechSupported()) {
    return (
      <div className="banner" role="note">
        {HELP.unsupported}
      </div>
    );
  }
  if (status !== 'error' || !error) return null;
  return (
    <div className="banner error" role="alert">
      {HELP[error] ?? HELP['start-failed']}
    </div>
  );
}
