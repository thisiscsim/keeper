import { useEffect } from "react";

/**
 * Invoke `onEscape` when the user presses Escape. Pass null/undefined to
 * disable (e.g. while an operation is in flight and dismissing is not allowed).
 */
export function useEscapeKey(onEscape: (() => void) | null | undefined): void {
  useEffect(() => {
    if (!onEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEscape]);
}
