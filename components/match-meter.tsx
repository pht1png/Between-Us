import { cn } from "@/lib/utils";

export function MatchMeter({
  percent,
  size = 160,
  className,
}: {
  /** Compatibility percent, 0-100. Omit to render a "still calculating" state. */
  percent?: number;
  size?: number;
  className?: string;
}) {
  const isCalculating = percent === undefined;
  const clamped = isCalculating ? 55 : Math.min(100, Math.max(0, percent));

  const r = size * 0.28;
  const maxOffset = size * 0.22;
  const offset = maxOffset * (1 - clamped / 100);
  const cx = size / 2;
  const cy = size / 2;

  return (
    <div
      className={cn("relative", isCalculating && "animate-pulse", className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle cx={cx - offset} cy={cy} r={r} className="fill-primary/75" />
        <circle
          cx={cx + offset}
          cy={cy}
          r={r}
          className="fill-accent/75 mix-blend-multiply"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {isCalculating ? (
          <span className="text-2xl text-foreground">…</span>
        ) : (
          <span className="font-mono text-3xl font-semibold text-foreground">
            {Math.round(clamped)}%
          </span>
        )}
        <span className="text-xs text-muted-foreground">เข้ากัน</span>
      </div>
    </div>
  );
}
