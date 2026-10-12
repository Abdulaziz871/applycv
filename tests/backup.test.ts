import { beforeEach, describe, expect, it } from "vitest";
import { buildBackup, mergeSnapshots, parseBackup, snapshotFromBackup } from "@/lib/backup";
import { SCHEMA_VERSION } from "@/lib/schemas";
import * as storage from "@/lib/storage";
import { installFakeLocalStorage, sampleApplication, sampleCvAr, sampleCvEn } from "./helpers";

let fake: ReturnType<typeof installFakeLocalStorage>;

async function seed() {
  await storage.setMasterCv(sampleCvEn());
  await storage.saveApplication(sampleApplication("a1"));
  await storage.saveApplication(
    sampleApplication("a2", { createdAt: "2026-09-05T10:00:00.000Z", updatedAt: "2026-09-05T10:00:00.000Z", cv: sampleCvAr(), language: "ar", company: "شركة" }),
  );
  await storage.setSettings({ dailyCap: 40, defaultOutputLanguage: "ar" });
  await storage.appendSentLog({ id: "s1", email: "hr@acme.com", company: "Acme", position: "Eng", sentAt: "2026-09-06T10:00:00.000Z", status: "sent" });
}

beforeEach(() => {
  fake = installFakeLocalStorage();
});

describe("storage", () => {
  it("returns safe defaults when empty or corrupted", async () => {
    expect(await storage.getMasterCv()).toBeNull();
    expect(await storage.listApplications()).toEqual([]);
    expect((await storage.getSettings()).dailyCap).toBe(30);
    fake.localStorage.setItem(storage.KEYS.masterCv, "{not json");
    fake.localStorage.setItem(storage.KEYS.applications, JSON.stringify({ schemaVersion: 1, data: [{ bad: true }] }));
    fake.localStorage.setItem(storage.KEYS.settings, JSON.stringify({ schemaVersion: 99, data: {} }));
    expect(await storage.getMasterCv()).toBeNull();
    expect(await storage.listApplications()).toEqual([]);
    expect((await storage.getSettings()).dailyCap).toBe(30);
  });

  it("does not throw when localStorage is unavailable", async () => {
    (globalThis as unknown as { window: unknown }).window = {
      get localStorage() {
        throw new Error("SecurityError");
      },
      dispatchEvent: () => true,
    };
    expect(await storage.getMasterCv()).toBeNull();
    await expect(storage.setMasterCv(sampleCvEn())).resolves.toBe(true); // in-memory fallback
    expect(storage.isStorageAvailable()).toBe(false);
  });
});

describe("backup export → clear → import round trip", () => {
  it("restores identical data (replace mode)", async () => {
    await seed();
    const before = await storage.readSnapshot();
    const exported = JSON.stringify(buildBackup(before), null, 2);

    fake.localStorage.clear();
    expect(await storage.hasAnyData()).toBe(false);

    const parsed = parseBackup(exported);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await storage.writeSnapshot(snapshotFromBackup(parsed.backup));

    expect(await storage.readSnapshot()).toEqual(before);
  });

  it("contains no secrets", async () => {
    await seed();
    const json = JSON.stringify(buildBackup(await storage.readSnapshot()));
    expect(Object.keys(JSON.parse(json)).sort()).toEqual(
      ["app", "applications", "exportedAt", "masterCv", "schemaVersion", "sentLog", "settings"].sort(),
    );
    expect(json).not.toMatch(/password|token|secret|session|cookie/i);
  });

  it("merge keeps the newer item per id and unions history", async () => {
    await seed();
    const current = await storage.readSnapshot();
    const incoming = buildBackup({
      ...current,
      applications: [
        sampleApplication("a1", { company: "Newer Acme", updatedAt: "2026-09-10T10:00:00.000Z" }),
        sampleApplication("a2", { company: "Older", updatedAt: "2026-08-01T10:00:00.000Z" }),
        sampleApplication("a3", { company: "Brand new", createdAt: "2026-09-08T10:00:00.000Z", updatedAt: "2026-09-08T10:00:00.000Z" }),
      ],
    });
    const merged = mergeSnapshots(current, incoming);
    const byId = Object.fromEntries(merged.applications.map((a) => [a.id, a.company]));
    expect(byId).toEqual({ a1: "Newer Acme", a2: "شركة", a3: "Brand new" });
    expect(merged.masterCv).toEqual(current.masterCv);
  });
});

describe("invalid backup files are rejected safely", () => {
  const valid = () => buildBackup({ masterCv: sampleCvEn(), applications: [sampleApplication("a1")], sentLog: [], settings: { dailyCap: 30, defaultOutputLanguage: "auto" } });
  const rejects = (text: string) => {
    const r = parseBackup(text);
    expect(r.ok).toBe(false);
    return r.ok ? "" : r.error;
  };

  it("rejects non-JSON, foreign JSON and wrong shapes", () => {
    rejects("not json at all");
    rejects("[]");
    rejects("null");
    rejects(JSON.stringify({ hello: "world" }));
    rejects(JSON.stringify({ ...valid(), app: "other-app" }));
    rejects(JSON.stringify({ ...valid(), applications: "nope" }));
    rejects(JSON.stringify({ ...valid(), settings: { dailyCap: 9999, defaultOutputLanguage: "auto" } }));
    rejects(JSON.stringify({ ...valid(), schemaVersion: "1" }));
    const bad = valid();
    (bad.applications[0].cv as unknown as { skills: unknown }).skills = 5;
    rejects(JSON.stringify(bad));
  });

  it("rejects files from a newer app version with a clear message", () => {
    const msg = rejects(JSON.stringify({ ...valid(), schemaVersion: SCHEMA_VERSION + 1 }));
    expect(msg).toContain("أحدث");
  });

  it("does not touch existing data when the file is rejected", async () => {
    await seed();
    const before = await storage.readSnapshot();
    parseBackup("garbage");
    expect(await storage.readSnapshot()).toEqual(before);
  });

  it("accepts a valid file", () => {
    expect(parseBackup(JSON.stringify(valid())).ok).toBe(true);
  });
});
