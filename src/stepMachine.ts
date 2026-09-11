import { STEP_ORDER, shouldVisitFontSelect, type WizardState, type WizardStep } from './types.ts';

/** Steps that perform or report irreversible work — never re-enterable via back. */
const TERMINAL_STEPS: WizardStep[] = ['installing', 'done'];

/**
 * The first step after `currentIndex` that this state must actually visit,
 * walking past conditional steps whose condition is false:
 * - font_select is skipped when no font is being installed;
 * - installing is skipped entirely in dry-run mode.
 * Returns undefined when the walk runs off the end of the order.
 */
function skipConditional(state: WizardState, currentIndex: number): WizardStep | undefined {
  for (let i = currentIndex + 1; i < STEP_ORDER.length; i += 1) {
    const candidate = STEP_ORDER[i];
    const mustSkip =
      (candidate === 'font_select' && !shouldVisitFontSelect(state.nerdFontToInstall)) ||
      (candidate === 'installing' && state.dryRun);
    if (!mustSkip) return candidate;
  }
  return undefined;
}

/**
 * Returns the state advanced to the next step, honoring the conditional step
 * skips. A pending update is always merged in — even when no further step
 * exists, so an update is never silently dropped at the end boundary.
 */
export function getNextStep(state: WizardState, update?: Partial<WizardState>): WizardState {
  const merged = { ...state, ...update };
  const nextStep = skipConditional(merged, STEP_ORDER.indexOf(merged.step));
  if (!nextStep) return update ? merged : state;
  return { ...merged, step: nextStep };
}

/**
 * Returns the state moved back a step, honoring the conditional font_select
 * skip. If there is no previous step, the state is returned unchanged.
 */
export function getPrevStep(state: WizardState): WizardState {
  // Once installing has begun there is no going back: re-entering it would re-run
  // every install, including chsh and the config overwrite.
  if (TERMINAL_STEPS.includes(state.step)) return state;

  // Walk backwards past font_select when we never intended to visit it.
  for (let i = STEP_ORDER.indexOf(state.step) - 1; i >= 0; i -= 1) {
    const candidate = STEP_ORDER[i];
    if (candidate === 'font_select' && !shouldVisitFontSelect(state.nerdFontToInstall)) continue;
    return { ...state, step: candidate };
  }
  return state;
}
