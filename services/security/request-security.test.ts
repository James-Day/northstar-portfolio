import { describe, expect, it } from "vitest";
import { MemoryRateLimitStore, redactRequestLog, requestClientKey, requestRateLimit } from "@/services/security/request-security";

describe("request security", () => {
  it("allows a bounded burst and returns a retry window after exhaustion", () => {
    const store = new MemoryRateLimitStore();
    expect(store.consume("ip", 0, 2, 60_000)).toMatchObject({ allowed: true, remaining: 1 });
    expect(store.consume("ip", 1, 2, 60_000)).toMatchObject({ allowed: true, remaining: 0 });
    expect(store.consume("ip", 2, 2, 60_000)).toMatchObject({ allowed: false, retryAfterSeconds: 60 });
    expect(store.consume("ip", 60_000, 2, 60_000)).toMatchObject({ allowed: true, remaining: 1 });
  });

  it("uses trusted edge identity and classifies writes more tightly", () => {
    const request = new Request("https://api.test/v1/accounts", { headers: { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.4" } });
    expect(requestClientKey(request)).toBe("203.0.113.9");
    expect(requestRateLimit("/v1/accounts", "POST")).toEqual({ limit: 30, windowMs: 60_000 });
  });

  it("removes query strings and never carries credential headers into logs", () => {
    const output = redactRequestLog({ requestId: "req", method: "get", path: "/v1/me?token=secret", status: 200, userId: "user" });
    expect(output).toEqual({ requestId: "req", method: "GET", path: "/v1/me", status: 200, userId: "user" });
    expect(JSON.stringify(output)).not.toContain("secret");
  });
});
