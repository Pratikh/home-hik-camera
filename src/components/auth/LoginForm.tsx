"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Messages } from "@/lib/messages";
import { navigate } from "@/lib/client-api";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  // Announce a failed sign-in to assistive technology and move focus to the
  // error, so a screen-reader user is told something happened.
  useEffect(() => {
    if (!error) return;
    errorRef.current?.focus();
  }, [error]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
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
    <form onSubmit={(event) => void onSubmit(event)} className="mt-6 grid gap-4" noValidate={false}>
      <label className="grid gap-1 text-sm">
        Username
        <input
          name="username"
          autoComplete="username"
          required
          aria-invalid={error ? true : undefined}
          className="rounded-lg border border-line bg-bg px-3 py-2"
        />
      </label>
      <label className="grid gap-1 text-sm">
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={error ? true : undefined}
          className="rounded-lg border border-line bg-bg px-3 py-2"
        />
      </label>
      {/* role="alert" announces the message; tabIndex allows it to take focus. */}
      {error ? (
        <p ref={errorRef} tabIndex={-1} className="text-sm text-offline" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-teal px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
      >
        {pending ? "Signing in" : "Sign in"}
      </button>
    </form>
  );
}