import Link from "next/link";
import { HeartHandshake, ListChecks, QrCode } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MatchMeter } from "@/components/match-meter";
import { MiniProfileChip } from "@/components/mini-profile-chip";
import { InstagramGlyph } from "@/components/instagram-glyph";

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

const INSTAGRAM_URL = "https://www.instagram.com/betweenus_bkk/";

// lucide-react ships no brand icons; matched to its own stroke conventions
// (24 viewBox, stroke-width 2, round caps) so it sits flush beside QrCode etc.

export default function Home() {
	return (
		<div className="flex flex-1 justify-center sm:items-start sm:px-6 sm:py-6 lg:py-10">
			<div className="flex w-full max-w-6xl flex-1 flex-col overflow-hidden bg-card sm:rounded-[2.5rem] sm:shadow-[0_40px_120px_-40px_rgba(36,27,54,0.35)] sm:ring-1 sm:ring-border">
				<header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
					<span className="font-heading text-xl font-semibold text-foreground">Between Us</span>
					<Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/admin" />}>
						สำหรับผู้จัดงาน
					</Button>
				</header>

				<main className="flex flex-1 flex-col items-center px-6">
					<section className="flex flex-col mx-auto w-full max-w-5xl items-center gap-12 py-16 sm:py-20 lg:grid-cols-[1.1fr_0.9fr] lg:gap-10 lg:py-28">
						<div className="flex flex-col items-center gap-6 text-center lg:text-left">
							<h1 className="text-balance font-heading text-4xl font-semibold leading-tight text-foreground sm:text-5xl lg:text-6xl">
								เจอคนที่เข้ากับคุณ ที่ Between Us
							</h1>
							<div className="relative flex items-center justify-center py-6 motion-safe:animate-[hero-pop_0.7s_ease-out]">
								<MiniProfileChip label="คุณ" initial="ค" rotation="left" className="left-0 top-0 sm:left-4" />
								<MiniProfileChip label="มายด์" initial="ม" rotation="right" className="bottom-0 right-0 sm:right-4" />
								<MatchMeter percent={94} size={300} />
							</div>
							<p className="max-w-72 text-center text-lg leading-relaxed text-muted-foreground">
								ตอบคำถามสนุก ๆ ไม่กี่ข้อ แล้วให้เราจับคู่คุณกับคนที่เข้ากันที่สุดในห้องนี้
							</p>
							<div className="flex flex-col items-center gap-5">
								<Button size="lg" className="h-12 px-12 text-base" nativeButton={false} render={<Link href="/join" />}>
									เข้าร่วมห้อง
								</Button>
								<span className="text-sm text-muted-foreground">ใช้เวลาไม่ถึง 2 นาที</span>
							</div>
						</div>
					</section>

					<section className="flex w-full max-w-2xl flex-col items-center gap-3 pb-20 text-center">
						<p className="text-sm text-muted-foreground">เหมาะกับ</p>
						<div className="flex flex-wrap items-center justify-center gap-2">
							{USE_CASES.map((useCase) => (
								<Badge key={useCase} variant="secondary" className="px-5 py-4 text-xs">
									{useCase}
								</Badge>
							))}
						</div>
					</section>

					<section className="mx-auto w-full max-w-4xl px-6 pb-16 sm:pb-24">
						<div className="grid grid-cols-1 gap-10 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-border">
							{STEPS.map(({ icon: Icon, title, description }, index) => {
								const isLast = index === STEPS.length - 1;
								return (
									<div
										key={title}
										className="group flex flex-col items-center gap-3 px-6 text-center sm:first:pl-0 sm:last:pr-0"
									>
										<span
											className={
												"flex size-11 items-center justify-center rounded-full bg-muted text-accent group-hover:bg-accent group-hover:text-accent-foreground transform transition-colors duration-300 motion-safe:group-hover:scale-105"
											}
										>
											<Icon className="size-5" />
										</span>
										<span className="font-mono text-xs text-muted-foreground">
											{String(index + 1).padStart(2, "0")}
										</span>
										<h2 className="font-heading text-base font-semibold text-foreground">{title}</h2>
										<p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
									</div>
								);
							})}
						</div>
					</section>

					<section className="flex w-full max-w-2xl flex-col items-center gap-5 pb-20 text-center">
						<h2 className="text-balance font-heading text-2xl font-semibold text-foreground sm:text-3xl">
							พร้อมเจอคนที่เข้ากับคุณหรือยัง
						</h2>
						<Button size="lg" className="h-12 px-8 text-base" nativeButton={false} render={<Link href="/join" />}>
							เข้าร่วมห้อง
						</Button>
					</section>
				</main>

				<footer className="mx-auto flex w-full max-w-5xl flex-col items-center gap-4 border-t border-border px-10 py-3 text-sm text-muted-foreground sm:flex-row sm:justify-between">
					<span>Between Us · กรุงเทพฯ</span>
					<a
						href={INSTAGRAM_URL}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex flex-col items-center gap-0 text-muted-foreground text-xs transition-colors hover:text-accent"
					>
						<InstagramGlyph className="size-8" />
						@betweenus_bkk
					</a>
				</footer>
			</div>
		</div>
	);
}
