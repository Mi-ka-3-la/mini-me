import { useState } from 'react';
import { hasContent } from '../store/persist';
import { useSession } from '../store/session';
import { Dialog } from './Dialog';

type Props = { onBeforeClear?: () => void };

export function NewMeetingButton({ onBeforeClear }: Props) {
  const [confirm, setConfirm] = useState(false);
  const session = useSession((s) => s.session);
  const startNew = useSession((s) => s.startNew);
  const clear = () => {
    onBeforeClear?.();
    startNew();
    setConfirm(false);
  };
  return (
    <>
      <button className="btn" onClick={() => (hasContent(session) ? setConfirm(true) : clear())}>
        New meeting
      </button>
      {confirm && (
        <Dialog title="Start a new meeting?" onClose={() => setConfirm(false)}>
          <p>The transcript, summary and watch list on screen will be cleared from this device.</p>
          <div className="row">
            <button className="btn danger" onClick={clear}>
              Clear and start new
            </button>
            <button className="btn" onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
