"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { PhoneShell } from "@/components/phone-shell";
import { clearStoredPin, getStoredPin, useRoomStream } from "@/lib/client-store";
import type { PlayerEvent } from "@/lib/types";

type PlayContextValue = {
  event: PlayerEvent | null;
  pin: string | null;
};

const PlayContext = createContext<PlayContextValue>({ event: null, pin: null });

export function usePlayEvent(): PlayContextValue {
  return useContext(PlayContext);
}

function routeForEvent(event: PlayerEvent): "/waiting" | "/question" | "/match" {
  if (event.type === "lobby") return "/waiting";
  if (event.type === "asking") return event.yourAnswer == null ? "/question" : "/waiting";
  return "/match";
}

export default function PlayLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // Lazy initializer: on the server (or first paint) getStoredPin() returns null (no window);
  // on the client it re-runs during hydration's real first render, where localStorage exists.
  const [pin] = useState<string | null>(() => getStoredPin());

  useEffect(() => {
    if (!pin) router.replace("/join");
  }, [pin, router]);

  const state = useRoomStream<PlayerEvent>(pin);

  useEffect(() => {
    if (state.status === "fatal") {
      clearStoredPin();
      router.replace("/join");
      return;
    }
    if (state.status === "open") {
      const target = routeForEvent(state.data);
      if (pathname !== target) router.replace(target);
    }
  }, [state, pathname, router]);

  return (
    <PhoneShell>
      <PlayContext.Provider value={{ event: state.status === "open" ? state.data : null, pin }}>
        {children}
      </PlayContext.Provider>
    </PhoneShell>
  );
}
