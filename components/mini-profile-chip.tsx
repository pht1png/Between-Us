import { cn } from "@/lib/utils";

export function MiniProfileChip({
	label,
	initial,
	rotation,
	className,
}: {
	label: string;
	initial: string;
	rotation: "left" | "right";
	className?: string;
}) {
	return (
		<div
			className={cn(
				"absolute flex items-center gap-2 rounded-2xl bg-card px-5 py-4 shadow-[0_16px_30px_-14px_rgba(36,27,54,0.35)] ring-1 ring-border",
				rotation === "left" ? "-rotate-6" : "rotate-6",
				className,
			)}
		>
			<span className="flex size-9 items-center justify-center rounded-full bg-muted text-md font-semibold text-accent">
				{initial}
			</span>
			<span className="text-lg font-medium text-foreground">{label}</span>
		</div>
	);
}
