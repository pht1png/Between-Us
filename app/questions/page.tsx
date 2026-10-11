"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, MessageCircleHeart, Shuffle } from "lucide-react";

import { PhoneShell } from "@/components/phone-shell";
import { Button } from "@/components/ui/button";
import { ICEBREAKERS } from "@/lib/icebreakers";

/**
 * Fisher–Yates over an array of indexes.
 *
 * Only ever called from an effect or an event callback, never during render: `react-hooks/purity`
 * forbids Math.random() there, and shuffling during render would also leave the server and the
 * client disagreeing about card order, which React reports as a hydration error.
 */
function shuffledIndexes(length: number): number[] {
	const order = Array.from({ length }, (_, i) => i);
	for (let i = order.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[order[i], order[j]] = [order[j], order[i]];
	}
	return order;
}

/**
 * A deck of conversation prompts for two people who have just been matched and can't think of an
 * opener. Shuffled per visit, so the pair standing next to each other aren't reading the same
 * sequence.
 *
 * Deliberately a standalone route rather than part of the `(play)` group: that layout needs a
 * stored PIN and a live SSE subscription, and sends you to /room-gone when the room disappears.
 * This page has to keep working after the event is over and the room has been reaped.
 */
export default function QuestionsPage() {
	const [order, setOrder] = useState<number[] | null>(null);
	const [active, setActive] = useState(0);
	const railRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		// Nested in a timeout rather than called straight from the effect body, which
		// `react-hooks/set-state-in-effect` forbids. The cost is one frame of skeleton; the benefit is
		// that the server and the first client render agree (both render the skeleton).
		const id = setTimeout(() => setOrder(shuffledIndexes(ICEBREAKERS.length)), 0);
		return () => clearTimeout(id);
	}, []);

	/** Which card is nearest the centre of the rail. Runs on scroll, so reading `ref.current` here
	 * is fine — `react-hooks/refs` only forbids reading it during render. */
	function handleScroll() {
		const rail = railRef.current;
		if (!rail) return;
		const centre = rail.scrollLeft + rail.clientWidth / 2;
		let nearest = 0;
		let shortest = Infinity;
		for (let i = 0; i < rail.children.length; i++) {
			const card = rail.children[i] as HTMLElement;
			const distance = Math.abs(card.offsetLeft + card.clientWidth / 2 - centre);
			if (distance < shortest) {
				shortest = distance;
				nearest = i;
			}
		}
		setActive(nearest);
	}

	function goTo(index: number) {
		const rail = railRef.current;
		if (!rail) return;
		const card = rail.children[index] as HTMLElement | undefined;
		card?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
	}

	function reshuffle() {
		setOrder(shuffledIndexes(ICEBREAKERS.length));
		setActive(0);
		// Deferred: resetting the scroll before React has committed the reordered cards gets undone
		// as the children move. Assigning scrollLeft also fires a scroll event, so handleScroll
		// re-derives `active` from the DOM and the two can't drift apart.
		setTimeout(() => {
			const rail = railRef.current;
			if (rail) rail.scrollLeft = 0;
		}, 0);
	}

	const total = order?.length ?? 0;

	return (
		<PhoneShell>
			<div className="flex flex-1 flex-col gap-5 pt-8 pb-12 sm:py-8">
				<header className="flex flex-col items-center gap-2 px-6 text-center">
					<span className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-white">
						<MessageCircleHeart className="size-3" />
						คำถามชวนคุย
					</span>
					<h1 className="font-heading text-2xl font-semibold text-foreground">นึกไม่ออกว่าจะคุยอะไรดี?</h1>
					<p className="max-w-72 text-sm text-muted-foreground">
						ปัดการ์ดเพื่อสุ่มคำถาม แล้วลองถามกันดูน้า ไม่ต้องตอบทุกข้อก็ได้
					</p>
				</header>

				{order === null ? (
					// Matches the rail's shape so the swap-in doesn't shift the layout.
					<div className="flex flex-1 items-stretch px-6">
						<div className="min-h-72 w-[84%] animate-pulse rounded-3xl bg-muted" />
					</div>
				) : (
					<>
						<div
							ref={railRef}
							onScroll={handleScroll}
							className="flex flex-1 snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
						>
							{order.map((questionIndex, position) => (
								<article
									key={questionIndex}
									className="flex min-h-72 w-[84%] shrink-0 snap-center flex-col items-center justify-center gap-5 rounded-3xl bg-card p-6 text-center ring-1 ring-border bg-muted"
								>
									<span className="font-mono text-xs text-muted-foreground">
										{position + 1} / {total}
									</span>
									<p className="text-balance font-heading text-xl leading-relaxed font-semibold text-foreground">
										{ICEBREAKERS[questionIndex]}
									</p>
								</article>
							))}
						</div>

						<div className="items-center justify-center gap-3 px-6 hidden sm:flex">
							<Button
								variant="outline"
								size="icon"
								aria-label="คำถามก่อนหน้า"
								disabled={active === 0}
								onClick={() => goTo(active - 1)}
							>
								<ChevronLeft className="size-4" />
							</Button>
							<Button variant="ghost" size="sm" onClick={reshuffle}>
								<Shuffle className="size-4" />
								สุ่มใหม่
							</Button>
							<Button
								variant="outline"
								size="icon"
								aria-label="คำถามถัดไป"
								disabled={active >= total - 1}
								onClick={() => goTo(active + 1)}
							>
								<ChevronRight className="size-4" />
							</Button>
						</div>
					</>
				)}
			</div>
		</PhoneShell>
	);
}
