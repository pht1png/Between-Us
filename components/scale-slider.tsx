"use client";

import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

export function ScaleSlider({
  value,
  onChange,
  min = 1,
  max = 10,
  minLabel,
  maxLabel,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  minLabel?: string;
  maxLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex w-full flex-col items-center gap-4", className)}>
      <span className="font-mono text-5xl font-semibold text-accent">{value}</span>
      <Slider
        value={[value]}
        onValueChange={(next) => onChange(Array.isArray(next) ? next[0] : next)}
        min={min}
        max={max}
        step={1}
        className="w-full **:data-[slot=slider-thumb]:size-6 **:data-[slot=slider-thumb]:border-2 **:data-[slot=slider-thumb]:border-accent **:data-[slot=slider-track]:h-2"
      />
      {(minLabel || maxLabel) && (
        <div className="flex w-full justify-between text-xs text-muted-foreground">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      )}
    </div>
  );
}
