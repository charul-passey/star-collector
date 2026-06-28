"use client";

import { useEffect, useRef } from "react";

export default function ClientGame() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let cleanup: (() => void) | undefined;
    import("../lib/game").then(({ startGame }) => {
      if (mountRef.current) cleanup = startGame(mountRef.current);
    });
    return () => cleanup?.();
  }, []);

  return (
    <div
      ref={mountRef}
      style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#080818", display: "block" }}
    />
  );
}
