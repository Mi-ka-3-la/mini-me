import { useMemo, useRef, useState } from 'react';
import { notesMarkdown } from '../lib/export';
import { useSession } from '../store/session';
import { Dialog } from './Dialog';

/** Copy notes (US-07). If the clipboard is refused, the text is shown selected (AC2). */
export function CopyNotesButton() {
  const [open, setOpen] = useState(false);
  const hasAnything = useSession((s) => s.session.lines.length > 0 || s.session.summary !== null);
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)} disabled={!hasAnything}>
        Copy notes
      </button>
      {open && <ExportDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function ExportDialog({ onClose }: { onClose: () => void }) {
  const session = useSession((s) => s.session);
  const [withTranscript, setWithTranscript] = useState(false);
  const [state, setState] = useState<'idle' | 'copied' | 'blocked'>('idle');
  const area = useRef<HTMLTextAreaElement>(null);
  const text = useMemo(
    () => notesMarkdown(session, { includeTranscript: withTranscript }),
    [session, withTranscript],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('blocked');
      area.current?.focus();
      area.current?.select();
    }
  }

  return (
    <Dialog title="Copy notes" onClose={onClose}>
      <label className="row">
        <input
          type="checkbox"
          checked={withTranscript}
          onChange={(e) => {
            setWithTranscript(e.target.checked);
            setState('idle');
          }}
        />
        Include the transcript
      </label>
      <textarea
        ref={area}
        readOnly
        value={text}
        aria-label="Notes as Markdown"
        onFocus={(e) => state === 'blocked' && e.currentTarget.select()}
      />
      {state === 'copied' && (
        <p className="hint" role="status">
          Copied as Markdown. Paste it into a document or a message.
        </p>
      )}
      {state === 'blocked' && (
        <p className="err" role="alert">
          This browser blocked the clipboard. The notes are selected above: press Ctrl/Cmd + C.
        </p>
      )}
      <div className="row">
        <button className="btn primary" onClick={() => void copy()}>
          Copy
        </button>
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
