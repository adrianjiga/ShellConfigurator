import React, { useState } from 'react';
import { WizardState, WizardStep, DEFAULT_STATE } from './types.ts';
import { getNextStep, getPrevStep } from './stepMachine.ts';
import { WelcomeScreen } from './screens/WelcomeScreen.tsx';
import { FontCheckScreen } from './screens/FontCheckScreen.tsx';
import { FontSelectScreen } from './screens/FontSelectScreen.tsx';
import { PresetScreen } from './screens/PresetScreen.tsx';
import { SegmentsScreen } from './screens/SegmentsScreen.tsx';
import { StyleScreen } from './screens/StyleScreen.tsx';
import { ShellScreen } from './screens/ShellScreen.tsx';
import { InstallingScreen } from './screens/InstallingScreen.tsx';
import { DoneScreen } from './screens/DoneScreen.tsx';

export function App() {
  const [state, setState] = useState<WizardState>(DEFAULT_STATE);

  function updateState(update: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...update }));
  }

  function advanceTo(next: WizardStep, update?: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...update, step: next }));
  }

  function finishInstall(update?: Partial<WizardState>) {
    // Exit non-zero when anything failed, so the wizard is usable from a script.
    if (update?.installResults?.some((t) => t.status === 'failed')) {
      process.exitCode = 1;
    }
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

    case 'installing':
      return <InstallingScreen state={state} onNext={finishInstall} />;

    case 'done':
      return <DoneScreen state={state} />;
  }
}
