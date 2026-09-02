import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function StepChips({
  steps,
  currentIndex,
}: {
  steps: string[];
  currentIndex: number;
}) {
  return (
    <ol className="flex items-center justify-center gap-2">
      {steps.map((step, index) => {
        const isDone = index < currentIndex;
        const isActive = index === currentIndex;
        return (
          <li key={step} className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-7 items-center gap-1 rounded-full px-3 text-xs font-medium transition-colors",
                isActive && "bg-accent text-accent-foreground",
                isDone && "bg-secondary/15 text-secondary",
                !isActive && !isDone && "bg-muted text-muted-foreground",
              )}
            >
              {isDone && <CheckIcon className="size-3" />}
              {step}
            </span>
            {index < steps.length - 1 && (
              <span aria-hidden className="h-px w-4 bg-border" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
