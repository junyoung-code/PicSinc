import { NextResponse } from "next/server";
import { signedTestMode, testModeActive, testModeCookie, verifyOperatorCode } from "@/core/festival-analytics-server";

export async function GET() {
  return NextResponse.json({ active: await testModeActive() }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const raw = await request.text();
  if (raw.length > 256) return new Response(null, { status: 413 });
  let code: unknown;
  try { code = JSON.parse(raw).code; } catch { return new Response(null, { status: 400 }); }
  if (typeof code !== "string" || !verifyOperatorCode(code)) return new Response(null, { status: 403 });
  const answer = NextResponse.json({ active: true });
  answer.cookies.set(testModeCookie, signedTestMode(), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 4 * 60 * 60 });
  return answer;
}
export async function DELETE(request: Request) {
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const answer = NextResponse.json({ active: false });
  answer.cookies.delete(testModeCookie);
  return answer;
}
