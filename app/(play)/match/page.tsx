"use client";

import Link from "next/link";
import { Sparkles, Users } from "lucide-react";

import { MatchMeter } from "@/components/match-meter";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

import { usePlayEvent } from "../layout";

export default function MatchPage() {
  const { event } = usePlayEvent();

  if (!event || event.type !== "reveal") {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <MatchMeter size={140} />
      </div>
    );
  }

  const { reveal } = event;

  if (reveal.status === "unmatched") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-10 text-center">
        <Users className="size-10 text-muted-foreground" />
        <h1 className="font-heading text-xl font-semibold text-foreground">
          ยังไม่พบคู่ที่เข้ากันในรอบนี้
        </h1>
        <p className="max-w-65 text-sm text-muted-foreground">
          อาจเป็นเพราะคุณตอบคำถามไม่ครบ หรือจำนวนผู้เข้าร่วมไม่พอจะจับคู่ในรอบนี้
        </p>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/" />}>
          กลับหน้าแรก
        </Button>
      </div>
    );
  }

  const { groupmates } = reveal;
  const average = Math.round(groupmates.reduce((sum, g) => sum + g.compatibility, 0) / groupmates.length);
  const isGroup = groupmates.length > 1;

  return (
    <div className="flex flex-1 flex-col items-center gap-6 px-6 py-10 text-center">
      <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
        <Sparkles className="size-3" />
        ผลลัพธ์ของคุณ
      </span>

      <MatchMeter percent={average} size={180} />

      <p className="text-sm text-muted-foreground">
        {isGroup ? `คุณได้จับกลุ่มกับ ${groupmates.length} คนนี้` : "คนที่เข้ากับคุณมากที่สุดในห้องนี้คือ"}
      </p>

      <div className="flex w-full flex-col gap-3 text-left">
        {groupmates.map((mate) => (
          <div key={mate.id} className="flex gap-3 rounded-2xl bg-muted p-4">
            <Avatar className="size-12 shrink-0">
              {mate.photoUrl && <AvatarImage src={mate.photoUrl} alt="" />}
              <AvatarFallback>{mate.name.charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="flex flex-1 flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-heading text-base font-semibold text-foreground">{mate.name}</h2>
                <span className="font-mono text-sm font-semibold text-accent">{mate.compatibility}%</span>
              </div>
              <p className="text-sm text-muted-foreground">{mate.bio}</p>
              <p className="mt-1 text-xs text-foreground">{mate.reason}</p>
            </div>
          </div>
        ))}
      </div>

      <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/" />}>
        กลับหน้าแรก
      </Button>
    </div>
  );
}
