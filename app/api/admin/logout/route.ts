import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { logout } from "@/lib/rooms";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get("host_token")?.value;
  if (token) logout(token);
  cookieStore.delete("host_token");
  return NextResponse.json({ ok: true });
}
