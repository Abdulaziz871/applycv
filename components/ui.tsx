"use client";

import clsx from "clsx";
import { AlertTriangle, CheckCircle2, ChevronDown, Info, Loader2, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { dirOf } from "@/lib/lang";

// ---------------- Button ----------------

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover shadow-soft disabled:bg-primary/50",
  secondary: "bg-surface text-text border border-border hover:bg-surface-muted disabled:opacity-50",
  ghost: "text-muted hover:bg-surface-muted hover:text-text disabled:opacity-50",
  danger: "bg-surface text-danger border border-danger/40 hover:bg-danger/5 disabled:opacity-50",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-[12px] font-medium transition-colors disabled:cursor-not-allowed",
        size === "sm" && "min-h-9 px-3 text-sm",
        size === "md" && "min-h-11 px-5 text-[15px]",
        size === "lg" && "min-h-12 px-6 text-base",
        variants[variant],
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

// ---------------- Card / layout ----------------

export function Card({
  className,
  children,
  as: Tag = "section",
}: {
  className?: string;
  children: ReactNode;
  as?: "section" | "div" | "article";
}) {
  return (
    <Tag className={clsx("rounded-[16px] border border-border bg-surface p-5 shadow-soft sm:p-6", className)}>
      {children}
    </Tag>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold leading-snug">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-[16px] border border-dashed border-border bg-surface/60 px-6 py-12 text-center">
      <div className="mb-4 grid size-14 place-items-center rounded-full bg-primary-soft text-primary">{icon}</div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="mt-1 max-w-md text-[15px] text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} aria-hidden />;
}

export function Notice({
  tone = "info",
  children,
  className,
}: {
  tone?: "info" | "warning" | "success" | "danger";
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    info: "bg-primary-soft text-primary border-primary/20",
    warning: "bg-modify text-[#6d4f14] border-warning/30",
    success: "bg-add text-[#2f5d45] border-success/30",
    danger: "bg-remove text-danger border-danger/30",
  } as const;
  const Icon = tone === "warning" || tone === "danger" ? AlertTriangle : tone === "success" ? CheckCircle2 : Info;
  return (
    <div className={clsx("flex items-start gap-3 rounded-[12px] border px-4 py-3 text-[14.5px]", tones[tone], className)} role={tone === "danger" ? "alert" : undefined}>
      <Icon className="mt-1 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// ---------------- Form controls ----------------

const controlBase =
  "w-full rounded-[12px] border border-border bg-surface px-3.5 py-2.5 text-[15px] leading-7 text-text placeholder:text-muted/70 transition-colors hover:border-[#cfcbbd] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-text">
        {label}
      </label>
      {children(id)}
      {hint && <p className="mt-1 text-[13px] text-muted">{hint}</p>}
    </div>
  );
}

export function Input({
  changed,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { changed?: boolean }) {
  return (
    <input
      dir="auto"
      {...rest}
      className={clsx(controlBase, changed && "border-warning/60 bg-modify/40", className)}
    />
  );
}

export function Textarea({
  changed,
  className,
  autoGrow,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { changed?: boolean; autoGrow?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!autoGrow || !ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${ref.current.scrollHeight + 2}px`;
  }, [autoGrow, rest.value]);
  const value = typeof rest.value === "string" ? rest.value : "";
  return (
    <textarea
      ref={ref}
      dir={value ? dirOf(value) : "auto"}
      {...rest}
      className={clsx(controlBase, "resize-y", changed && "border-warning/60 bg-modify/40", className)}
    />
  );
}

export function Select({ className, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...rest} className={clsx(controlBase, "appearance-none pe-10", className)} />
      <ChevronDown className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
    </div>
  );
}

// ---------------- Toasts ----------------

type ToastTone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const push = useCallback((message: string, tone: ToastTone = "success") => {
    const id = ++counter.current;
    setItems((cur) => [...cur, { id, message, tone }]);
    setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), tone === "error" ? 6000 : 3500);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "pointer-events-auto flex max-w-md items-center gap-2.5 rounded-[12px] border bg-surface px-4 py-3 text-[14.5px] shadow-[0_8px_30px_rgb(31_41_51/0.12)]",
              t.tone === "success" && "border-success/40",
              t.tone === "error" && "border-danger/40",
              t.tone === "info" && "border-border",
            )}
            role={t.tone === "error" ? "alert" : "status"}
          >
            {t.tone === "success" ? (
              <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
            ) : t.tone === "error" ? (
              <AlertTriangle className="size-4 shrink-0 text-danger" aria-hidden />
            ) : (
              <Info className="size-4 shrink-0 text-primary" aria-hidden />
            )}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------------- Confirm dialog ----------------

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-text/30 p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-[16px] border border-border bg-surface p-6 shadow-[0_20px_60px_rgb(31_41_51/0.2)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onCancel} className="rounded-lg p-1 text-muted hover:bg-surface-muted" aria-label="إغلاق">
            <X className="size-5" />
          </button>
        </div>
        <div className="mt-2 text-[15px] text-muted">{description}</div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            إلغاء
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
