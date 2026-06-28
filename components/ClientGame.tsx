"use client";

import dynamic from "next/dynamic";

const StarCollectorGame = dynamic(() => import("./StarCollectorGame"), {
  ssr: false,
  loading: () => <div style={{ width: "100%", height: "100%", background: "#080818" }} />,
});

export default function ClientGame() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#080818" }}>
      <StarCollectorGame />
    </div>
  );
}
