"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Copy,
  LogOut,
  Plus,
  Sparkles,
  X,
} from "lucide-react";

import { ParticipantMonitor, type MonitoredParticipant } from "@/components/participant-monitor";
import { RoomQr } from "@/components/room-qr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRoomStream } from "@/lib/client-store";
import {
  SECTION_EXAMPLES_TH,
  SECTION_IDS,
  SECTION_LABELS_TH,
  type SectionId,
} from "@/lib/sections";
import type { HostEvent } from "@/lib/types";

type QuizQuestion = { id: string; text: string; duration: number; section: SectionId };

const DEFAULT_QUESTIONS: QuizQuestion[] = [
  { id: "q1", text: "คุณชอบอยู่ท่ามกลางคนเยอะ ๆ แค่ไหน?", duration: 20, section: "lifestyle" },
  { id: "q2", text: "คุณชอบวางแผนล่วงหน้ามากแค่ไหน?", duration: 20, section: "personality" },
  { id: "q3", text: "คุณเปิดรับไอเดียใหม่ ๆ แค่ไหน?", duration: 20, section: "values" },
  { id: "q4", text: "คุณเปิดใจคุยเรื่องความรู้สึกกับคนอื่นง่ายแค่ไหน?", duration: 20, section: "relationships" },
];

const STRAGGLER_LIST_THRESHOLD = 20;

