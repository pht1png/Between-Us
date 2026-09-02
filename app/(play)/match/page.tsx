import Link from "next/link";
import { Sparkles } from "lucide-react";

import { MatchMeter } from "@/components/match-meter";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

const MOCK_MATCH = {
  name: "พลอย",
  bio: "ชอบเดินป่ากับกาแฟดำ",
  compatibility: 87,
  reason: "คุณทั้งคู่ให้คะแนนเรื่องการวางแผนล่วงหน้าสูงพอ ๆ กัน",
};

export default function MatchPage() {
  const initials = MOCK_MATCH.name.charAt(0);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-10 text-center">
      <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
        <Sparkles className="size-3" />
        ผลลัพธ์ของคุณ
      </span>

      <MatchMeter percent={MOCK_MATCH.compatibility} size={180} />

      <Avatar className="size-20">
        <AvatarFallback className="text-2xl">{initials}</AvatarFallback>
      </Avatar>

      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">คนที่เข้ากับคุณมากที่สุดในห้องนี้คือ</p>
        <h1 className="font-heading text-2xl font-semibold text-foreground">{MOCK_MATCH.name}</h1>
        <p className="text-sm text-muted-foreground">{MOCK_MATCH.bio}</p>
      </div>

      <div className="w-full rounded-2xl bg-muted p-4 text-left">
        <p className="text-xs font-medium text-muted-foreground">เหตุผลที่เข้ากัน</p>
        <p className="mt-1 text-sm text-foreground">{MOCK_MATCH.reason}</p>
      </div>

      <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/" />}>
        กลับหน้าแรก
      </Button>
    </div>
  );
}
