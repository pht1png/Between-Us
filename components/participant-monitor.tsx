import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Sex } from "@/lib/types";

export type MonitoredParticipant = {
  id: string;
  name: string;
  bio?: string;
  photo?: string | null;
  sex: Sex;
};

function sexLabel(sex: Sex) {
  return sex === "male" ? "ชาย" : "หญิง";
}

export function ParticipantMonitor({
  participants,
  emptyLabel = "ยังไม่มีใครเข้าร่วม",
}: {
  participants: MonitoredParticipant[];
  emptyLabel?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>ผู้เข้าร่วม ({participants.length})</CardTitle>
        <CardDescription>ข้อมูลโปรไฟล์ที่กรอกตอนเข้าร่วมห้อง</CardDescription>
      </CardHeader>
      <CardContent className="flex max-h-80 flex-col gap-2 overflow-y-auto">
        {participants.length === 0 && <p className="text-sm text-muted-foreground">{emptyLabel}</p>}
        {participants.map((participant) => (
          <div key={participant.id} className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2">
            <Avatar className="size-9">
              {participant.photo && <AvatarImage src={participant.photo} alt="" />}
              <AvatarFallback className="text-xs">{participant.name.charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-foreground">
                {participant.name}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  ({sexLabel(participant.sex)})
                </span>
              </span>
              {participant.bio && (
                <span className="text-xs text-muted-foreground">{participant.bio}</span>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
