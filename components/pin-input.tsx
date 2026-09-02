"use client";

import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

export const PIN_LENGTH = 6;

export function PinInput({
  value,
  onChange,
  onComplete,
  autoFocus,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  return (
    <InputOTP
      maxLength={PIN_LENGTH}
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      autoFocus={autoFocus}
      disabled={disabled}
      inputMode="numeric"
      pattern="^[0-9]*$"
      containerClassName="justify-center gap-2"
    >
      <InputOTPGroup className="gap-2">
        {Array.from({ length: PIN_LENGTH }).map((_, index) => (
          <InputOTPSlot
            key={index}
            index={index}
            className="size-12 rounded-lg border border-border bg-background font-mono text-2xl font-semibold text-foreground first:rounded-lg last:rounded-lg sm:size-14 sm:text-3xl"
          />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}
