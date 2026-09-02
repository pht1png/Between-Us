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

import { MatchMeter } from "@/components/match-meter";
import { ParticipantMonitor } from "@/components/participant-monitor";
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

type QuizQuestion = { id: string; text: string; duration: number };
type Phase = "setup" | "lobby" | "live" | "ended";
type MockParticipant = { id: string; name: string; bio: string; answered: boolean };

const DEFAULT_QUESTIONS: QuizQuestion[] = [
  { id: "q1", text: "คุณชอบวางแผนล่วงหน้ามากแค่ไหน?", duration: 20 },
  { id: "q2", text: "คุณเปิดรับไอเดียใหม่ ๆ แค่ไหน?", duration: 20 },
  { id: "q3", text: "คุณชอบอยู่ท่ามกลางคนเยอะ ๆ แค่ไหน?", duration: 20 },
];

const NAME_POOL = ["มายด์", "บีม", "พลอย", "แนน", "ไอซ์", "ตูน", "นัท", "ฟ้า", "จ๊อบ", "เอิร์ธ"];
const BIO_POOL = [
  "ชอบเที่ยวคาเฟ่กับดูหนังสยองขวัญ",
  "ชอบดูซีรีส์กับกินของหวาน",
  "ชอบเดินป่ากับกาแฟดำ",
  "ชอบอ่านหนังสือกับฟังเพลงอินดี้",
  "ชอบถ่ายรูปกับเดินทางคนเดียว",
  "ชอบทำอาหารกับดูการ์ตูน",
  "ชอบเล่นเกมกับดูบอล",
  "ชอบวาดรูปกับฟังพอดแคสต์",
  "ชอบปั่นจักรยานกับกินเผ็ด",
  "ชอบร้องเพลงกับเลี้ยงแมว",
];

// Sized well past the 100-participant target so the monitor UI is actually validated at scale,
// not just eyeballed with a handful of mock people.
const TOTAL_MOCK_PARTICIPANTS = 64;
const STRAGGLER_LIST_THRESHOLD = 20;

function nameForIndex(index: number) {
  return index < NAME_POOL.length ? NAME_POOL[index] : `ผู้เล่น ${index + 1}`;
}

function bioForIndex(index: number) {
  return BIO_POOL[index % BIO_POOL.length];
}

const MOCK_TOP_MATCHES = [
  { a: "มายด์", b: "บีม", percent: 92 },
  { a: "พลอย", b: "แนน", percent: 88 },
];

function randomDistribution() {
  return Array.from({ length: 10 }, () => Math.floor(Math.random() * 8) + 1);
}

