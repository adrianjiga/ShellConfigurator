/**
 * Terminal colour policy for the wizard's own UI.
 *
 * The screens paint themselves with Ink's `color`, `backgroundColor`, and
 * `borderColor` props, and Ink routes those through chalk. Chalk does not honour
 * the `NO_COLOR` convention, so every colour prop goes through `uiColor`
 * instead: it returns the colour normally, or `undefined` when the user asked
 * for no colour, which makes Ink render the text unstyled.
 *
 * The convention (https://no-color.org) is "present and non-empty", so an empty
 * `NO_COLOR=` leaves colour on.
 */
export function colorsEnabled(): boolean {
  return !process.env.NO_COLOR;
}

/**
 * The colour to hand to an Ink prop, or `undefined` when colour is off.
 *
 * Only hue is removed: bold, dim, italic, and the cursor markers still apply, so
 * the screen keeps its hierarchy without relying on colour.
 */
export function uiColor(color: string | undefined): string | undefined {
  return colorsEnabled() ? color : undefined;
}
