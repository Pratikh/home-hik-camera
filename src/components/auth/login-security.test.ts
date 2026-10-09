import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LoginForm } from "@/components/auth/LoginForm";

/**
 * Sign-in credential handling.
 *
 * Regression guard for a real defect: the form declared no `method`, so the
 * browser default of GET serialised the named fields into the URL. On a cold
 * Incognito load the first click could land before React hydrated, produce
 * `/login?username=…&password=…`, and leave the password in the address bar,
 * browser history and server logs. The second click worked because hydration had
 * completed by then.
 */

function render() {
  return renderToStaticMarkup(createElement(LoginForm, { nextPath: "/", initialError: null }));
}

describe("login form - credential transport", () => {
  it("declares POST so a native submit can never become a query string", () => {
    expect(render()).toContain('method="post"');
  });

  it("posts to the login endpoint so an un-hydrated click still signs in", () => {
    expect(render()).toContain('action="/api/auth/login"');
  });

  it("does not leave the method to the browser default of GET", () => {
    const form = /<form[^>]*>/.exec(render())?.[0] ?? "";
    expect(form).toContain("post");
    expect(form).not.toMatch(/method="get"/i);
  });

  it("never places credentials in the form action or any URL", () => {
    const html = render();
    const action = /action="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(action).not.toContain("?");
    expect(action).not.toContain("password");
  });

  it("carries the destination in a hidden field rather than the action URL", () => {
    const html = render();
    expect(html).toContain('type="hidden"');
    expect(html).toContain('name="next"');
  });
});

describe("login form - field names", () => {
  it("keeps the names a native form POST needs", () => {
    const html = render();
    expect(html).toContain('name="username"');
    expect(html).toContain('name="password"');
  });

  it("uses a password input so the value is not displayed", () => {
    expect(render()).toMatch(/name="password"[^>]*type="password"|type="password"[^>]*name="password"/);
  });
});

describe("login endpoint - method and body handling", () => {
  const route = readFileSync("src/app/api/auth/login/route.ts", "utf8");

  it("only exposes POST, so a GET cannot submit credentials", () => {
    expect(route).toContain("export async function POST");
    expect(route).not.toContain("export async function GET");
  });

  it("accepts a form body so an un-hydrated submit still authenticates", () => {
    expect(route).toContain("application/x-www-form-urlencoded");
    expect(route).toContain("request.formData()");
  });

  it("redirects with a relative Location, never the server bind address", () => {
    // `NextResponse.redirect(new URL(next, request.url))` produced
    // http://0.0.0.0:3000/ — unusable from a browser on the LAN.
    expect(route).not.toMatch(/NextResponse\.redirect\(new URL\(next/);
    expect(route).toContain('response.headers.set("location", path)');
  });

  it("sends only a reason code back on failure, never the credentials", () => {
    expect(route).toContain("/login?error=auth");
    expect(route).not.toMatch(/error=[^"]*password/);
  });
});
