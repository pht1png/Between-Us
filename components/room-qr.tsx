"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function RoomQr({ url, size = 200 }: { url: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { width: size * 2, margin: 1, color: { dark: "#241b36", light: "#ffffff" } })
      .then((result) => {
        if (!cancelled) setDataUrl(result);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url, size]);

  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-2xl bg-white p-3 ring-1 ring-border"
      style={{ width: size, height: size }}
    >
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={dataUrl} alt="QR สำหรับเข้าร่วมห้อง" width={size} height={size} />
      ) : (
        <div className="size-full animate-pulse rounded-lg bg-muted" />
      )}
    </div>
  );
}
