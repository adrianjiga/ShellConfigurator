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
    const merged = { ...state, ...update };
    const currentIndex = STEP_ORDER.indexOf(merged.step);
    let nextStep = STEP_ORDER[currentIndex + 1];

    if (!nextStep) return;

    // Skip font_select if the user doesn't want to install a font
    // (sentinel FONT_SELECT_SENTINEL means "go to font_select")
    if (nextStep === 'font_select' && merged.nerdFontToInstall !== FONT_SELECT_SENTINEL) {
      nextStep = STEP_ORDER[currentIndex + 2]!;
    }

    advanceTo(nextStep, update);
  }

  function goBack() {
    const currentIndex = STEP_ORDER.indexOf(state.step);
    let prevIndex = currentIndex - 1;

    // Skip font_select when going back if we didn't come from it
    if (STEP_ORDER[prevIndex] === 'font_select' && state.nerdFontToInstall !== FONT_SELECT_SENTINEL) {
      prevIndex -= 1;
    }

    const prevStep = STEP_ORDER[prevIndex];
    if (prevStep) setState((prev) => ({ ...prev, step: prevStep }));
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
      return <InstallingScreen state={state} onNext={() => advanceTo('done')} />;

    case 'done':
      return <DoneScreen state={state} />;
  }
}
