"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Camera, Loader2 } from "lucide-react";

import { PhoneShell } from "@/components/phone-shell";
import { StepChips } from "@/components/step-chips";
import { PinInput, PIN_LENGTH } from "@/components/pin-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { compressImageToDataUrl } from "@/lib/compress-image";
import { setStoredPin } from "@/lib/client-store";
import { cn } from "@/lib/utils";
import type { Sex } from "@/lib/types";

const STEP_LABELS = ["รหัสห้อง", "โปรไฟล์", "เสร็จสิ้น"];
const BIO_MAX_LENGTH = 140;
const NAME_MAX_LENGTH = 24;
const PIN_PATTERN = /^\d{6}$/;

type Step = "pin" | "profile" | "done";

export function JoinFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>("pin");
  const [pin, setPin] = useState(() => {
    const fromQr = searchParams.get("pin");
    return fromQr && PIN_PATTERN.test(fromQr) ? fromQr : "";
  });
  const [pinError, setPinError] = useState<string | null>(null);
  const [checkingPin, setCheckingPin] = useState(false);

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [sex, setSex] = useState<Sex | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [submittingProfile, setSubmittingProfile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const initials = name.trim() ? name.trim().charAt(0).toUpperCase() : "?";
  const canSubmitProfile = name.trim().length > 0 && bio.trim().length > 0 && sex !== null && photo !== null;

  async function continueWithPin(pinValue: string) {
    if (pinValue.length !== PIN_LENGTH || checkingPin) return;
    setCheckingPin(true);
    setPinError(null);
    try {
      const res = await fetch(`/api/rooms/${pinValue}/exists`);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setPinError(body?.error?.message ?? "ไม่พบห้องนี้");
        return;
      }
      setStep("profile");
    } catch {
      setPinError("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setCheckingPin(false);
    }
  }

  // A QR scan lands here with ?pin=XXXXXX already known-good (pre-filled above) — skip
  // retyping it. This is a one-time imperative kickoff from a URL param, not state mirroring.
  useEffect(() => {
    const fromQr = searchParams.get("pin");
    if (fromQr && PIN_PATTERN.test(fromQr)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void continueWithPin(fromQr);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPhotoError(null);
    try {
      const dataUrl = await compressImageToDataUrl(file);
      setPhoto(dataUrl);
    } catch {
      setPhotoError("อ่านรูปไม่สำเร็จ ลองเลือกรูปอื่นอีกครั้ง");
    }
  }

  async function handleSubmitProfile(event: FormEvent) {
    event.preventDefault();
    if (!canSubmitProfile || submittingProfile || !sex) return;
    setSubmittingProfile(true);
    setJoinError(null);
    try {
      const res = await fetch(`/api/rooms/${pin}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), bio: bio.trim(), sex, photo }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setJoinError(body?.error?.message ?? "เข้าร่วมไม่สำเร็จ ลองใหม่อีกครั้ง");
        return;
      }
      setStoredPin(pin);
      setStep("done");
    } catch {
      setJoinError("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setSubmittingProfile(false);
    }
  }

  // The (play) layout re-derives the real phase (lobby/asking/reveal) from the SSE stream and
  // routes accordingly — this is just a short, friendly landing pad.
  useEffect(() => {
    if (step !== "done") return;
    const t = setTimeout(() => router.push("/waiting"), 1500);
    return () => clearTimeout(t);
  }, [step, router]);

  return (
    <PhoneShell>
      {step === "pin" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-10 text-center">
          <div className="flex flex-col items-center gap-2">
            <span className="font-heading text-2xl font-semibold text-foreground">
              Between Us
            </span>
            <p className="text-sm text-muted-foreground">กรอกรหัสห้อง 6 หลักจากเจ้าภาพ</p>
          </div>

          <PinInput
            value={pin}
            onChange={(value) => {
              setPin(value);
              setPinError(null);
            }}
            onComplete={continueWithPin}
            autoFocus
            disabled={checkingPin}
          />

          {pinError && <p className="text-sm text-destructive">{pinError}</p>}

          <Button
            size="lg"
            className="h-12 w-full max-w-70 text-base"
            disabled={pin.length !== PIN_LENGTH || checkingPin}
            onClick={() => continueWithPin(pin)}
          >
            {checkingPin ? <Loader2 className="size-4 animate-spin" /> : "ถัดไป"}
          </Button>

          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/" />}>
            <ArrowLeft className="size-4" />
            กลับหน้าแรก
          </Button>
        </div>
      )}

      {step === "profile" && (
        <div className="flex flex-1 flex-col gap-6 px-6 py-8">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setStep("pin")}
              aria-label="ย้อนกลับ"
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-5" />
            </button>
            <StepChips steps={STEP_LABELS} currentIndex={1} />
            <span className="size-5" aria-hidden />
          </div>

          <form onSubmit={handleSubmitProfile} className="flex flex-1 flex-col gap-5">
            <div className="flex flex-col items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="user"
                className="hidden"
                onChange={handlePhotoChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="relative"
                aria-label="เพิ่มรูปโปรไฟล์"
              >
                <Avatar className="size-24">
                  {photo && <AvatarImage src={photo} alt="" />}
                  <AvatarFallback className="text-2xl">{initials}</AvatarFallback>
                </Avatar>
                <span className="absolute -right-1 -bottom-1 flex size-8 items-center justify-center rounded-full bg-accent text-accent-foreground ring-2 ring-card">
                  <Camera className="size-4" />
                </span>
              </button>
              {photoError ? (
                <p className="text-sm text-destructive">{photoError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">แตะเพื่อเพิ่มรูปโปรไฟล์</p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="name">ชื่อเล่น</Label>
              <Input
                id="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={NAME_MAX_LENGTH}
                placeholder="เช่น มายด์"
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>เพศ</Label>
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    { value: "male", label: "ชาย" },
                    { value: "female", label: "หญิง" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSex(option.value)}
                    aria-pressed={sex === option.value}
                    className={cn(
                      "h-11 rounded-lg border text-sm font-medium transition-colors",
                      sex === option.value
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border text-muted-foreground hover:border-accent/50 hover:text-foreground",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="bio">แนะนำตัวสั้น ๆ</Label>
                <span className="text-xs text-muted-foreground">
                  {bio.length}/{BIO_MAX_LENGTH}
                </span>
              </div>
              <Textarea
                id="bio"
                value={bio}
                onChange={(event) => setBio(event.target.value.slice(0, BIO_MAX_LENGTH))}
                placeholder="สนใจอะไร ชอบทำอะไรตอนว่าง ๆ"
                rows={3}
                required
              />
            </div>

            {joinError && <p className="text-sm text-destructive">{joinError}</p>}

            <Button
              type="submit"
              size="lg"
              className="mt-auto h-12 text-base"
              disabled={!canSubmitProfile || submittingProfile}
            >
              {submittingProfile ? <Loader2 className="size-4 animate-spin" /> : "เข้าร่วม"}
            </Button>
          </form>
        </div>
      )}

      {step === "done" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-10 text-center">
          <StepChips steps={STEP_LABELS} currentIndex={2} />
          <Avatar className="size-20">
            {photo && <AvatarImage src={photo} alt="" />}
            <AvatarFallback className="text-xl">{initials}</AvatarFallback>
          </Avatar>
          <h1 className="font-heading text-xl font-semibold text-foreground">
            ยินดีต้อนรับ, {name}
          </h1>
          <p className="text-sm text-muted-foreground">คุณเข้าร่วมห้อง {pin} แล้ว</p>
          <p className="max-w-65 text-sm text-muted-foreground">
            รอเจ้าภาพเริ่มเกม หน้าจอนี้จะพาไปต่อโดยอัตโนมัติ
          </p>
        </div>
      )}
    </PhoneShell>
  );
}
