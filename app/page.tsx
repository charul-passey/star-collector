import dynamic from "next/dynamic";

const StarCollectorGame = dynamic(() => import("@/components/StarCollectorGame"), { ssr: false });

export default function Home() {
  return (
    <div className="w-screen h-screen overflow-hidden bg-[#0a0a1a]">
      <StarCollectorGame />
    </div>
  );
}
