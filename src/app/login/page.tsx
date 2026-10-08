import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { Mark } from "@/components/ui/Mark";
import { currentSession } from "@/lib/auth";
import { readConfig } from "@/lib/config";
import { Messages } from "@/lib/messages";
import { safeNext } from "@/lib/redirect";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const config = readConfig(process.env);
  const nextPath = safeNext((await searchParams).next);
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
          <LoginForm nextPath={nextPath} />
        )}
      </div>
    </main>
  );
}