function formatPin(pin: string) {
  return `${pin.slice(0, 3)} ${pin.slice(3)}`;
}

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState("");

  const [phase, setPhase] = useState<Phase>("setup");
  const [questions, setQuestions] = useState<QuizQuestion[]>(DEFAULT_QUESTIONS);
  const [pin, setPin] = useState<string | null>(null);
  const [origin] = useState<string | null>(() =>
    typeof window !== "undefined" ? window.location.origin : null,
  );
  const [copied, setCopied] = useState(false);
  const [participants, setParticipants] = useState<MockParticipant[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [distribution, setDistribution] = useState<number[]>(randomDistribution());

  function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    if (!password.trim()) return;
    // Mock gate — the real check compares against process.env.HOST_SECRET server-side (Milestone B).
    setAuthed(true);
  }

  function addQuestion() {
    setQuestions((qs) => [...qs, { id: crypto.randomUUID(), text: "", duration: 20 }]);
  }

  function updateQuestion(id: string, patch: Partial<QuizQuestion>) {
    setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  }

  function removeQuestion(id: string) {
    setQuestions((qs) => (qs.length > 1 ? qs.filter((q) => q.id !== id) : qs));
  }

  function createRoom() {
    const generatedPin = String(Math.floor(100000 + Math.random() * 900000));
    setPin(generatedPin);
    setParticipants([]);
    setPhase("lobby");
  }

  // No backend yet — simulates guests joining the lobby in bursts, up to TOTAL_MOCK_PARTICIPANTS.
  useEffect(() => {
    if (phase !== "lobby") return;
    const id = setInterval(() => {
      setParticipants((current) => {
        if (current.length >= TOTAL_MOCK_PARTICIPANTS) return current;
        const batchSize = Math.min(4, TOTAL_MOCK_PARTICIPANTS - current.length);
        const joined = Array.from({ length: batchSize }, (_, i) => {
          const index = current.length + i;
          return { id: crypto.randomUUID(), name: nameForIndex(index), bio: bioForIndex(index), answered: false };
        });
        return [...current, ...joined];
      });
    }, 300);
    return () => clearInterval(id);
  }, [phase]);

  function startGame() {
    setCurrentQuestionIndex(0);
    setDistribution(randomDistribution());
    setParticipants((ps) => ps.map((p) => ({ ...p, answered: false })));
    setPhase("live");
  }

  // No backend yet — simulates answers arriving for the current question, in bursts.
  useEffect(() => {
    if (phase !== "live") return;
    const id = setInterval(() => {
      setParticipants((current) => {
        const unansweredIds = current.filter((p) => !p.answered).map((p) => p.id);
        if (unansweredIds.length === 0) return current;
        const batchSize = Math.min(5, unansweredIds.length);
        const shuffled = [...unansweredIds].sort(() => Math.random() - 0.5);
        const answeredNow = new Set(shuffled.slice(0, batchSize));
        return current.map((p) => (answeredNow.has(p.id) ? { ...p, answered: true } : p));
      });
      setDistribution((d) => d.map((count) => Math.max(1, count + (Math.random() < 0.5 ? 0 : 1))));
    }, 500);
    return () => clearInterval(id);
  }, [phase, currentQuestionIndex]);

  function nextQuestion() {
    if (currentQuestionIndex + 1 >= questions.length) {
      setPhase("ended");
      return;
    }
    setCurrentQuestionIndex((i) => i + 1);
    setDistribution(randomDistribution());
    setParticipants((ps) => ps.map((p) => ({ ...p, answered: false })));
  }

  function endGame() {
    setPhase("ended");
  }

  function resetForNewRoom() {
    setPin(null);
    setParticipants([]);
    setPhase("setup");
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

  if (!authed) {
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
              <Button type="submit" size="lg" className="h-11 text-base">
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
      <Button variant="ghost" size="sm" onClick={() => setAuthed(false)}>
        <LogOut className="size-4" />
        ออกจากระบบ
      </Button>
    </div>
  );

  if (phase === "setup") {
    const canCreateRoom = questions.length > 0 && questions.every((q) => q.text.trim().length > 0);
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
        {header}
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>คำถามบุคลิกภาพ (สเกล 1-10)</CardTitle>
              <CardDescription>ผู้เล่นจะให้คะแนนแต่ละข้อตั้งแต่ 1 ถึง 10</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {questions.map((question, index) => (
                <div key={question.id} className="flex items-start gap-2 rounded-xl border border-border p-3">
                  <span className="mt-2 font-mono text-xs text-muted-foreground">{index + 1}</span>
                  <div className="flex flex-1 flex-col gap-2">
                    <Input
                      value={question.text}
                      onChange={(event) => updateQuestion(question.id, { text: event.target.value })}
                      placeholder="พิมพ์คำถาม..."
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
                    disabled={questions.length <= 1}
                    aria-label="ลบคำถาม"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" onClick={addQuestion} className="self-start">
                <Plus className="size-4" />
                เพิ่มคำถาม
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>สร้างห้อง</CardTitle>
              <CardDescription>สร้างรหัส PIN และ QR สำหรับผู้เข้าร่วม</CardDescription>
            </CardHeader>
            <CardContent>
              <Button size="lg" className="h-11 w-full text-base" disabled={!canCreateRoom} onClick={createRoom}>
                สร้างห้อง
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (phase === "lobby" && pin) {
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

  if (phase === "live") {
    const currentQuestion = questions[currentQuestionIndex];
    const answeredCount = participants.filter((p) => p.answered).length;
    const notAnswered = participants.filter((p) => !p.answered);
    const progressPercent = participants.length === 0 ? 0 : Math.round((answeredCount / participants.length) * 100);
    const maxCount = Math.max(...distribution, 1);
    const isLastQuestion = currentQuestionIndex + 1 >= questions.length;

    return (
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
        {header}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>
                คำถามที่ {currentQuestionIndex + 1} จาก {questions.length}
              </CardTitle>
              <CardDescription>{currentQuestion.text}</CardDescription>
            </div>
            <Badge variant="secondary">
              {answeredCount}/{participants.length} ตอบแล้ว
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              {distribution.map((count, index) => (
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
          <CardFooter className="flex gap-3">
            <Button size="lg" className="h-11 flex-1 text-base" onClick={nextQuestion}>
              {isLastQuestion ? "ดูผลสรุป" : "ข้อถัดไป"}
              <ArrowRight className="size-4" />
            </Button>
            <Button size="lg" variant="outline" className="h-11 text-base" onClick={endGame}>
              จบเกม
            </Button>
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

  // phase === "ended"
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-10">
      {header}
      <div className="flex flex-1 flex-col items-center gap-6 text-center">
        <Sparkles className="size-8 text-accent" />
        <h1 className="font-heading text-2xl font-semibold text-foreground">จบเกมแล้ว</h1>
        <div className="flex gap-6 text-sm text-muted-foreground">
          <span>{participants.length} ผู้เข้าร่วม</span>
          <span>{questions.length} คำถาม</span>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">คู่ที่เข้ากันที่สุด (ตัวอย่าง)</p>
          <div className="flex flex-wrap justify-center gap-4">
            {MOCK_TOP_MATCHES.map((match) => (
              <div
                key={`${match.a}-${match.b}`}
                className="flex flex-col items-center gap-2 rounded-2xl bg-card p-4 ring-1 ring-border"
              >
                <MatchMeter percent={match.percent} size={90} />
                <span className="text-sm text-foreground">
                  {match.a} · {match.b}
                </span>
              </div>
            ))}
          </div>
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
