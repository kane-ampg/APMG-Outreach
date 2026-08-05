import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

export const runtime = "nodejs";

/** An HttpOnly cookie cannot be cleared from JavaScript, so sign-out is a POST. */
export async function POST(): Promise<Response> {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set("apmg-role", "", { path: "/", maxAge: 0 });
  res.cookies.set("apmg-user", "", { path: "/", maxAge: 0 });
  return res;
}
