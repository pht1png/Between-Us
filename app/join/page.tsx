import { Suspense } from "react";
import { Loader2 } from "lucide-react";

import { PhoneShell } from "@/components/phone-shell";
import { JoinFlow } from "./join-flow";

export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <PhoneShell>
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        </PhoneShell>
      }
    >
      <JoinFlow />
    </Suspense>
  );
}
