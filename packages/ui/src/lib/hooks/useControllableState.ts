import { useCallback, useRef, useState } from "react";

export interface UseControllableStateParams<T> {
  value?: T;
  defaultValue?: T;
  onChange?: (value: T) => void;
}

/** Support both controlled and uncontrolled component patterns. */
export function useControllableState<T>({
  value: controlled,
  defaultValue,
  onChange,
}: UseControllableStateParams<T>): [T, (next: T) => void] {
  const [uncontrolled, setUncontrolled] = useState<T | undefined>(defaultValue);
  const isControlled = controlled !== undefined;
  const value = (isControlled ? controlled : uncontrolled) as T;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const setValue = useCallback(
    (next: T) => {
      if (!isControlled) setUncontrolled(next);
      onChangeRef.current?.(next);
    },
    [isControlled],
  );

  return [value, setValue];
}
