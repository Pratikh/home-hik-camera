import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { Icon } from "@/components/ui/Icon";
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

/**
 * Sign-in page.
 *
 * Chrome-free by design: the app shell (sidebar/appbar) is deliberately absent
 * until a session exists. The split layout keeps the local-first promise beside
 * the form on wide screens and collapses to a compact band above it on tablets
 * and phones (see the `.login` component rules in globals.css).
 */
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
    <main className="login">
      <section className="login__brand" aria-label="About Home CCTV Hub">
        <div className="login__tag">
          <Mark className="brand__mark" />
          <div>
            <div className="brand__name">Home CCTV</div>
            <div className="brand__sub">Local hub</div>
          </div>
        </div>

        <div>
          <p className="login__headline">Your cameras. Your network. No cloud.</p>
          <p className="login__lede">
            The hub talks only to the DVR inside your LAN. Live view, recorded playback and detections are served from
            the house — there is no relay in between.
          </p>
          <div className="login__points">
            <div className="login__point">
              <Icon name="camera" />
              <span>Four H.264 substreams served from the local gateway</span>
            </div>
            <div className="login__point">
              <Icon name="database" />
              <span>Recordings read straight from the DVR&apos;s own storage</span>
            </div>
            <div className="login__point">
              <Icon name="lock" />
              <span>Accounts and sessions never leave this hub</span>
            </div>
          </div>
        </div>

        <div>
          <div className="pill" style={{ alignSelf: "flex-start", marginBottom: 16 }}>
            <span className="dot dot--online" aria-hidden="true" />
            Local network only
          </div>
          <div className="login__facts">
            <div className="login__fact">
              <b>4</b>
              <span>cameras</span>
            </div>
            <div className="login__fact">
              <b>30-day</b>
              <span>history</span>
            </div>
            <div className="login__fact">
              <b>100%</b>
              <span>local</span>
            </div>
          </div>
        </div>
      </section>

      <section className="login__panel" aria-label="Sign in">
        <div className="login__form-wrap">
          <div className="login__panel-mark" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
            <Mark className="brand__mark" />
            <div>
              <div className="brand__name">Home CCTV</div>
              <div className="brand__sub">Local hub</div>
            </div>
          </div>

          <div className="page-head__eyebrow" style={{ marginBottom: 8 }}>
            Secure sign-in
          </div>
          <h1 className="login__title">Sign in to the hub</h1>
          <p className="login__sub">
            Use the account held on this hub. Credentials are checked locally — nothing is verified against a cloud
            service.
          </p>

          {config.appErrors.length > 0 ? (
            <div className="notice notice--danger" role="alert" style={{ marginTop: 24 }}>
              <Icon name="alert" />
              <div>
                <p style={{ fontSize: "var(--fs-13)", fontWeight: 600 }}>{Messages.invalidConfig}</p>
                <ul style={{ marginTop: 6, paddingLeft: 18, listStyle: "disc", fontSize: "var(--fs-12)" }}>
                  {config.appErrors.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <LoginForm nextPath={nextPath} initialError={initialError} />
          )}

          <div className="login__foot">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <Icon name="lock" className="icon icon-sm" />
              <span>Local network only · session signed on this hub</span>
            </span>
          </div>

          <div className="notice" style={{ marginTop: 26 }}>
            <Icon name="shield" />
            <div>
              <div style={{ fontWeight: 600, fontSize: "var(--fs-12)" }}>Nothing leaves the house</div>
              <div style={{ marginTop: 3, fontSize: "var(--fs-12)", color: "var(--muted)" }}>
                The hub serves the cameras and the DVR directly. It is not reachable from outside your network.
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
