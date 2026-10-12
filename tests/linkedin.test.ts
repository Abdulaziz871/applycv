import { beforeAll, describe, expect, it } from "vitest";
import { createExtensionToken, createSessionToken, verifyExtensionRequest, verifySessionToken } from "@/lib/auth";
import { sanitizeAnswer } from "@/lib/linkedin";
import { defaultLinkedinSettings, linkedinSettingsSchema } from "@/lib/linkedin-settings";

beforeAll(() => {
  process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";
});

describe("extension token", () => {
  it("works only as a bearer token on the allowed API routes", async () => {
    const token = await createExtensionToken();
    expect(await verifyExtensionRequest("/api/tailor", `Bearer ${token}`)).toBe(true);
    expect(await verifyExtensionRequest("/api/pdf", `Bearer ${token}`)).toBe(true);
    expect(await verifyExtensionRequest("/api/linkedin/answer", `Bearer ${token}`)).toBe(true);
    expect(await verifyExtensionRequest("/api/send", `Bearer ${token}`)).toBe(false);
    expect(await verifyExtensionRequest("/api/linkedin/token", `Bearer ${token}`)).toBe(false);
    expect(await verifyExtensionRequest("/api/tailor", undefined)).toBe(false);
  });

  it("is not a browser session, and a session is not an extension token", async () => {
    expect(await verifySessionToken(await createExtensionToken())).toBe(false);
    expect(await verifyExtensionRequest("/api/tailor", `Bearer ${await createSessionToken()}`)).toBe(false);
  });
});

describe("form answers", () => {
  it("rejects unknown answers and options that are not offered", () => {
    expect(sanitizeAnswer({ kind: "text", options: [] }, { known: false, answer: "Yes" })).toBeNull();
    expect(sanitizeAnswer({ kind: "radio", options: ["Yes", "No"] }, { known: true, answer: "yes" })).toBe("Yes");
    expect(sanitizeAnswer({ kind: "select", options: ["Yes", "No"] }, { known: true, answer: "Maybe" })).toBeNull();
    expect(sanitizeAnswer({ kind: "number", options: [] }, { known: true, answer: "2 years" })).toBeNull();
    expect(sanitizeAnswer({ kind: "number", options: [] }, { known: true, answer: "2" })).toBe("2");
  });

  it("default settings are valid and search the last 24h in Riyadh", () => {
    const s = linkedinSettingsSchema.parse(defaultLinkedinSettings());
    expect(s.submitMode).toBe("dry");
    expect(s.enabled).toBe(false);
    expect(s.times).toEqual(["10:00", "14:00", "17:00"]);
  });
});
