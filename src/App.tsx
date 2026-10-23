import { useState } from 'react';
import { Column } from './components/Column';
import { Tabs, type TabId } from './components/Tabs';
import { NARROW, useMediaQuery } from './lib/useMediaQuery';

export function App() {
  const narrow = useMediaQuery(NARROW);
  const [tab, setTab] = useState<TabId>('transcript');
  const hidden = (id: TabId) => narrow && tab !== id;
  return (
    <div className="app">
      <header className="bar">
        <h1 className="brand">
          <span className="live" aria-hidden="true" />
          Meeting Copilot
        </h1>
        <span className="status">Ready</span>
        <span className="spacer" />
      </header>
      <Tabs active={tab} onChange={setTab} newFlags={0} />
      <main className="grid">
        <Column id="transcript" title="Live transcript" hidden={hidden('transcript')}>
          <div className="scroll">
            <div className="empty">Nothing yet.</div>
          </div>
        </Column>
        <Column id="summary" title="Running summary" hidden={hidden('summary')}>
          <div className="scroll">
            <div className="empty">
              The summary builds here by topic once there is something to summarize.
            </div>
          </div>
        </Column>
        <Column id="watch" title="Watch list" hidden={hidden('watch')}>
          <div className="scroll">
            <div className="empty">
              Traps, logic errors and questions worth asking appear here, each with the exact words
              that triggered it.
            </div>
          </div>
        </Column>
      </main>
    </div>
  );
}
