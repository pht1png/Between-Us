import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { login } from "@/lib/rooms";
import { loginSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "ข้อมูลไม่ถูกต้อง" } }, { status: 400 });
  }

  const token = login(parsed.data.password);
  if (!token) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "รหัสผ่านไม่ถูกต้อง" } },
      { status: 401 },
    );
  }

  const cookieStore = await cookies();
  cookieStore.set("host_token", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 12,
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
