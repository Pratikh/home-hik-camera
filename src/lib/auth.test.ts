import { describe, expect, it } from "vitest";
import { credentialsMatch, evaluateLogin } from "@/lib/passwords";

describe("login", () => {
  it("rejects a wrong password and a wrong username", () => {
    expect(credentialsMatch("home", "nope", "home", "correct-horse")).toBe(false);
    expect(credentialsMatch("other", "correct-horse", "home", "correct-horse")).toBe(false);
    expect(credentialsMatch("home", "correct-horse", "home", "correct-horse")).toBe(true);
  });

  it("rejects login when application configuration is missing", () => {
    expect(evaluateLogin(false, "home", "correct-horse", "home", "correct-horse")).toBe("invalid_config");
    expect(evaluateLogin(true, "home", "wrong", "home", "correct-horse")).toBe("rejected");
    expect(evaluateLogin(true, "home", "correct-horse", "home", "correct-horse")).toBe("ok");
  });
});
