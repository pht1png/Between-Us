import { cn } from "@/lib/utils";

export function PhoneShell({ children, className }: { children: React.ReactNode; className?: string }) {
	return (
		<div className="flex max-h-dvh w-full flex-1 items-center justify-center px-4 py-1 sm:py-10">
			<div
				className={cn(
					"flex w-full h-[700px] max-w-[420px] flex-1 flex-col rounded-[2rem] bg-card sm:min-h-[780px] sm:flex-none sm:shadow-[0_30px_80px_-30px_rgba(36,27,54,0.35)] sm:ring-1 sm:ring-border",
					className,
				)}
			>
				{children}
			</div>
		</div>
	);
}
