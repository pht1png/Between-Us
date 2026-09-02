"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";

import { ScaleSlider } from "@/components/scale-slider";
import { Button } from "@/components/ui/button";

const QUESTION = {
  index: 2,
  total: 5,
  text: "คุณชอบวางแผนล่วงหน้ามากแค่ไหน?",
  minLabel: "ไม่ชอบเลย",
  maxLabel: "ชอบมาก",
};
const DURATION_SECONDS = 20;

export default function QuestionPage() {
  const router = useRouter();
  const [value, setValue] = useState(5);
  const [secondsLeft, setSecondsLeft] = useState(DURATION_SECONDS);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // No backend yet — countdown and submission are simulated client-side.
  useEffect(() => {
    if (submitted || secondsLeft <= 0) return;
    const id = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [secondsLeft, submitted]);

  useEffect(() => {
    if (submitted || secondsLeft > 0) return;
    const t = setTimeout(() => router.push("/waiting"), 800);
    return () => clearTimeout(t);
  }, [secondsLeft, submitted, router]);

  async function handleSubmit() {
    if (submitted || submitting) return;
    setSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 400));
    setSubmitting(false);
    setSubmitted(true);
    setTimeout(() => router.push("/waiting"), 500);
  }

  const timedOut = secondsLeft <= 0 && !submitted;
  const mm = String(Math.floor(Math.max(secondsLeft, 0) / 60)).padStart(1, "0");
  const ss = String(Math.max(secondsLeft, 0) % 60).padStart(2, "0");

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-8">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          คำถามที่ {QUESTION.index} จาก {QUESTION.total}
        </span>
        <span
          className={
            "font-mono text-lg font-semibold " +
            (secondsLeft <= 5 ? "text-destructive" : "text-foreground")
          }
        >
          {mm}:{ss}
        </span>
      </div>

      <h1 className="text-balance font-heading text-2xl font-semibold leading-snug text-foreground">
        {QUESTION.text}
      </h1>

      <ScaleSlider
        value={value}
        onChange={setValue}
        minLabel={QUESTION.minLabel}
        maxLabel={QUESTION.maxLabel}
      />

      <Button
        size="lg"
        className="mt-auto h-12 text-base"
        disabled={submitted || submitting || timedOut}
        onClick={handleSubmit}
      >
        {submitting ? (
          <Loader2 className="size-4 animate-spin" />
        ) : submitted ? (
          <>
            <Check className="size-4" />
            ส่งคำตอบแล้ว
          </>
        ) : timedOut ? (
          "หมดเวลา!"
        ) : (
          "ส่งคำตอบ"
        )}
      </Button>
    </div>
  );
}
