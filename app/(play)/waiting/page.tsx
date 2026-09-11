"use client";

import { Users } from "lucide-react";

import { MatchMeter } from "@/components/match-meter";

import { usePlayEvent } from "../layout";

export default function WaitingPage() {
  const { event, pin } = usePlayEvent();

  if (!event || event.type === "reveal") {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <MatchMeter size={140} />
      </div>
    );
  }

  if (event.type === "lobby") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-10 text-center">
        <MatchMeter size={140} />
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-xl font-semibold text-foreground">รอเจ้าภาพเริ่มเกม</h1>
          <p className="text-sm text-muted-foreground">คุณเข้าร่วมห้อง {pin} แล้ว</p>
        </div>
      </div>
    );
  }

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
          ตอบแล้ว {event.answeredCount}/{event.totalParticipants} คน
        </span>
      </div>
    </div>
  );
}
