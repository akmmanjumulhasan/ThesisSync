import { ReactNode } from "react";

type Tone = "success" | "danger" | "neutral" | "brand" | "warning";

const tones: Record<Tone, string> = {
  success: "bg-success-bg text-success-foreground",
  danger: "bg-danger-bg text-danger-foreground",
  neutral: "border border-border bg-surface text-muted",
  brand: "bg-brand text-brand-foreground",
  warning: "bg-warning-bg text-warning-foreground",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}
