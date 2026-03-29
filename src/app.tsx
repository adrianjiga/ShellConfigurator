import React, { useState } from 'react';
import { WizardState, WizardStep, DEFAULT_STATE } from './types.js';
import { WelcomeScreen } from './screens/WelcomeScreen.js';
import { FontCheckScreen } from './screens/FontCheckScreen.js';
import { PresetScreen } from './screens/PresetScreen.js';
import { SegmentsScreen } from './screens/SegmentsScreen.js';
import { StyleScreen } from './screens/StyleScreen.js';
import { ShellScreen } from './screens/ShellScreen.js';
import { DoneScreen } from './screens/DoneScreen.js';

const STEP_ORDER: WizardStep[] = [
  'welcome',
  'fontcheck',
  'preset',
  'segments_left',
  'segments_right',
  'style',
  'shells',
  'done',
];

export function App() {
  const [state, setState] = useState<WizardState>(DEFAULT_STATE);

  function updateState(update: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...update }));
  }

  function advanceTo(next: WizardStep, update?: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...update, step: next }));
  }

  function goNext(update?: Partial<WizardState>) {
    const currentIndex = STEP_ORDER.indexOf(state.step);
    const nextStep = STEP_ORDER[currentIndex + 1];
    if (nextStep) {
      setState((prev) => ({ ...prev, ...update, step: nextStep }));
    }
  }

  function goBack() {
    const currentIndex = STEP_ORDER.indexOf(state.step);
    const prevStep = STEP_ORDER[currentIndex - 1];
    if (prevStep) {
      setState((prev) => ({ ...prev, step: prevStep }));
    }
  }

  switch (state.step) {
    case 'welcome':
      return (
        <WelcomeScreen
          state={state}
          onNext={(u) => goNext(u)}
        />
      );

    case 'fontcheck':
      return (
        <FontCheckScreen
          state={state}
          onNext={(u) => goNext(u)}
          onBack={goBack}
        />
      );

    case 'preset':
      return (
        <PresetScreen
          state={state}
          onNext={(u) => goNext(u)}
          onBack={goBack}
        />
      );

    case 'segments_left':
      return (
        <SegmentsScreen
          state={state}
          side="left"
          onNext={(u) => goNext(u)}
          onUpdate={updateState}
          onBack={goBack}
        />
      );

    case 'segments_right':
      return (
        <SegmentsScreen
          state={state}
          side="right"
          onNext={(u) => goNext(u)}
          onUpdate={updateState}
          onBack={goBack}
        />
      );

    case 'style':
      return (
        <StyleScreen
          state={state}
          onNext={(u) => goNext(u)}
          onBack={goBack}
        />
      );

    case 'shells':
      return (
        <ShellScreen
          state={state}
          onNext={(u) => goNext(u)}
          onBack={goBack}
        />
      );

    case 'done':
      return <DoneScreen state={state} />;
  }
}
