"use client";

import { useEffect, useRef } from "react";

/** Keep viewport chrome in the visible screen after Safari's keyboard resizes it. */
export function useAdminViewport() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const shell = ref.current;
    if (!shell) return;
    const viewport = window.visualViewport;
    let frame = 0;
    let settleTimer = 0;
    function measure() {
      frame = 0;
      // Preserve normal pinch zoom rather than chasing the magnified viewport.
      const unzoomed = !viewport || Math.abs(viewport.scale - 1) < 0.01;
      const height = unzoomed && viewport ? viewport.height : window.innerHeight;
      const top = unzoomed && viewport ? Math.max(0, viewport.offsetTop) : 0;
      shell!.style.setProperty("--admin-viewport-height", `${height}px`);
      shell!.style.setProperty("--admin-viewport-top", `${top}px`);
    }
    function update() {
      if (!frame) frame = requestAnimationFrame(measure);
    }
    function settle() {
      update();
      // iOS can publish its final keyboard geometry after focusout/pageshow.
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(update, 350);
    }
    measure();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", settle);
    window.addEventListener("pageshow", settle);
    document.addEventListener("focusout", settle);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", settle);
      window.removeEventListener("pageshow", settle);
      document.removeEventListener("focusout", settle);
      shell.style.removeProperty("--admin-viewport-height");
      shell.style.removeProperty("--admin-viewport-top");
    };
  }, []);

  return ref;
}
