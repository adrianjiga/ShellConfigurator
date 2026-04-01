import React, { useState } from 'react';
import { WizardState, WizardStep, DEFAULT_STATE, FONT_SELECT_SENTINEL } from './types.js';
import { WelcomeScreen } from './screens/WelcomeScreen.js';
import { FontCheckScreen } from './screens/FontCheckScreen.js';
import { FontSelectScreen } from './screens/FontSelectScreen.js';
import { PresetScreen } from './screens/PresetScreen.js';
import { SegmentsScreen } from './screens/SegmentsScreen.js';
import { StyleScreen } from './screens/StyleScreen.js';
import { ShellScreen } from './screens/ShellScreen.js';
import { InstallingScreen } from './screens/InstallingScreen.js';
import { DoneScreen } from './screens/DoneScreen.js';

const STEP_ORDER: WizardStep[] = [
  'welcome',
  'fontcheck',
  'font_select',
  'preset',
  'segments_left',
  'segments_right',
  'style',
  'shells',
  'installing',
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
    setState((prev) => {
      const merged = { ...prev, ...update };
      const currentIndex = STEP_ORDER.indexOf(merged.step);
      let nextStep = STEP_ORDER[currentIndex + 1];

      if (!nextStep) return prev;

      // Skip font_select if the user doesn't want to install a font
      if (nextStep === 'font_select' && merged.nerdFontToInstall !== FONT_SELECT_SENTINEL) {
        const skipped = STEP_ORDER[currentIndex + 2];
        if (!skipped) return prev;
        nextStep = skipped;
      }

      return { ...merged, step: nextStep };
    });
  }

  function goBack() {
    setState((prev) => {
      const currentIndex = STEP_ORDER.indexOf(prev.step);
      let prevIndex = currentIndex - 1;

      // Skip font_select when going back if we never intended to visit it
      if (STEP_ORDER[prevIndex] === 'font_select' && prev.nerdFontToInstall === null) {
        prevIndex -= 1;
      }

      const prevStep = STEP_ORDER[prevIndex];
      return prevStep ? { ...prev, step: prevStep } : prev;
    });
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
          state={state}
          side="right"
          onNext={goNext}
          onUpdate={updateState}
          onBack={goBack}
        />
      );

    case 'style':
      return <StyleScreen state={state} onNext={goNext} onBack={goBack} />;

    case 'shells':
      return <ShellScreen state={state} onNext={goNext} onUpdate={updateState} onBack={goBack} />;

    case 'installing':
      return <InstallingScreen state={state} onNext={(update) => advanceTo('done', update)} />;

    case 'done':
      return <DoneScreen state={state} />;
  }
}
