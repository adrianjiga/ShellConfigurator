import { WizardState, STEP_ORDER, shouldVisitFontSelect } from './types.ts';

/**
 * Returns the state advanced to the next step, honoring the conditional
 * font_select skip. If there is no next step, the original state is returned
 * unchanged (any pending update is discarded).
 */
export function getNextStep(state: WizardState, update?: Partial<WizardState>): WizardState {
  const merged = { ...state, ...update };
  const currentIndex = STEP_ORDER.indexOf(merged.step);
  let nextStep = STEP_ORDER[currentIndex + 1];

  if (!nextStep) return state;

  // Skip font_select if the user doesn't want to install a font
  if (nextStep === 'font_select' && !shouldVisitFontSelect(merged.nerdFontToInstall)) {
    const skipped = STEP_ORDER[currentIndex + 2];
    if (!skipped) return state;
    nextStep = skipped;
  }

  return { ...merged, step: nextStep };
}

/**
 * Returns the state moved back a step, honoring the conditional font_select
 * skip. If there is no previous step, the state is returned unchanged.
 */
export function getPrevStep(state: WizardState): WizardState {
  const currentIndex = STEP_ORDER.indexOf(state.step);
  let prevIndex = currentIndex - 1;

  // Skip font_select when going back if we never intended to visit it
  if (STEP_ORDER[prevIndex] === 'font_select' && !shouldVisitFontSelect(state.nerdFontToInstall)) {
    prevIndex -= 1;
  }

  const prevStep = STEP_ORDER[prevIndex];
  return prevStep ? { ...state, step: prevStep } : state;
}
