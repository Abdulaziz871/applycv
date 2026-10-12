"use client";

import { LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Card, Field, Input, Notice } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.replace("/apply");
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "تعذّر تسجيل الدخول.");
    } catch {
      setError("تعذّر الاتصال بالخادم. تحقق من الإنترنت.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-[16px] bg-primary text-2xl font-bold text-white shadow-soft">
            م
          </div>
          <h1 className="text-2xl font-bold">مُقدِّم</h1>
          <p className="mt-1 text-[15px] text-muted">تقديم الوظائف بهدوء وترتيب</p>
        </div>
        <Card>
          <form onSubmit={submit} className="space-y-4">
            <Field label="كلمة السر">
              {(id) => (
                <div className="relative">
                  <Input
                    id={id}
                    type="password"
                    dir="ltr"
                    autoFocus
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="ps-10"
                  />
                  <LockKeyhole className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                </div>
              )}
            </Field>
            {error && <Notice tone="danger">{error}</Notice>}
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!password}>
              دخول
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
