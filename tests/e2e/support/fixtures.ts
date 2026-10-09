/* eslint-disable react-hooks/rules-of-hooks -- `use` below is Playwright's fixture callback, not a React hook. */
import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
} from "@playwright/test";
import {
  VIEWPORT,
  baseURL,
  loadQaEnv,
  requireAdminCredentials,
  requireViewerCredentials,
  type Credentials,
} from "./qa-env";
import { auditUrl, containsSecret, redact, registerSecret } from "./redact";

export type Role = "admin" | "viewer";

export type HttpError = { status: number; method: string; url: string };

export type CleanOptions = {
  /** HTTP statuses that are expected for this test (for example 401 on a bad password). */
  allowStatuses?: number[];
  /** Extra console-error patterns that are expected. */
  allowConsole?: RegExp[];
  /** Extra request-failure patterns that are expected. */
  allowRequestFailures?: RegExp[];
};

export type DiagnosticSnapshot = {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  httpErrors: HttpError[];
  secretInConsole: string[];
};

export type Diagnostics = {
  snapshot(): DiagnosticSnapshot;
  /** Fail when anything unexpected happened. Never prints a credential. */
  expectClean(options?: CleanOptions): void;
  /** SEC-008: no credential may appear in the console. */
  expectNoSecretInConsole(): void;
};

/** Console patterns that are inherent to the app being authenticated out mid-test. */
function statusFromConsole(message: string): number | null {
  const match = /status of (\d{3})/.exec(message);
  return match ? Number(match[1]) : null;
}

/**
 * Collect console errors, uncaught page errors, failed requests and 4xx/5xx
 * responses for one page. Text is redacted before it is stored, so a failure
 * message can never leak a credential.
 */
export function createDiagnostics(page: Page): Diagnostics {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const httpErrors: HttpError[] = [];
  const secretInConsole: string[] = [];

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (containsSecret(text)) secretInConsole.push(redact(text));
    consoleErrors.push(redact(text));
  });
  page.on("pageerror", (error) => pageErrors.push(redact(error.message)));
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText ?? "failed";
    // A navigation away aborts in-flight requests. That is normal and not a defect.
    if (/ERR_ABORTED/.test(errorText)) return;
    failedRequests.push(redact(`${request.method()} ${request.url()} (${errorText})`));
  });
  page.on("response", (response) => {
    const status = response.status();
    if (status < 400) return;
    // The event stream is long-lived; its close is not an error worth failing on.
    httpErrors.push({
      status,
      method: response.request().method(),
      url: redact(response.url()),
    });
  });

  return {
    snapshot: () => ({
      consoleErrors: [...consoleErrors],
      pageErrors: [...pageErrors],
      failedRequests: [...failedRequests],
      httpErrors: [...httpErrors],
      secretInConsole: [...secretInConsole],
    }),
    expectClean(options: CleanOptions = {}) {
      const allowStatuses = new Set(options.allowStatuses ?? []);
      const allowConsole = options.allowConsole ?? [];
      const allowFailures = options.allowRequestFailures ?? [];

      const unexpectedConsole = consoleErrors.filter((text) => {
        if (allowConsole.some((pattern) => pattern.test(text))) return false;
        const status = statusFromConsole(text);
        if (status !== null && allowStatuses.has(status)) return false;
        return true;
      });
      const unexpectedHttp = httpErrors.filter((entry) => !allowStatuses.has(entry.status));
      const unexpectedFailures = failedRequests.filter(
        (text) => !allowFailures.some((pattern) => pattern.test(text)),
      );

      expect(pageErrors, "uncaught page errors").toEqual([]);
      expect(unexpectedConsole, "unexpected console errors").toEqual([]);
      expect(unexpectedFailures, "unexpected failed requests").toEqual([]);
      expect(unexpectedHttp, "unexpected HTTP error responses").toEqual([]);
    },
    expectNoSecretInConsole() {
      expect(secretInConsole, "a credential appeared in the browser console").toEqual([]);
    },
  };
}

