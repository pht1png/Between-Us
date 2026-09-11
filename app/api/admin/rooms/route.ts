import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { createRoom, isLoggedIn } from "@/lib/rooms";
import { createRoomSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("host_token")?.value;
  if (!token || !isLoggedIn(token)) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = createRoomSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "ข้อมูลคำถามไม่ถูกต้อง" } },
      { status: 400 },
    );
  }

  const room = createRoom(token, parsed.data.questions, parsed.data.pin);

  // Refresh the cookie's expiry — same token value, still just proves "logged in".
  cookieStore.set("host_token", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 12,
  });

  return NextResponse.json({ pin: room.pin, hostToken: token }, { status: 201 });
}
