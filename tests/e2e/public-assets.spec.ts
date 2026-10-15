import { test, expect } from "./support/fixtures";

/**
 * Public assets must stay reachable *without* a session.
 *
 * Regression guard: `/manifest.webmanifest` was missing from the auth matcher, so
 * anonymous requests were redirected to /login. The browser then parsed the login
 * HTML as JSON and reported "Manifest: Line: 1, column: 1, Syntax error". These
 * checks run with no session at all, which is exactly how the browser asks for a
 * manifest while sitting on the login page.
 *
 * Nothing here is secret: a PWA manifest, an icon and robots.txt.
 */
test.describe("SHELL - public assets", () => {
  test("PUBLIC-001 the manifest is served as JSON to an anonymous caller", async ({ qa }) => {
    const anonymous = await qa.freshContext();
    try {
      const response = await anonymous.request.get("/manifest.webmanifest", { maxRedirects: 0 });
      expect(response.status(), "GET /manifest.webmanifest").toBe(200);
      expect(response.headers()["content-type"]).toContain("application/manifest+json");

      // It must parse as JSON — the original bug was HTML being returned here.
      const body = (await response.json()) as { name?: string; start_url?: string };
      expect(body.name).toBeTruthy();
      expect(body.start_url).toBe("/");
    } finally {
      await anonymous.close();
    }
  });

  test("PUBLIC-002 the icon and robots.txt are public too", async ({ qa }) => {
    const anonymous = await qa.freshContext();
    try {
      for (const path of ["/icon.svg", "/robots.txt"]) {
        const response = await anonymous.request.get(path, { maxRedirects: 0 });
        expect(response.status(), `GET ${path}`).toBe(200);
      }
    } finally {
      await anonymous.close();
    }
  });

  test("PUBLIC-003 everything else still requires a session", async ({ qa }) => {
    const anonymous = await qa.freshContext();
    try {
      // A page redirects to /login…
      const page = await anonymous.request.get("/", { maxRedirects: 0 });
      expect([302, 307]).toContain(page.status());
      expect(page.headers()["location"]).toContain("/login");

      // …and an API answers 401 rather than HTML.
      const api = await anonymous.request.get("/api/faces", { maxRedirects: 0 });
      expect(api.status()).toBe(401);

      // A path that does not exist is not made public by the manifest exclusion.
      const unknown = await anonymous.request.get("/manifest.webmanifest.bak", { maxRedirects: 0 });
      expect([302, 307]).toContain(unknown.status());
    } finally {
      await anonymous.close();
    }
  });
});
