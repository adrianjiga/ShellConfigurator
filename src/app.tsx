import React, { useState } from 'react';
import { WizardState, WizardStep, DEFAULT_STATE } from './types.js';
import { getNextStep, getPrevStep } from './stepMachine.js';
import { WelcomeScreen } from './screens/WelcomeScreen.js';
import { FontCheckScreen } from './screens/FontCheckScreen.js';
import { FontSelectScreen } from './screens/FontSelectScreen.js';
import { PresetScreen } from './screens/PresetScreen.js';
import { SegmentsScreen } from './screens/SegmentsScreen.js';
import { StyleScreen } from './screens/StyleScreen.js';
import { ShellScreen } from './screens/ShellScreen.js';
import { InstallingScreen } from './screens/InstallingScreen.js';
import { DoneScreen } from './screens/DoneScreen.js';

export function App() {
  const [state, setState] = useState<WizardState>(DEFAULT_STATE);

  function updateState(update: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...update }));
  }

  function advanceTo(next: WizardStep, update?: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...update, step: next }));
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
      return <InstallingScreen state={state} onNext={(update) => advanceTo('done', update)} />;

    case 'done':
      return <DoneScreen state={state} />;
  }
}
