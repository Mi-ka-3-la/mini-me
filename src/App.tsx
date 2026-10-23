import { useEffect, useState } from 'react';
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
import { WatchList } from './components/WatchList';
import { CopyNotesButton } from './components/ExportDialog';
import { OfflineBanner } from './components/OfflineBanner';
import { SimulationBanner } from './components/SimulationDialog';
import { simulator } from './demo/simulator';
import { useSession } from './store/session';
import { AnalysisBanner, AnalysisControls, AnalysisStatus } from './components/AnalysisControls';
import { analysisRunner } from './analysis/runner';

export function App() {
  const narrow = useMediaQuery(NARROW);
  const [tab, setTab] = useState<TabId>('transcript');
  const hidden = (id: TabId) => narrow && tab !== id;
  const needsGate = useAuth((s) => !s.passcode && !s.skipped);
  const unseen = useSession((s) => s.analysis.unseenFlags);
  const markSeen = useSession((s) => s.markFlagsSeen);
  const watchVisible = !narrow || tab === 'watch';
  useEffect(() => {
    if (watchVisible && unseen > 0) markSeen();
  }, [watchVisible, unseen, markSeen]);
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
        <CopyNotesButton />
        <NewMeetingButton onBeforeClear={() => simulator.stop()} />
        <Menu />
      </header>
      <SetupStrip />
      <SimulationBanner />
      <OfflineBanner />
      <ListenBanner />
      <AnalysisBanner />
      <Tabs active={tab} onChange={setTab} newFlags={unseen} />
      <main className="grid">
        <TranscriptColumn hidden={hidden('transcript')} />
        <SummaryColumn hidden={hidden('summary')} />
        <WatchList hidden={hidden('watch')} />
      </main>
      <ResumePrompt />
    </div>
  );
}
