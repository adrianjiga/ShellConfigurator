import { describe, expect, it } from 'vitest';
import { assertNever } from '../types.ts';

describe('assertNever', () => {
  it('throws with the unhandled value in the message', () => {
    expect(() => assertNever('typescript-config' as never)).toThrow('typescript-config');
    expect(() => assertNever('vivid' as never)).toThrow(/^Unhandled value: vivid/);
  });

  it('uses the supplied message instead of the default', () => {
    expect(() => assertNever({} as never, 'Never here')).toThrow('Never here');
  });
});
