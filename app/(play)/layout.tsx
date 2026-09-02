import { PhoneShell } from "@/components/phone-shell";

export default function PlayLayout({ children }: { children: React.ReactNode }) {
  return <PhoneShell>{children}</PhoneShell>;
}
