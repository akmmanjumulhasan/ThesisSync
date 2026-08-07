import Link from "next/link";
import { ReactNode } from "react";
import { CheckIcon } from "@/components/ui/icons";

const FEATURES = [
  "Map the research landscape & check topic novelty",
  "GitHub-verified matching with supervisors & teammates",
  "Structured proposals with DOI-verified references",
  "Rehearse your viva with an AI mock examiner",
];

export function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-background">
      {/* Brand panel: hidden on small screens */}
      <div className="relative hidden w-[42%] shrink-0 flex-col justify-between overflow-hidden bg-brand px-10 py-12 text-brand-foreground md:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.9) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-28 -top-28 h-80 w-80 rounded-full bg-accent opacity-30 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-28 -left-20 h-80 w-80 rounded-full bg-white opacity-[0.08] blur-3xl"
        />

        <Link href="/" className="relative z-10 flex w-fit items-center gap-2 text-lg font-bold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-sm font-bold">
            TS
          </span>
          ThesisSync
        </Link>

        <div className="relative z-10">
          <p className="text-sm font-semibold uppercase tracking-wide text-white/60">CSE471 · Group 10</p>
          <h2 className="mt-3 text-3xl font-bold leading-tight">
            From an open question
            <br />
            to a defended thesis.
          </h2>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/70">
            One platform that carries a thesis all the way from an unformed idea to a passed
            defense, pairing students with supervisors and teammates, screening for novelty,
            and guiding every proposal, draft, and review in between.
          </p>

          <ul className="mt-8 space-y-3">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-sm text-white/85">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent">
                  <CheckIcon className="h-3 w-3 text-white" />
                </span>
                {f}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-xs text-white/40">© {new Date().getFullYear()} ThesisSync</p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <Link
            href="/"
            className="mb-8 flex w-fit items-center gap-2 text-sm font-bold text-brand md:hidden"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-xs font-bold text-brand-foreground">
              TS
            </span>
            ThesisSync
          </Link>

          <p className="text-sm font-semibold uppercase tracking-wide text-accent">{eyebrow}</p>
          <h1 className="mt-1.5 text-2xl font-bold text-foreground">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}

          <div className="mt-7">{children}</div>

          <div className="mt-6 text-center text-sm text-muted">{footer}</div>
        </div>
      </div>
    </div>
  );
}
