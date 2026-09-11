import { useState } from 'react';
import { DoneScreen } from './screens/DoneScreen.tsx';
import { FontCheckScreen } from './screens/FontCheckScreen.tsx';
import { FontSelectScreen } from './screens/FontSelectScreen.tsx';
import { InstallingScreen } from './screens/InstallingScreen.tsx';
import { PresetScreen } from './screens/PresetScreen.tsx';
import { ReviewScreen } from './screens/ReviewScreen.tsx';
import { SegmentsScreen } from './screens/SegmentsScreen.tsx';
import { ShellScreen } from './screens/ShellScreen.tsx';
import { StyleScreen } from './screens/StyleScreen.tsx';
import { WelcomeScreen } from './screens/WelcomeScreen.tsx';
import { getNextStep, getPrevStep } from './stepMachine.ts';
import {
  assertNever,
  DEFAULT_STATE,
  type InstallTask,
  type WizardState,
  type WizardStep,
} from './types.ts';

interface AppProps {
  dryRun?: boolean;
  /** Receives the completed install results and final state so the entry point
   *  can set the exit code and record the run in history. */
  onInstallOutcome?: (results: InstallTask[] | undefined, state: WizardState) => void;
}

export function App({ dryRun = false, onInstallOutcome }: AppProps) {
  const [state, setState] = useState<WizardState>(() => ({ ...DEFAULT_STATE, dryRun }));

  function updateState(update: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...update }));
  }

  function advanceTo(next: WizardStep, update?: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...update, step: next }));
  }

  function finishInstall(update?: Partial<WizardState>) {
    const finalState: WizardState = { ...state, ...update, step: 'done' };
    onInstallOutcome?.(finalState.installResults, finalState);
    advanceTo('done', update);
  }

  function goNext(update?: Partial<WizardState>) {
    setState((prev) => getNextStep(prev, update));
  }

  function goBack() {
    setState((prev) => getPrevStep(prev));
  }

  switch (state.step) {
    case 'welcome':
      return <WelcomeScreen state={state} onNext={goNext} />;

    case 'fontcheck':
      return <FontCheckScreen state={state} onNext={goNext} onBack={goBack} />;

    case 'font_select':
      return <FontSelectScreen state={state} onNext={goNext} onBack={goBack} />;

    case 'preset':
      return <PresetScreen state={state} onNext={goNext} onBack={goBack} />;

    case 'segments_left':
      return (
        <SegmentsScreen
          key="left"
          state={state}
          side="left"
          onNext={goNext}
          onUpdate={updateState}
          onBack={goBack}
        />
      );

    case 'segments_right':
      return (
        <SegmentsScreen
          key="right"
          state={state}
          side="right"
          onNext={goNext}
          onUpdate={updateState}
          onBack={goBack}
        />
      );

    case 'style':
      return <StyleScreen state={state} onNext={goNext} onUpdate={updateState} onBack={goBack} />;

    case 'shells':
      return <ShellScreen state={state} onNext={goNext} onUpdate={updateState} onBack={goBack} />;

    case 'review':
      return <ReviewScreen state={state} onNext={goNext} onBack={goBack} />;

    case 'installing':
      return <InstallingScreen state={state} onNext={finishInstall} />;

    case 'done':
      return <DoneScreen state={state} />;

    default:
      // Exhaustiveness: adding a step to STEP_ORDER should fail the build here.
      return assertNever(state.step);
  }
}
