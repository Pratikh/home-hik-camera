import { describe, expect, it } from "vitest";
import { config } from "@/proxy";

describe("proxy matcher", () => {
  it("lets the development HMR WebSocket bypass authentication middleware", () => {
    const matcher = config.matcher.join(" ");
    expect(matcher).toContain("_next/hmr");
    expect(matcher).toContain("_next/webpack-hmr");
  });

  it("keeps private pages and account routes behind the session check", () => {
    const matcher = config.matcher.join(" ");
    expect(matcher).not.toContain("|account|");
    expect(matcher).not.toContain("|settings|");
    expect(matcher).not.toContain("|faces|");
  });
});