function formatPin(pin: string) {
  return `${pin.slice(0, 3)} ${pin.slice(3)}`;
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

type AuthStatus = "checking" | "loggedOut" | "loggedIn";

export default function AdminPage() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const [questions, setQuestions] = useState<QuizQuestion[]>(DEFAULT_QUESTIONS);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [pin, setPin] = useState<string | null>(null);
  const [origin] = useState<string | null>(() =>
    typeof window !== "undefined" ? window.location.origin : null,
  );
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const stream = useRoomStream<HostEvent>(pin);
  const hostEvent = stream.status === "open" ? stream.data : null;

  // On mount, try to restore an in-progress room from the host_token cookie — this is also
  // how we learn "already logged in" without a dedicated whoami endpoint.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/rooms/current")
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          const event = (await res.json()) as HostEvent;
          setPin(event.pin);
          setAuthStatus("loggedIn");
        } else {
          setAuthStatus("loggedOut");
        }
      })
      .catch(() => {
        if (!cancelled) setAuthStatus("loggedOut");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Derived, not stored: a fatal stream (e.g. the room vanished after a server restart) just
  // means "no active room" — no separate effect needed to mirror it into state.
  const roomActive = pin !== null && stream.status !== "fatal";
  const streamFatalMessage = stream.status === "fatal" ? stream.message : null;

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    if (!password.trim() || loggingIn) return;
    setLoggingIn(true);
    setLoginError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setLoginError(await readErrorMessage(res, "รหัสผ่านไม่ถูกต้อง"));
        return;
      }
      setAuthStatus("loggedIn");
    } catch {
      setLoginError("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" }).catch(() => {});
    setAuthStatus("loggedOut");
    setPin(null);
    setPassword("");
  }

  function addQuestion(section: SectionId) {
    setQuestions((qs) => [...qs, { id: crypto.randomUUID(), text: "", duration: 20, section }]);
  }

  function updateQuestion(id: string, patch: Partial<QuizQuestion>) {
    setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  }

  /** A section must keep at least one question — every section is required, so removing the last
   * one would put the quiz into a state the server would reject anyway. */
  function removeQuestion(id: string) {
    setQuestions((qs) => {
      const target = qs.find((q) => q.id === id);
      if (!target) return qs;
      if (qs.filter((q) => q.section === target.section).length <= 1) return qs;
      return qs.filter((q) => q.id !== id);
    });
  }

  async function createRoom() {
    if (creatingRoom) return;
    setCreatingRoom(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/admin/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Sent in section order so the host's authoring order doesn't matter — scoring reads
          // each question's own section, but a stable order keeps the play sequence predictable.
          questions: SECTION_IDS.flatMap((section) =>
            questions
              .filter((q) => q.section === section)
              .map((q) => ({ text: q.text.trim(), duration: q.duration, section: q.section })),
          ),
        }),
      });
      if (!res.ok) {
        setCreateError(await readErrorMessage(res, "สร้างห้องไม่สำเร็จ"));
        return;
      }
      const body = (await res.json()) as { pin: string };
      setPin(body.pin);
    } catch {
      setCreateError("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setCreatingRoom(false);
    }
  }

  async function startGame() {
    if (!pin) return;
    setActionError(null);
    const res = await fetch(`/api/admin/rooms/${pin}/start`, { method: "POST" });
    if (!res.ok) setActionError(await readErrorMessage(res, "เริ่มเกมไม่สำเร็จ"));
  }

  async function nextQuestion() {
    if (!pin) return;
    setActionError(null);
    const res = await fetch(`/api/admin/rooms/${pin}/advance`, { method: "POST" });
    if (!res.ok) setActionError(await readErrorMessage(res, "ไปข้อถัดไปไม่สำเร็จ"));
  }

  async function endGame() {
    if (!pin) return;
    setActionError(null);
    const res = await fetch(`/api/admin/rooms/${pin}/end`, { method: "POST" });
    if (!res.ok) setActionError(await readErrorMessage(res, "จบเกมไม่สำเร็จ"));
  }

  function resetForNewRoom() {
    setPin(null);
    setActionError(null);
  }

  async function handleCopyLink() {
    if (!pin || !origin) return;
    try {
      await navigator.clipboard.writeText(`${origin}/join?pin=${pin}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be blocked by permissions; the QR code still works either way.
    }
  }

  if (authStatus === "checking") {
    return <div className="flex min-h-dvh flex-1 items-center justify-center bg-background" />;
  }

  if (authStatus === "loggedOut") {
    return (
      <div className="flex min-h-dvh flex-1 items-center justify-center bg-background px-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="font-heading text-xl">Between Us · ผู้ดูแล</CardTitle>
            <CardDescription>เข้าสู่ระบบด้วยรหัสผ่านผู้จัดงาน</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">รหัสผ่านผู้ดูแล</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  autoFocus
                  required
                />
              </div>
              {loginError && <p className="text-sm text-destructive">{loginError}</p>}
              <Button type="submit" size="lg" className="h-11 text-base" disabled={loggingIn}>
                เข้าสู่ระบบ
              </Button>
            </form>
          </CardContent>
          <CardFooter className="justify-center">
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/" />}>
              กลับหน้าแรก
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  const header = (
    <div className="flex items-center justify-between">
      <span className="font-heading text-lg font-semibold text-foreground">
        Between Us · ผู้ดูแล
      </span>
      <Button variant="ghost" size="sm" onClick={handleLogout}>
        <LogOut className="size-4" />
        ออกจากระบบ
      </Button>
    </div>
  );

  if (!roomActive) {
    const emptySections = SECTION_IDS.filter((id) => !questions.some((q) => q.section === id));
    const canCreateRoom =
      emptySections.length === 0 && questions.every((q) => q.text.trim().length > 0);
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
        {header}
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>คำถาม 4 หมวด (สเกล 1-10)</CardTitle>
              <CardDescription>
                ผู้เล่นให้คะแนนแต่ละข้อตั้งแต่ 1 ถึง 10 · ทุกหมวดต้องมีคำถามอย่างน้อย 1 ข้อ
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              {SECTION_IDS.map((section) => {
                const sectionQuestions = questions.filter((q) => q.section === section);
                return (
                  <div key={section} className="flex flex-col gap-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="font-heading text-base font-semibold text-foreground">
                        {SECTION_LABELS_TH[section]}
                      </h3>
                      <span className="text-xs text-muted-foreground">
                        {sectionQuestions.length} คำถาม
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{SECTION_EXAMPLES_TH[section]}</p>

                    {sectionQuestions.length === 0 && (
                      <p className="text-sm text-destructive">ยังไม่มีคำถามในหมวดนี้</p>
                    )}

                    {sectionQuestions.map((question) => (
                      <div
                        key={question.id}
                        className="flex items-start gap-2 rounded-xl border border-border p-3"
                      >
                        <div className="flex flex-1 flex-col gap-2">
                          <Input
                            value={question.text}
                            onChange={(event) =>
                              updateQuestion(question.id, { text: event.target.value })
                            }
                            placeholder={SECTION_EXAMPLES_TH[section]}
                          />
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>เวลาต่อข้อ</span>
                            <Input
                              type="number"
                              min={5}
                              max={120}
                              value={question.duration}
                              onChange={(event) =>
                                updateQuestion(question.id, { duration: Number(event.target.value) })
                              }
                              className="h-7 w-20"
                            />
                            <span>วินาที</span>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeQuestion(question.id)}
                          disabled={sectionQuestions.length <= 1}
                          aria-label="ลบคำถาม"
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    ))}

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => addQuestion(section)}
                      className="self-start"
                    >
                      <Plus className="size-4" />
                      เพิ่มคำถามในหมวดนี้
                    </Button>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>สร้างห้อง</CardTitle>
                <CardDescription>สร้างรหัส PIN และ QR สำหรับผู้เข้าร่วม</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Button
                  size="lg"
                  className="h-11 w-full text-base"
                  disabled={!canCreateRoom || creatingRoom}
                  onClick={createRoom}
                >
                  สร้างห้อง
                </Button>
                {emptySections.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    ต้องเพิ่มคำถามในหมวด:{" "}
                    {emptySections.map((id) => SECTION_LABELS_TH[id]).join(", ")}
                  </p>
                )}
                {(createError ?? streamFatalMessage) && (
                  <p className="text-sm text-destructive">{createError ?? streamFatalMessage}</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  if (!hostEvent) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
        {header}
        <p className="text-sm text-muted-foreground">กำลังเชื่อมต่อห้อง {pin}...</p>
      </div>
    );
  }

  const participants: MonitoredParticipant[] = hostEvent.participants.map((p) => ({
    id: p.id,
    name: p.name,
    bio: p.bio,
    photo: p.photoUrl,
    sex: p.sex,
  }));

  if (hostEvent.type === "lobby") {
    const joinUrl = origin ? `${origin}/join?pin=${pin}` : null;
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
        {header}
        <div className="grid items-start gap-6 lg:grid-cols-[auto_1fr]">
          <Card className="flex flex-col items-center gap-4 p-6">
            <span className="text-sm text-muted-foreground">รหัสห้อง</span>
            <span className="font-mono text-4xl font-semibold tracking-widest text-foreground">
              {formatPin(pin)}
            </span>
            {joinUrl && <RoomQr url={joinUrl} size={180} />}
            <Button variant="outline" size="sm" onClick={handleCopyLink} disabled={!joinUrl}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "คัดลอกแล้ว" : "คัดลอกลิงก์"}
            </Button>
          </Card>

          <div className="flex flex-col gap-4">
            <ParticipantMonitor
              participants={participants}
              emptyLabel="รอผู้เล่นสแกน QR หรือกรอกรหัส..."
            />
            {actionError && <p className="text-sm text-destructive">{actionError}</p>}
            <Button
              size="lg"
              className="h-11 w-full text-base"
              disabled={participants.length === 0}
              onClick={startGame}
            >
              เริ่มเกม
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (hostEvent.type === "asking") {
    const answeredCount = participants.length - hostEvent.participants.filter((p) => !p.answered).length;
    const notAnswered = hostEvent.participants.filter((p) => !p.answered);
    const progressPercent =
      participants.length === 0 ? 0 : Math.round((answeredCount / participants.length) * 100);
    const maxCount = Math.max(...hostEvent.distribution, 1);
    const isLastQuestion = hostEvent.currentIndex + 1 >= hostEvent.totalQuestions;

    return (
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
        {header}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>
                คำถามที่ {hostEvent.currentIndex + 1} จาก {hostEvent.totalQuestions}
              </CardTitle>
              <CardDescription>{hostEvent.question.text}</CardDescription>
            </div>
            <Badge variant="secondary">
              {answeredCount}/{participants.length} ตอบแล้ว
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              {hostEvent.distribution.map((count, index) => (
                <div key={index} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex h-24 w-full items-end">
                    <div
                      className="w-full rounded-t-md bg-accent/70"
                      style={{ height: `${(count / maxCount) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">{index + 1}</span>
                </div>
              ))}
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            {actionError && <p className="text-sm text-destructive">{actionError}</p>}
            <div className="flex w-full gap-3">
              <Button size="lg" className="h-11 flex-1 text-base" onClick={nextQuestion}>
                {isLastQuestion ? "ดูผลสรุป" : "ข้อถัดไป"}
                <ArrowRight className="size-4" />
              </Button>
              <Button size="lg" variant="outline" className="h-11 text-base" onClick={endGame}>
                จบเกม
              </Button>
            </div>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">ความคืบหน้าการตอบคำถามนี้</CardTitle>
            <CardDescription>
              {answeredCount} จาก {participants.length} คนตอบแล้ว ({progressPercent}%)
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-secondary transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {notAnswered.length === 0 ? (
              <p className="text-sm text-secondary">ทุกคนตอบครบแล้ว 🎉</p>
            ) : notAnswered.length <= STRAGGLER_LIST_THRESHOLD ? (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground">
                  ยังไม่ตอบ ({notAnswered.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {notAnswered.map((participant) => (
                    <Badge key={participant.id} variant="outline">
                      {participant.name}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                รอผู้เล่นอีก {notAnswered.length} คน — จะแสดงรายชื่อเมื่อเหลือไม่เกิน {STRAGGLER_LIST_THRESHOLD} คน
              </p>
            )}
          </CardContent>
        </Card>

        <ParticipantMonitor participants={participants} />
      </div>
    );
  }

  // hostEvent.type === "ended"
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-10">
      {header}
      <div className="flex flex-1 flex-col items-center gap-6 text-center">
        <Sparkles className="size-8 text-accent" />
        <h1 className="font-heading text-2xl font-semibold text-foreground">จบเกมแล้ว</h1>
        <div className="flex gap-6 text-sm text-muted-foreground">
          <span>{participants.length} ผู้เข้าร่วม</span>
          <span>{hostEvent.groups.length} กลุ่ม</span>
        </div>

        <div className="flex w-full flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">ผลการจับคู่</p>
          {hostEvent.groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">ไม่มีการจับคู่ในรอบนี้</p>
          ) : (
            <div className="flex flex-col gap-2">
              {hostEvent.groups.map((group, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-4 py-3 text-left"
                >
                  <span className="text-sm text-foreground">{group.memberNames.join(" · ")}</span>
                  {group.formedVia !== "primary-pair" && (
                    <Badge variant="outline" className="shrink-0">
                      จับคู่พิเศษ
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <Button size="lg" className="h-11 text-base" onClick={resetForNewRoom}>
          สร้างห้องใหม่
        </Button>

        <div className="w-full text-left">
          <ParticipantMonitor participants={participants} />
        </div>
      </div>
    </div>
  );
}
