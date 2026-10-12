"use client";

/**
 * Talks to the Muqaddim Chrome extension through window.postMessage. The
 * extension's bridge.js content script is only injected on the site origin
 * the user chose in the extension popup.
 */

export interface ExtensionStatus {
  version: string;
  siteOrigin: string | null;
  configured: boolean;
  enabled: boolean;
  submitMode: "auto" | "dry";
  tokenExpiresAt: string | null;
  running: boolean;
  todayCount: number;
  maxPerDay: number;
  lastRun: {
    at: string;
    dryRun: boolean;
    found: number;
    submitted: number;
    skipped: number;
    failed: number;
    note: string;
  } | null;
  nextRuns: number[];
}

export interface ExtensionLogEntry {
  at: string;
  status: "submitted" | "dry" | "skipped" | "failed";
  jobId?: string;
  url?: string;
  title?: string;
  company?: string;
  reason?: string;
}

export interface PendingApplication {
  id: string;
  jobId: string;
  url: string;
  title: string;
  company: string;
  appliedAt: string;
  cv: unknown;
  coverLetter: string;
  language: "ar" | "en";
  hasJobDescription: boolean;
}

let counter = 0;

export function extensionRequest<T>(type: string, payload?: unknown, timeoutMs = 2500): Promise<T | null> {
  return new Promise((resolve) => {
    const id = `muq-${Date.now()}-${++counter}`;
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(null); // extension missing or not allowed on this origin
    }, timeoutMs);
    function onMessage(e: MessageEvent) {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const m = e.data as { muq?: string; id?: string; data?: T & { error?: string } };
      if (m?.muq !== "ext" || m.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(m.data && !m.data.error ? m.data : null);
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ muq: "page", id, type, payload }, window.location.origin);
  });
}
