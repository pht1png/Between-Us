"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Camera, Loader2 } from "lucide-react";

import { PhoneShell } from "@/components/phone-shell";
import { StepChips } from "@/components/step-chips";
import { PinInput, PIN_LENGTH } from "@/components/pin-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { compressImageToDataUrl } from "@/lib/compress-image";
import { setStoredPin } from "@/lib/client-store";
import { cn } from "@/lib/utils";
import type { DesiredSex, Sex } from "@/lib/types";

/** One list, used for both "who I am" (single-select) and "who I want to meet" (multi-select). */
const SEX_OPTIONS: { value: Sex; label: string }[] = [
	{ value: "male", label: "ชาย" },
	{ value: "female", label: "หญิง" },
	{ value: "lgbtq_male", label: "LGBTQ+ (ชาย)" },
	{ value: "lgbtq_female", label: "LGBTQ+ (หญิง)" },
];

const TERMS_TITLE = "เงื่อนไขการจับคู่";
const TERMS_BODY =
	"เราจับคู่จากเพศที่คุณเลือกไว้ก่อนเสมอ แต่ถ้าในห้องมีจำนวนเพศไม่พอดีกัน คุณอาจไม่เหลือคู่ที่ตรงกับที่เลือกไว้ " +
	"ในกรณีนั้นเราจะจับคู่คุณแบบ “เพื่อน” กับคนที่มีความเข้ากันใกล้เคียงที่สุดแทน โดยไม่ดูเพศที่คุณเลือก " +
	"และจะบอกให้คุณรู้ตอนประกาศผลว่าเป็นการจับคู่แบบเพื่อน ถ้ายังไม่มีใครเหลือให้จับคู่จริง ๆ เราจะแจ้งว่าคุณยังไม่มีคู่ในรอบนี้";

