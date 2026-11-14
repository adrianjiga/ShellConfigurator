import { type DependencyList, useEffect, useRef } from 'react';

/** Like useEffect, but skips the first render: runs only when a dependency changes. */
export function useUpdateEffect(effect: () => void, deps: DependencyList): void {
  const mounted = useRef(false);
  useEffect(
    () => {
      if (!mounted.current) {
        mounted.current = true;
        return;
      }
      effect();
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: the caller's deps decide when it runs.
    deps
  );
}
