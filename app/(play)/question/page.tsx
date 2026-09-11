"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { ScaleSlider } from "@/components/scale-slider";
import { Button } from "@/components/ui/button";
import type { PlayerEvent } from "@/lib/types";

import { usePlayEvent } from "../layout";

type AskingEvent = Extract<PlayerEvent, { type: "asking" }>;

export default function QuestionPage() {
  const { event, pin } = usePlayEvent();
  const asking = event?.type === "asking" ? event : null;

  if (!asking || !pin) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Keying on the question index remounts this subtree for every new question, so the slider
  // guess and any stale submit error reset for free — no effect needed to sync them.
  return <QuestionForm key={asking.question.index} asking={asking} pin={pin} />;
}

function QuestionForm({ asking, pin }: { asking: AskingEvent; pin: string }) {
  const [value, setValue] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    function tick() {
      setSecondsLeft(Math.max(0, Math.round((asking.endsAt - Date.now()) / 1000)));
    }
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [asking.endsAt]);

  const timedOut = secondsLeft !== null && secondsLeft <= 0;
  const mm = secondsLeft === null ? "-" : String(Math.floor(secondsLeft / 60)).padStart(1, "0");
  const ss = secondsLeft === null ? "--" : String(secondsLeft % 60).padStart(2, "0");

  async function handleSubmit() {
    if (submitting || timedOut) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/rooms/${pin}/answers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionIndex: asking.question.index, value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setSubmitError(body?.error?.message ?? "ส่งคำตอบไม่สำเร็จ ลองใหม่อีกครั้ง");
        setSubmitting(false);
        return;
      }
      // Submission lands via the SSE roster broadcast; the layout routes to /waiting once
      // `yourAnswer` flips, so there's nothing further to do here on success.
    } catch {
      setSubmitError("ส่งคำตอบไม่สำเร็จ ลองใหม่อีกครั้ง");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-8">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          คำถามที่ {asking.question.index + 1} จาก {asking.question.total}
        </span>
        <span
          className={
            "font-mono text-lg font-semibold " +
            (secondsLeft !== null && secondsLeft <= 5 ? "text-destructive" : "text-foreground")
          }
        >
          {mm}:{ss}
        </span>
      </div>

      <h1 className="text-balance font-heading text-2xl font-semibold leading-snug text-foreground">
        {asking.question.text}
      </h1>

      <ScaleSlider value={value} onChange={setValue} minLabel="ไม่เห็นด้วยเลย" maxLabel="เห็นด้วยมาก" />

      {submitError && <p className="text-sm text-destructive">{submitError}</p>}

      <Button
        size="lg"
        className="mt-auto h-12 text-base"
        disabled={submitting || timedOut}
        onClick={handleSubmit}
      >
        {submitting ? <Loader2 className="size-4 animate-spin" /> : timedOut ? "หมดเวลา!" : "ส่งคำตอบ"}
      </Button>
    </div>
  );
}
