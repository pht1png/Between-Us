import { cn } from "@/lib/utils";

export function MatchMeter({
	clamped = 87,
	percent,
	size = 160,
	className,
}: {
	/** Compatibility percent, 0-100. Omit to render a "still calculating" state. */
	clamped?: number;
	percent?: number;
	size?: number;
	className?: string;
}) {
	const isCalculating = percent === undefined;

	const r = size * 0.38;
	const maxOffset = size * 0.9;
	const offset = maxOffset * (1 - clamped / 100);
	const cx = size / 2;
	const cy = size / 2;

	return (
		<div className={cn("relative", isCalculating && "animate-pulse", className)} style={{ width: size, height: size }}>
			<svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
				<circle cx={cx - offset} cy={cy} r={r} className="fill-primary/75" />
				<circle cx={cx + offset} cy={cy} r={r} className="fill-accent/75 mix-blend-multiply" />
			</svg>
			<div className="absolute inset-0 flex flex-col items-center justify-center">
				{isCalculating ? (
					<span className="font-mono font-semibold text-2xl text-white">···</span>
				) : (
					<span className="font-mono text-xl sm:text-2xl md:text-4xl font-semibold text-white">
						{Math.round(percent)}%
					</span>
				)}
				<span className="text-xs text-white">{isCalculating ? "" : "เข้ากัน"}</span>
			</div>
		</div>
	);
}
