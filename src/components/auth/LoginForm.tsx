"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Messages } from "@/lib/messages";
import { navigate } from "@/lib/client-api";

/**
 * Sign-in form.
 *
 * Credentials are submitted as a POST body, never as query parameters.
 *
 * The form is also wired to work as a plain HTML POST to the login endpoint, so
 * a click that lands *before* React has hydrated still signs the user in instead
 * of degrading to a native GET. That earlier behaviour put the password in the
 * URL: the form had no `method`, so the browser default of GET serialised the
 * named fields into `?username=…&password=…`. Declaring `method="post"` makes
 * that impossible at the HTML level, and the endpoint accepts a form body so the
 * un-hydrated click succeeds on the first try.
 *
 * `login-security.test.ts` asserts the rendered markup keeps `method="post"`,
 * `action="/api/auth/login"`, `name="username"`, `name="password"` (type
 * password) and a hidden `name="next"` field. Keep them.
 */
export function LoginForm({ nextPath, initialError = null }: { nextPath: string; initialError?: string | null }) {
  const [error, setError] = useState<string | null>(initialError);
  const [pending, setPending] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  // Announce a failed sign-in to assistive technology and move focus to the
  // error, so a screen-reader user is told something happened.
  useEffect(() => {
    if (!error) return;
    errorRef.current?.focus();
  }, [error]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    // Once hydrated this intercepts the submit and no navigation occurs.
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: String(form.get("username") ?? ""),
          password: String(form.get("password") ?? ""),
          next: nextPath,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: unknown; redirect?: unknown };
      if (!response.ok) {
        setError(typeof body.error === "string" ? body.error : Messages.authFailed);
        return;
      }
      const redirect = typeof body.redirect === "string" ? body.redirect : nextPath;
      navigate(redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/");
    } catch {
      setError(Messages.backendDown);
    } finally {
      setPending(false);
    }
  }

  return (
    /*
      `method="post"` is a security requirement, not a style choice: it is what
      keeps the password out of the URL if the submit is ever handled natively.
      The action lets that native path complete a real sign-in.
    */
    <form method="post" action="/api/auth/login" onSubmit={(event) => void onSubmit(event)} className="login__form">
      <div className="field">
        <label className="field__label" htmlFor="login-username">
          Username
        </label>
        <input
          id="login-username"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-invalid={error ? true : undefined}
          className="input"
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="login-password">
          Password
        </label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={error ? true : undefined}
          className="input"
        />
      </div>

      {/* Carries the post-login destination through a native submit. */}
      <input type="hidden" name="next" value={nextPath} />

      {/* role="alert" announces the message; tabIndex allows it to take focus. */}
      {error ? (
        <p ref={errorRef} tabIndex={-1} role="alert" className="notice notice--danger">
          <Icon name="alert" />
          <span>{error}</span>
        </p>
      ) : null}

      <button type="submit" disabled={pending} className="btn btn--primary btn--lg login__submit">
        {pending ? "Signing in" : "Sign in"}
      </button>
    </form>
  );
}