export type Qa = {
  /** A per-test source address so the login rate limiter is not shared between tests. */
  clientIp: string;
  credentials(role?: Role): Credentials;
  /** Sign in from /login. Returns how many POSTs to /api/auth/login were observed. */
  login(page: Page, role?: Role): Promise<number>;
  logout(page: Page): Promise<void>;
  /** A brand new, isolated context at the one supported desktop viewport. */
  freshContext(options?: { javaScriptEnabled?: boolean; storageState?: string }): Promise<BrowserContext>;
  assertUrlHasNoCredential(page: Page, label?: string): void;
  expectAuthenticated(page: Page, role?: Role): Promise<void>;
};

let clientIpSequence = 0;
/**
 * A random /24 per test run, plus a per-test host octet.
 *
 * The hub's login rate limiter is keyed on the client address, so tests must not
 * share one bucket. (The limiter reads the caller-supplied `x-forwarded-for`
 * header; see the QA findings note in docs/AI-QA.md.)
 */
const clientIpPrefix = `10.${60 + Math.floor(Math.random() * 30)}.${1 + Math.floor(Math.random() * 200)}`;

function nextClientIp(): string {
  clientIpSequence += 1;
  return `${clientIpPrefix}.${(clientIpSequence % 240) + 8}`;
}

/** Register every configured credential with the redactor. */
function bootstrap(): void {
  loadQaEnv();
  registerSecret(process.env.QA_ADMIN_PASSWORD);
  registerSecret(process.env.QA_VIEWER_PASSWORD);
}

type Fixtures = { qa: Qa; diag: Diagnostics };

export const test = base.extend<Fixtures>({
  qa: async ({ browser, context }, use) => {
    bootstrap();
    const clientIp = nextClientIp();
    await context.setExtraHTTPHeaders({ "x-forwarded-for": clientIp });

    const credentialsOf = (role: Role = "admin"): Credentials =>
      role === "viewer" ? requireViewerCredentials() : requireAdminCredentials();

    const freshContext = async (options?: { javaScriptEnabled?: boolean; storageState?: string }) =>
      browser.newContext({
        baseURL: baseURL(),
        viewport: VIEWPORT,
        javaScriptEnabled: options?.javaScriptEnabled,
        storageState: options?.storageState,
        extraHTTPHeaders: { "x-forwarded-for": nextClientIp() },
      });

    const assertUrlHasNoCredential = (page: Page, label = "URL") => {
      const url = page.url();
      const audit = auditUrl(url);
      expect(audit.reason, `${label} must not carry a credential: ${redact(url)}`).toBeNull();
      expect(redact(url)).not.toMatch(/[?&](username|password|passwd|pwd)=/i);
    };

    const login = async (page: Page, role: Role = "admin"): Promise<number> => {
      const creds = credentialsOf(role);
      const submissions: Request[] = [];
      const watcher = (request: Request) => {
        if (request.method() !== "POST") return;
        try {
          if (new URL(request.url()).pathname === "/api/auth/login") submissions.push(request);
        } catch {
          /* ignore unparseable */
        }
      };
      page.on("request", watcher);
      try {
        await page.goto("/login");
        await page.getByLabel("Username", { exact: true }).fill(creds.username);
        await page.getByLabel("Password", { exact: true }).fill(creds.password);
        // Exactly one click. A second click is the bug this suite guards against.
        await page.getByRole("button", { name: "Sign in" }).click();
        await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
      } finally {
        page.off("request", watcher);
      }
      assertUrlHasNoCredential(page, "Authenticated URL");
      return submissions.length;
    };

    const logout = async (page: Page) => {
      await page.getByRole("button", { name: "Log out" }).first().click();
      await page.waitForURL(/\/login/, { timeout: 20_000 });
    };

    const expectAuthenticated = async (page: Page, role?: Role) => {
      const response = await page.request.get("/api/auth/session");
      expect(response.status(), "session endpoint while authenticated").toBe(200);
      const body = (await response.json()) as { username?: string; role?: string };
      expect(body.username).toBeTruthy();
      expect(["ADMIN", "VIEWER"]).toContain(body.role);
      if (role === "admin") expect(body.role).toBe("ADMIN");
      if (role === "viewer") expect(body.role).toBe("VIEWER");
    };

    await use({
      clientIp,
      credentials: credentialsOf,
      login,
      logout,
      freshContext,
      assertUrlHasNoCredential,
      expectAuthenticated,
    });
  },

  diag: async ({ page }, use) => {
    const diagnostics = createDiagnostics(page);
    await use(diagnostics);
  },
});

export { expect };
export type { Browser, BrowserContext, Page };
