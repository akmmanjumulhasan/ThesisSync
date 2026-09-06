"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AuthShell } from "@/components/auth/AuthShell";
import {
  MailIcon,
  LockIcon,
  EyeIcon,
  EyeOffIcon,
  ShieldCheckIcon,
  SpinnerIcon,
} from "@/components/ui/icons";

type Step = "request" | "reset";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to send the code.");
        return;
      }
      setNotice(data.message ?? "If an account exists for that email, we've sent a 6-digit code to it.");
      setStep("reset");
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to reset your password.");
        return;
      }
      router.push("/login");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Account recovery"
      title={step === "request" ? "Forgot your password?" : "Enter your code"}
      subtitle={
        step === "request"
          ? "We'll email a 6-digit code to reset it."
          : `Check ${email} for the code. It expires in 10 minutes.`
      }
      footer={
        <>
          Remembered it?{" "}
          <Link href="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {step === "request" ? (
        <form className="space-y-4" onSubmit={requestCode}>
          <Input
            label="University email"
            type="email"
            name="email"
            required
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@bracu.ac.bd"
            icon={<MailIcon />}
          />

          {error && (
            <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-foreground">{error}</p>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading && <SpinnerIcon />}
            {loading ? "Sending…" : "Send reset code"}
          </Button>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={resetPassword}>
          {notice && (
            <p className="rounded-lg bg-background px-3 py-2 text-sm text-muted">{notice}</p>
          )}

          <Input
            label="6-digit code"
            name="otp"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            icon={<ShieldCheckIcon />}
          />

          <Input
            label="New password"
            type={showPassword ? "text" : "password"}
            name="newPassword"
            required
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="••••••••"
            icon={<LockIcon />}
            rightSlot={
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="text-muted transition-colors hover:text-foreground"
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            }
          />

          <Input
            label="Confirm new password"
            type={showPassword ? "text" : "password"}
            name="confirmPassword"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            icon={<LockIcon />}
          />

          {error && (
            <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-foreground">{error}</p>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading && <SpinnerIcon />}
            {loading ? "Resetting…" : "Reset password"}
          </Button>

          <button
            type="button"
            onClick={() => {
              setStep("request");
              setOtp("");
              setError(null);
              setNotice(null);
            }}
            className="w-full text-center text-sm text-muted transition-colors hover:text-foreground"
          >
            Use a different email or resend the code
          </button>
        </form>
      )}
    </AuthShell>
  );
}
