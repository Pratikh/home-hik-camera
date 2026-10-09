import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { Mark } from "@/components/ui/Mark";
import { currentSession } from "@/lib/auth";
import { readConfig } from "@/lib/config";
import { Messages } from "@/lib/messages";
import { safeNext } from "@/lib/redirect";

export const dynamic = "force-dynamic";

/** Reason codes the login endpoint may redirect back with. Never credentials. */
function errorMessage(code: string | undefined): string | null {
  if (code === "auth") return Messages.authFailed;
  if (code === "rate") return "Too many attempts. Try again shortly.";
  if (code === "config") return Messages.invalidConfig;
  return null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; password?: string }>;
}) {
  const config = readConfig(process.env);
  const params = await searchParams;

  /*
   * Defence in depth: a credential must never sit in the address bar. The form
   * posts its body (see LoginForm), so this only fires for a hand-built URL or a
   * bookmark left over from an older build. Redirecting to the clean path drops
   * it from the URL immediately.
   */
  if (typeof params.password === "string") redirect("/login");

  const nextPath = safeNext(params.next);
  const initialError = errorMessage(params.error);
  if (config.appConfigured) {
    const session = await currentSession();
    if (session) redirect(nextPath);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10 text-ink">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-panel p-6">
        <div className="flex items-center gap-3">
          <Mark />
          <div>
            <h1 className="text-lg font-semibold">Home CCTV</h1>
            <p className="text-sm text-muted">Local network hub</p>
          </div>
        </div>
        {config.appErrors.length > 0 ? (
          <div className="mt-6" role="alert">
            <p className="text-sm font-medium">{Messages.invalidConfig}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
              {config.appErrors.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : (
          <LoginForm nextPath={nextPath} initialError={initialError} />
        )}
      </div>
    </main>
  );
}
