import { useEffect, useState } from 'react';
import { Column } from './components/Column';
import { Tabs, type TabId } from './components/Tabs';
import { NARROW, useMediaQuery } from './lib/useMediaQuery';
import { Menu } from './components/Menu';
import { PasscodeGate } from './components/PasscodeGate';
import { useAuth } from './store/auth';
import { ResumePrompt } from './components/ResumePrompt';
import { NewMeetingButton } from './components/NewMeetingButton';
import { ListenIndicator, ListenStatusText, StartStopButton } from './components/ListenControls';
import { SetupStrip } from './components/SetupStrip';
import { ListenBanner } from './components/ListenBanner';
import { TranscriptColumn } from './components/TranscriptColumn';
import { SummaryColumn } from './components/SummaryColumn';
import { AnalysisBanner, AnalysisControls, AnalysisStatus } from './components/AnalysisControls';
import { analysisRunner } from './analysis/runner';

export function App() {
  const narrow = useMediaQuery(NARROW);
  const [tab, setTab] = useState<TabId>('transcript');
  const hidden = (id: TabId) => narrow && tab !== id;
  const needsGate = useAuth((s) => !s.passcode && !s.skipped);
  useEffect(() => {
    analysisRunner.start();
    return () => analysisRunner.stop();
  }, []);
  if (needsGate) return <PasscodeGate />;
  return (
    <div className="app">
      <header className="bar">
        <h1 className="brand">
          <ListenIndicator />
          Meeting Copilot
        </h1>
        <ListenStatusText />
        <AnalysisStatus />
        <span className="spacer" />
        <StartStopButton />
        <AnalysisControls />
        <NewMeetingButton />
        <Menu />
      </header>
      <SetupStrip />
      <ListenBanner />
      <AnalysisBanner />
      <Tabs active={tab} onChange={setTab} newFlags={0} />
      <main className="grid">
        <TranscriptColumn hidden={hidden('transcript')} />
        <SummaryColumn hidden={hidden('summary')} />
        <Column id="watch" title="Watch list" hidden={hidden('watch')}>
          <div className="scroll">
            <div className="empty">
              Traps, logic errors and questions worth asking appear here, each with the exact words
              that triggered it.
            </div>
          </div>
        </Column>
      </main>
      <ResumePrompt />
    </div>
  );
}
