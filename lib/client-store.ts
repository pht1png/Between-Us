"use client";

import { useEffect, useState } from "react";

const PIN_STORAGE_KEY = "betweenus:pin";
// Server sends a named "ping" event every 15s (lib/bus.ts) — if nothing arrives for 3x that,
// the connection is stuck in a way EventSource's own auto-reconnect hasn't noticed yet.
const WATCHDOG_MS = 45_000;

export function getStoredPin(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(PIN_STORAGE_KEY);
}

export function setStoredPin(pin: string): void {
  window.localStorage.setItem(PIN_STORAGE_KEY, pin);
}

export function clearStoredPin(): void {
  window.localStorage.removeItem(PIN_STORAGE_KEY);
}

export type RoomStreamState<T> =
  | { status: "connecting" }
  | { status: "open"; data: T }
  | { status: "fatal"; code: string; message: string };

/** Shared by both host and player screens — role is resolved server-side from cookies, so the
 * same `/api/rooms/[pin]/stream` endpoint and hook serve both. */
export function useRoomStream<T>(pin: string | null): RoomStreamState<T> {
  const [state, setState] = useState<RoomStreamState<T>>({ status: "connecting" });

  useEffect(() => {
    if (!pin) return;
    let cancelled = false;
    let source: EventSource | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;

    function armWatchdog() {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        // No snapshot/ping in too long — force a fresh connection rather than trust
        // EventSource to notice on its own.
        source?.close();
        connect();
      }, WATCHDOG_MS);
    }

    function connect() {
      if (cancelled) return;
      source = new EventSource(`/api/rooms/${pin}/stream`);

      source.addEventListener("snapshot", (event) => {
        armWatchdog();
        try {
          const data = JSON.parse((event as MessageEvent).data) as T;
          if (!cancelled) setState({ status: "open", data });
        } catch {
          // malformed payload — ignore, next snapshot will correct it
        }
      });

      source.addEventListener("ping", () => armWatchdog());

      source.addEventListener("fatal", (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data) as {
            error: { code: string; message: string };
          };
          if (!cancelled) setState({ status: "fatal", code: payload.error.code, message: payload.error.message });
        } catch {
          // ignore
        }
        source?.close();
      });

      armWatchdog();
    }

    connect();

    return () => {
      cancelled = true;
      if (watchdog) clearTimeout(watchdog);
      source?.close();
    };
  }, [pin]);

  return state;
}
