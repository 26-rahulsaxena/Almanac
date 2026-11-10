import { useEffect, useRef } from "react";

// Makes an element behave as a modal for the keyboard: focus moves in, Tab stays inside, Escape closes,
// and focus returns to where it was when the dialog closes.
export function useDialog<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const before = document.activeElement as HTMLElement | null;
    const focusables = () =>
      [...el.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter(
        (x) => !x.hasAttribute("disabled") && !x.closest("[inert], fieldset:disabled"),
      );
    (el.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0])?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // An open dropdown (select.tsx) or time picker (time-wheel.tsx) closes first.
        if ((e.target as Element).closest?.('[aria-haspopup][aria-expanded="true"], [data-popup]')) return;
        e.stopPropagation();
        close.current();
      } else if (e.key === "Tab") {
        e.stopPropagation();
        const f = focusables();
        if (e.shiftKey && document.activeElement === f[0]) {
          e.preventDefault();
          f.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === f.at(-1)) {
          e.preventDefault();
          f[0]?.focus();
        }
      }
    }
    el.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("keydown", onKey);
      before?.focus();
    };
  }, []);

  return ref;
}
