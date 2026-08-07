"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { SpinnerIcon } from "@/components/ui/icons";

export function SupervisorProfileForm({
  initialInterests,
  initialCapacity,
  initialAvailable,
}: {
  initialInterests: string;
  initialCapacity: number;
  initialAvailable: boolean;
}) {
  const router = useRouter();
  const [interests, setInterests] = useState(initialInterests);
  const [capacity, setCapacity] = useState(initialCapacity);
  const [available, setAvailable] = useState(initialAvailable);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const inputClass =
    "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent";
  const labelClass = "mb-1.5 block text-sm font-medium text-foreground";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setLoading(true);
    try {
      const res = await fetch("/api/supervisor/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          researchInterests: interests,
          maxLoad: capacity,
          isAvailable: available,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to save changes.");
        return;
      }
      setSuccess(true);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className={labelClass}>Areas of expertise</label>
          <input
            value={interests}
            onChange={(e) => setInterests(e.target.value)}
            placeholder="NLP, Distributed Systems, HCI"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Current capacity</label>
          <input
            type="number"
            min={0}
            max={30}
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Status</label>
          <select
            value={available ? "open" : "closed"}
            onChange={(e) => setAvailable(e.target.value === "open")}
            className={inputClass}
          >
            <option value="open">Accepting new students</option>
            <option value="closed">Not accepting students</option>
          </select>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-foreground">{error}</p>
      )}
      {success && (
        <p className="mt-3 rounded-lg bg-success-bg px-3 py-2 text-sm text-success-foreground">
          Saved.
        </p>
      )}

      <Button type="submit" disabled={loading} className="mt-4">
        {loading && <SpinnerIcon />}
        {loading ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
