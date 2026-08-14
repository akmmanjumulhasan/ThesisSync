"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { UserIcon, SpinnerIcon } from "@/components/ui/icons";

export function UpdateNameForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const trimmed = name.trim();
  const unchanged = trimmed === savedName;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (trimmed.length < 2) {
      setError("Name must be at least 2 characters.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to update your name.");
        return;
      }

      setName(data.name);
      setSavedName(data.name);
      setSuccess(true);
      // The name lives in the session cookie, which server components read at
      // render time — refresh so the sidebar, headers, and avatar pick it up
      // straight away rather than on the next hard navigation.
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-4">
      <Input
        label="Full name"
        name="name"
        type="text"
        autoComplete="name"
        required
        maxLength={100}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setSuccess(false);
        }}
        placeholder="Your full name"
        icon={<UserIcon />}
      />

      {error && <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-foreground">{error}</p>}
      {success && (
        <p className="rounded-lg bg-success-bg px-3 py-2 text-sm text-success-foreground">
          Name updated to &quot;{savedName}&quot;.
        </p>
      )}

      <Button type="submit" disabled={loading || unchanged || trimmed.length < 2}>
        {loading && <SpinnerIcon />}
        {loading ? "Saving…" : "Update name"}
      </Button>
    </form>
  );
}
