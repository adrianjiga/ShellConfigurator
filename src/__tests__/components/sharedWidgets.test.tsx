import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppSelectInput } from '../../components/AppSelectInput.tsx';
import { NavHints } from '../../components/NavHints.tsx';
import { PickerRow } from '../../components/PickerRow.tsx';
import { flush } from '../helpers/wait.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('AppSelectInput', () => {
  const items = [
    { label: 'First', value: 1 },
    { label: 'Second', value: 2 },
  ];

  it('starts on initialIndex and selects the highlighted item', async () => {
    const onSelect = vi.fn();
    const instance = render(<AppSelectInput items={items} initialIndex={1} onSelect={onSelect} />);
    expect(instance.lastFrame()).toContain('› Second');

    instance.stdin.write('\r');
    await flush();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ value: 2 }));
  });
});

describe('PickerRow', () => {
  it('shows the hint only while focused', () => {
    const blurred = render(<PickerRow label="Zsh" hint="→ ~/.zshrc" />).lastFrame();
    expect(blurred).toContain('Zsh');
    expect(blurred).not.toContain('~/.zshrc');
    cleanup();

    const focused = render(<PickerRow label="Zsh" focused hint="→ ~/.zshrc" />).lastFrame();
    expect(focused).toContain('› Zsh');
    expect(focused).toContain('→ ~/.zshrc');
  });

  it('draws the marker before the label', () => {
    expect(render(<PickerRow label="Git" marker="[✓]" selected />).lastFrame()).toContain(
      '[✓] Git'
    );
  });
});

describe('NavHints', () => {
  it('lists every key with its action', () => {
    const frame = render(
      <NavHints
        hints={[
          { key: 'Enter', label: 'next' },
          { key: 'Esc', label: 'back' },
        ]}
      />
    ).lastFrame();
    expect(frame).toContain('Enter next');
    expect(frame).toContain('Esc back');
  });
});
