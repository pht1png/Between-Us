import Link from "next/link";
import { HeartHandshake, ListChecks, QrCode } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const STEPS = [
  {
    icon: QrCode,
    title: "กรอกรหัสห้อง",
    description: "สแกน QR หรือใส่รหัส 6 หลักจากเจ้าภาพงาน",
  },
  {
    icon: ListChecks,
    title: "ตอบคำถามสั้น ๆ",
    description: "ให้คะแนนคำถามเกี่ยวกับตัวคุณตั้งแต่ 1 ถึง 10",
  },
  {
    icon: HeartHandshake,
    title: "เจอคู่ที่เข้ากับคุณ",
    description: "ดูเปอร์เซ็นต์ความเข้ากันและเหตุผลที่แมตช์กัน",
  },
];

const USE_CASES = ["ละลายพฤติกรรม", "งานสัมมนา", "มีตติ้งขนาดเล็ก-กลาง"];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <span className="font-heading text-xl font-semibold text-foreground">
          Between Us
        </span>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/admin" />}>
          สำหรับผู้จัดงาน
        </Button>
      </header>

      <main className="flex flex-1 flex-col items-center px-6">
        <section className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 py-16 text-center sm:py-24">
          <h1 className="text-balance font-heading text-4xl font-semibold leading-tight text-foreground sm:text-5xl">
            เจอคนที่เข้ากับคุณ ในงานที่คุณอยู่
          </h1>
          <p className="text-balance text-lg leading-relaxed text-muted-foreground">
            ตอบคำถามสนุก ๆ ไม่กี่ข้อ แล้วให้เราจับคู่คุณกับคนที่เข้ากันที่สุดในห้องนี้
          </p>
          <div className="flex flex-col items-center gap-3">
            <Button size="lg" className="h-12 px-8 text-base" nativeButton={false} render={<Link href="/join" />}>
              เข้าร่วมห้อง
            </Button>
            <span className="text-sm text-muted-foreground">ใช้เวลาไม่ถึง 2 นาที</span>
          </div>
        </section>

        <section className="grid w-full max-w-4xl grid-cols-1 gap-6 pb-16 sm:grid-cols-3 sm:pb-24">
          {STEPS.map(({ icon: Icon, title, description }, index) => (
            <div
              key={title}
              className="flex flex-col items-center gap-3 rounded-2xl bg-card p-6 text-center ring-1 ring-border"
            >
              <span className="flex size-11 items-center justify-center rounded-full bg-accent/10 text-accent">
                <Icon className="size-5" />
              </span>
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <span className="font-mono">{String(index + 1).padStart(2, "0")}</span>
              </div>
              <h2 className="font-heading text-base font-semibold text-foreground">
                {title}
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            </div>
          ))}
        </section>

        <section className="flex w-full max-w-2xl flex-wrap items-center justify-center gap-2 pb-20">
          {USE_CASES.map((useCase) => (
            <Badge key={useCase} variant="secondary" className="px-3 py-1">
              {useCase}
            </Badge>
          ))}
        </section>
      </main>

      <footer className="mx-auto w-full max-w-5xl px-6 py-8 text-center text-sm text-muted-foreground">
        Between Us
      </footer>
    </div>
  );
}
