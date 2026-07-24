import { useCallback, useRef, useState } from "react";

export interface UseClipboardOptions {
  /** How long the `copied` flag stays true, in ms. */
  timeout?: number;
}

export function useClipboard({ timeout = 2000 }: UseClipboardOptions = {}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(
    async (value: string) => {
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(value);
        } else {
          const el = document.createElement("textarea");
          el.value = value;
          el.style.position = "fixed";
          el.style.opacity = "0";
          document.body.appendChild(el);
          el.select();
          document.execCommand("copy");
          document.body.removeChild(el);
        }
        setCopied(true);
        setError(null);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), timeout);
      } catch (err) {
        setError(err as Error);
        setCopied(false);
      }
    },
    [timeout],
  );

  return { copied, error, copy };
}