/** Large enough to fill a portrait card on a 3x-DPR phone without looking soft. */
const CARD_PHOTO_SIZE = 720;
/** Matches the old avatar target — all the admin roster's small circles ever need. */
const THUMB_PHOTO_SIZE = 240;

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
	const [desiredSex, setDesiredSex] = useState<DesiredSex>([]);
	const [hasPromptedTerms, setHasPromptedTerms] = useState(false);
	const [termsOpen, setTermsOpen] = useState(false);
	const [termsAccepted, setTermsAccepted] = useState(false);
	const [photo, setPhoto] = useState<string | null>(null);
	const [photoThumb, setPhotoThumb] = useState<string | null>(null);
	const [photoError, setPhotoError] = useState<string | null>(null);
	const [joinError, setJoinError] = useState<string | null>(null);
	const [submittingProfile, setSubmittingProfile] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	// Open the matching terms automatically the first time this participant reaches the profile
	// step. Adjusting state during render (rather than in an effect) is React's own pattern for
	// "react to something changing" and sidesteps both lint rules this repo enforces — no ref read
	// during render, no setState in an effect body. The guard flips on the very next render, so
	// this runs exactly once and can't loop.
	if (step === "profile" && !hasPromptedTerms) {
		setHasPromptedTerms(true);
		setTermsOpen(true);
	}

	function toggleDesiredSex(value: Sex) {
		setDesiredSex((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
	}

	const initials = name.trim() ? name.trim().charAt(0).toUpperCase() : "?";
	const canSubmitProfile =
		name.trim().length > 0 &&
		bio.trim().length > 0 &&
		sex !== null &&
		desiredSex.length > 0 &&
		photo !== null &&
		termsAccepted;

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
			// Two sizes from one pick: a large card photo for the join preview and the match reveal,
			// and a small thumbnail so the host's roster stays light at 150 participants.
			const [card, thumb] = await Promise.all([
				compressImageToDataUrl(file, { maxSize: CARD_PHOTO_SIZE, quality: 0.72 }),
				compressImageToDataUrl(file, { maxSize: THUMB_PHOTO_SIZE }),
			]);
			setPhoto(card);
			setPhotoThumb(thumb);
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
				body: JSON.stringify({ name: name.trim(), bio: bio.trim(), sex, desiredSex, photo, photoThumb }),
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
						<span className="font-heading text-2xl font-semibold text-foreground">Between Us</span>
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
							<input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
							<button
								type="button"
								onClick={() => fileInputRef.current?.click()}
								className="relative aspect-3/4 w-44 overflow-hidden rounded-3xl bg-muted ring-1 ring-border"
								aria-label={photo ? "เปลี่ยนรูปโปรไฟล์" : "เพิ่มรูปโปรไฟล์"}
							>
								{photo ? (
									// eslint-disable-next-line @next/next/no-img-element -- local data URL, no loader needed
									<img src={photo} alt="" className="size-full object-cover" />
								) : (
									<span className="flex size-full items-center justify-center font-heading text-4xl font-semibold text-muted-foreground">
										{initials}
									</span>
								)}
								<span className="absolute right-2 bottom-2 flex size-9 items-center justify-center rounded-full bg-accent text-accent-foreground ring-2 ring-card">
									<Camera className="size-4" />
								</span>
							</button>
							{photoError ? (
								<p className="text-sm text-destructive">{photoError}</p>
							) : (
								<p className="text-xs text-muted-foreground">
									{photo ? "แตะเพื่อเปลี่ยนรูป" : "แตะเพื่อเพิ่มรูปโปรไฟล์"}
								</p>
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
								{SEX_OPTIONS.map((option) => (
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
							<div className="flex items-baseline justify-between gap-2">
								<Label>เลือกเพศที่ต้องการเจอ</Label>
								<span className="text-xs text-muted-foreground">เลือกได้มากกว่า 1</span>
							</div>
							<div className="grid grid-cols-2 gap-3">
								{SEX_OPTIONS.map((option) => (
									<button
										key={option.value}
										type="button"
										onClick={() => toggleDesiredSex(option.value)}
										aria-pressed={desiredSex.includes(option.value)}
										className={cn(
											"h-11 rounded-lg border text-sm font-medium transition-colors",
											desiredSex.includes(option.value)
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

						<div className="mt-auto flex flex-col gap-2">
							{termsAccepted && (
								<button
									type="button"
									onClick={() => setTermsOpen(true)}
									className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
								>
									อ่านเงื่อนไขการจับคู่อีกครั้ง
								</button>
							)}
							<Button
								type="submit"
								size="lg"
								className="h-12 text-base"
								disabled={!canSubmitProfile || submittingProfile}
							>
								{submittingProfile ? <Loader2 className="size-4 animate-spin" /> : "เข้าร่วม"}
							</Button>
						</div>
					</form>

					{/* Fully controlled and deliberately not dismissible — no onOpenChange, no close
              affordance, pointer dismissal disabled — so the only way past it is ยอมรับ. */}
					<Dialog open={termsOpen} disablePointerDismissal>
						<DialogPopup>
							<DialogTitle>{TERMS_TITLE}</DialogTitle>
							<DialogDescription>{TERMS_BODY}</DialogDescription>
							<Button
								size="lg"
								className="mt-2 h-11 text-base"
								onClick={() => {
									setTermsAccepted(true);
									setTermsOpen(false);
								}}
							>
								ยอมรับ
							</Button>
						</DialogPopup>
					</Dialog>
				</div>
			)}

			{step === "done" && (
				<div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-10 text-center">
					<StepChips steps={STEP_LABELS} currentIndex={2} />
					<div className="aspect-3/4 w-28 overflow-hidden rounded-2xl bg-muted ring-1 ring-border">
						{photo ? (
							// eslint-disable-next-line @next/next/no-img-element -- local data URL, no loader needed
							<img src={photo} alt="" className="size-full object-cover" />
						) : (
							<span className="flex size-full items-center justify-center font-heading text-2xl font-semibold text-muted-foreground">
								{initials}
							</span>
						)}
					</div>
					<h1 className="font-heading text-xl font-semibold text-foreground">ยินดีต้อนรับ, {name}</h1>
					<p className="text-sm text-muted-foreground">คุณเข้าร่วมห้อง {pin} แล้ว</p>
					<p className="max-w-65 text-sm text-muted-foreground">รอเจ้าภาพเริ่มเกม หน้าจอนี้จะพาไปต่อโดยอัตโนมัติ</p>
				</div>
			)}
		</PhoneShell>
	);
}
