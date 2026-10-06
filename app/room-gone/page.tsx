"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Where both roles land when their stream reports a condition it can't recover from — the room is
 * gone (swept, or the server restarted), or their session no longer resolves. Deliberately outside
 * both the `(play)` and admin layouts: neither a stored PIN nor an open stream exists at this point,
 * and anything that tried to open one would just fail again and bounce straight back here.
 *
 * The message comes from the server's own `fatal` payload rather than being written here, so this
 * page can't drift out of sync with what the API actually says.
 */
function RoomGone() {
  const message = useSearchParams().get("message");

  return (
    <div className="flex min-h-dvh flex-1 items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <span className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <SearchX className="size-6" />
          </span>
          <CardTitle className="font-heading text-xl">ห้องนี้ไม่พร้อมใช้งานแล้ว</CardTitle>
          <CardDescription>{message || "ห้องนี้อาจถูกปิดไปแล้ว หรือหมดอายุไปแล้ว"}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-center text-sm text-muted-foreground">
            ถ้ากิจกรรมยังไม่จบ ลองสอบถามผู้จัดงานเพื่อขอรหัสห้องใหม่อีกครั้งน้า
          </p>
          <Button size="lg" className="h-11 text-base" nativeButton={false} render={<Link href="/" />}>
            กลับหน้าแรก
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function RoomGonePage() {
  // useSearchParams needs a Suspense boundary — same pattern as app/join/page.tsx.
  return (
    <Suspense fallback={<div className="flex min-h-dvh flex-1" />}>
      <RoomGone />
    </Suspense>
  );
}
