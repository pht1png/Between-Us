"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";

import { MatchMeter } from "@/components/match-meter";

const TOTAL_MOCK = 42;

export default function WaitingPage() {
  const router = useRouter();
  const [answered, setAnswered] = useState(18);

  // No backend yet — the answered count is simulated and this auto-advances
  // where the real flow would wait for a server-pushed "reveal" event.
  useEffect(() => {
    const id = setInterval(() => {
      setAnswered((n) => Math.min(TOTAL_MOCK, n + Math.ceil(Math.random() * 3)));
    }, 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => router.push("/match"), 4000);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-10 text-center">
      <MatchMeter size={140} />
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold text-foreground">
          รอผู้เล่นคนอื่นตอบให้ครบ
        </h1>
        <p className="text-sm text-muted-foreground">คุณตอบคำถามนี้แล้ว เก่งมาก!</p>
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Users className="size-4" />
        <span>
          ตอบแล้ว {answered}/{TOTAL_MOCK} คน
        </span>
      </div>
    </div>
  );
}
