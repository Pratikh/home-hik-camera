import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password-hash";
import { consumeRateLimit, resetRateLimits } from "@/lib/rate-limit";
import { memoryEventStore } from "@/server/events/event-store";
import { AccountStore } from "@/server/auth/accounts";

describe("accounts", () => {
  it("hashes passwords and rejects a disabled user", () => {
    const stored = hashPassword("correct-horse");
    expect(stored).not.toContain("correct-horse");
    expect(verifyPassword("correct-horse", stored)).toBe(true);
    expect(verifyPassword("wrong-horse", stored)).toBe(false);
    const accounts = new AccountStore(memoryEventStore().db);
    accounts.ensureBootstrapAdmin("home", "correct-horse");
    const admin = accounts.findByUsername("home");
    expect(admin?.role).toBe("ADMIN");
    expect(accounts.updateUser(admin!.id, { enabled: false })).toBe("last_admin");
    const viewer = accounts.createUser({ username: "guest", password: "another-secret", role: "VIEWER" });
    expect(viewer?.enabled).toBe(true);
    expect(accounts.updateUser(viewer!.id, { enabled: false })).toBe("ok");
    expect(accounts.findByUsername("guest")?.enabled).toBe(false);
    expect(accounts.deleteUser(admin!.id)).toBe("last_admin");
  });

  it("limits repeated login attempts", () => {
    resetRateLimits();
    for (let attempt = 0; attempt < 8; attempt += 1) expect(consumeRateLimit("login:test", 8, 1000, 1).allowed).toBe(true);
    expect(consumeRateLimit("login:test", 8, 1000, 1).allowed).toBe(false);
  });
});
