import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { consumeRateLimit } from "@/lib/rate-limit";
import { accountStore, type Role } from "@/server/auth/accounts";
import { requireAdmin } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function validUsername(value: string): boolean {
  return /^[A-Za-z0-9._-]{2,32}$/.test(value);
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ users: accountStore(getConfig().dataDir).listUsers() });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const limit = consumeRateLimit(`users:${auth.userId}`, 20, 15 * 60 * 1000);
  if (!limit.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const body = (await request.json().catch(() => null)) as { username?: unknown; password?: unknown; role?: unknown } | null;
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const role: Role | null = body?.role === "ADMIN" || body?.role === "VIEWER" ? body.role : null;
  if (!validUsername(username) || password.length < 8 || password.length > 200 || !role) {
    return NextResponse.json({ error: "Enter a username and a password of at least 8 characters." }, { status: 400 });
  }
  const accounts = accountStore(getConfig().dataDir);
  const created = accounts.createUser({ username, password, role });
  if (!created) return NextResponse.json({ error: "That username is already in use." }, { status: 409 });
  accounts.writeAudit({
    userId: auth.userId,
    action: "USER_CREATED",
    resource: username,
    metadata: { role },
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent"),
  });
  return NextResponse.json({ user: { id: created.id, username: created.username, role: created.role, enabled: created.enabled } }, { status: 201 });
}
