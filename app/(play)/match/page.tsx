"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Sparkles, Users, Handshake, HeartHandshake } from "lucide-react";

import { MatchMeter } from "@/components/match-meter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SEX_LABELS_TH } from "@/lib/labels";
import { MAX_FEEDBACK_LENGTH } from "@/lib/validation";

import { usePlayEvent } from "../layout";

const FEEDBACK_PROMPT =
	"มีอะไรที่อยากบอกหรืออยากให้ Between Us จัดเป็นพิเศษไหม สามารถบอกได้เลยน้า พวกเรารับฟังได้เต็มที่";

function FeedbackBox({ pin }: { pin: string }) {
	const [text, setText] = useState("");
	const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

	async function handleSubmit() {
		if (status === "sending" || text.trim().length === 0) return;
		setStatus("sending");
		try {
			const res = await fetch(`/api/rooms/${pin}/feedback`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ feedback: text }),
			});
			setStatus(res.ok ? "sent" : "error");
		} catch {
			setStatus("error");
		}
	}

	return (
		<div className="flex w-full flex-col gap-3 rounded-2xl bg-ring/20 p-4 text-left">
			<p className="text-2xl font-medium text-foreground text-center">ส่งความคิดเห็น</p>
			<p className="text-sm text-foreground">{FEEDBACK_PROMPT}</p>
			{status === "sent" ? (
				<div className="w-full rounded-2xl bg-accent/20 p-4 text-left">
					<p className="text-sm text-foreground">ขอบคุณมากน้า เราอ่านทุกข้อความเลย</p>
				</div>
			) : (
				<>
					<Textarea
						value={text}
						onChange={(event) => setText(event.target.value.slice(0, MAX_FEEDBACK_LENGTH))}
						placeholder="เล่าให้ฟังได้เลย"
						rows={3}
						className="border-ring bg-white"
					/>
					{status === "error" && <p className="text-sm text-destructive">ส่งไม่สำเร็จ ลองใหม่อีกครั้ง</p>}
					<Button
						variant="secondary"
						size="lg"
						className="h-11 bg-ring"
						disabled={status === "sending" || text.trim().length === 0}
						onClick={handleSubmit}
					>
						{status === "sending" ? <Loader2 className="size-4 animate-spin" /> : "ส่ง"}
					</Button>
				</>
			)}
		</div>
	);
}

export default function MatchPage() {
	const { event, pin } = usePlayEvent();

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
				<h1 className="font-heading text-xl font-semibold text-foreground">ยังไม่พบคู่ที่เข้ากันในรอบนี้</h1>
				<p className="max-w-65 text-sm text-muted-foreground">
					อาจเป็นเพราะจำนวนผู้เข้าร่วมไม่พอจะจับคู่ในรอบนี้ กรุณาติดต่อเจ้าหน้าที่
				</p>
				{pin && <FeedbackBox pin={pin} />}
				<Button variant="default" className="w-fit px-6 py-5" size="sm" nativeButton={false} render={<Link href="/" />}>
					ออกจากห้องนี้
				</Button>
			</div>
		);
	}

	const { groupmate: mate, kind } = reveal;
	const isFriendMatch = kind === "friend";

	return (
		<div className="flex flex-1 flex-col items-center gap-6 px-6 py-10 text-center">
			<span className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-white">
				<Sparkles className="size-3" />
				ผลลัพธ์ของคุณ
			</span>

			<div className="flex flex-col items-center w-full text-center gap-2">
				<span className={"flex items-center justify-center px-3 py-3 bg-muted rounded-full text-accent"}>
					{isFriendMatch ? <Handshake className="size-10" /> : <HeartHandshake className="size-10" />}
				</span>

				<p className="text-2xl font-medium text-foreground">{isFriendMatch ? "จับคู่แบบเพื่อน" : "ยินดีด้วย!"}</p>
				<p className="text-sm text-muted-foreground">
					{isFriendMatch
						? "รอบนี้จำนวนเพศในห้องไม่พอดีกัน เลยไม่มีคู่ที่ตรงกับเพศที่คุณเลือกเหลืออยู่เราจึงจับคู่คุณกับคนที่มีความเข้ากันใกล้เคียงที่สุดแทน"
						: "คนที่เข้ากันกับคุณมากที่สุดในรอบนี้คือ..."}
				</p>
			</div>

			<div className="relative aspect-3/4 w-full overflow-hidden rounded-3xl bg-muted text-left ring-1 ring-border">
				{mate.photoUrl ? (
					// eslint-disable-next-line @next/next/no-img-element -- served by our own photo route
					<img src={mate.photoUrl} alt="" className="absolute inset-0 size-full object-cover" />
				) : (
					<span className="absolute inset-0 flex items-center justify-center font-heading text-6xl font-semibold text-muted-foreground">
						{mate.name.charAt(0)}
					</span>
				)}

				{/* Scrim keeps the overlaid text readable over bright photos. */}
				<div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-linear-to-t from-black/85 via-black/55 to-transparent p-4 pt-14">
					<div className="flex items-baseline justify-between gap-2">
						<h2 className="font-heading text-xl font-semibold text-white">{mate.name}</h2>
						<span className="text-base font-semibold text-white">{SEX_LABELS_TH[mate.sex]}</span>
					</div>
					<p className="text-sm text-white/85">{mate.bio}</p>
				</div>
			</div>

			<div className="flex flex-col items-center justify-center w-full px-6 bg-primary/20 py-4 rounded-2xl gap-2">
				<p className="text-2xl font-medium text-foreground">ความเข้ากันได้</p>
				<MatchMeter percent={mate.compatibility} size={100} />
				<p className="text-xs text-foreground">{mate.reason}</p>
			</div>

			{pin && <FeedbackBox pin={pin} />}

			<Button variant="default" className="w-fit px-6 py-5" size="sm" nativeButton={false} render={<Link href="/" />}>
				ออกจากห้องนี้
			</Button>
		</div>
	);
}
