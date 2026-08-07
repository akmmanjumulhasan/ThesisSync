"use client";

import { useState, FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { LockIcon, EyeIcon, EyeOffIcon, SpinnerIcon } from "@/components/ui/icons";

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to change password.");
        return;
      }
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-4">
      <Input
        label="Current password"
        name="currentPassword"
        type={showCurrent ? "text" : "password"}
        autoComplete="current-password"
        required
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        placeholder="••••••••"
        icon={<LockIcon />}
        rightSlot={
          <button
            type="button"
            onClick={() => setShowCurrent((s) => !s)}
            tabIndex={-1}
            className="text-muted transition-colors hover:text-foreground"
            aria-label={showCurrent ? "Hide password" : "Show password"}
          >
            {showCurrent ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="New password"
          name="newPassword"
          type={showNew ? "text" : "password"}
          autoComplete="new-password"
          required
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="••••••••"
          icon={<LockIcon />}
          rightSlot={
            <button
              type="button"
              onClick={() => setShowNew((s) => !s)}
              tabIndex={-1}
              className="text-muted transition-colors hover:text-foreground"
              aria-label={showNew ? "Hide password" : "Show password"}
            >
              {showNew ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          }
        />
        <Input
          label="Confirm new password"
          name="confirmPassword"
          type={showNew ? "text" : "password"}
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="••••••••"
          icon={<LockIcon />}
        />
      </div>

      {error && <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-foreground">{error}</p>}
      {success && (
        <p className="rounded-lg bg-success-bg px-3 py-2 text-sm text-success-foreground">
          Password updated.
        </p>
      )}

      <Button type="submit" disabled={loading}>
        {loading && <SpinnerIcon />}
        {loading ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
