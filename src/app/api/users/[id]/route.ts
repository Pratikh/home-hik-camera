import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { accountStore, type Role } from "@/server/auth/accounts";
import { requireAdmin } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as { enabled?: unknown; role?: unknown; password?: unknown } | null;
  const patch: { enabled?: boolean; role?: Role; password?: string } = {};
  if (typeof body?.enabled === "boolean") patch.enabled = body.enabled;
  if (body?.role === "ADMIN" || body?.role === "VIEWER") patch.role = body.role;
  if (typeof body?.password === "string") {
    if (body.password.length < 8 || body.password.length > 200) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }
    patch.password = body.password;
  }
  const accounts = accountStore(getConfig().dataDir);
  const result = accounts.updateUser(id, patch);
  if (result === "missing") return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (result === "last_admin") return NextResponse.json({ error: "The last administrator cannot be removed." }, { status: 409 });
  const action = patch.password ? "PASSWORD_CHANGED" : patch.enabled === false ? "USER_DISABLED" : "USER_UPDATED";
  accounts.writeAudit({
    userId: auth.userId,
    action,
    resource: id,
    metadata: { role: patch.role ?? null, enabled: patch.enabled ?? null },
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent"),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const accounts = accountStore(getConfig().dataDir);
  const result = accounts.deleteUser(id);
  if (result === "missing") return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (result === "last_admin") return NextResponse.json({ error: "The last administrator cannot be removed." }, { status: 409 });
  accounts.writeAudit({
    userId: auth.userId,
    action: "USER_DELETED",
    resource: id,
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent"),
  });
  return new NextResponse(null, { status: 204 });
}
