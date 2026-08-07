"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

export function GithubVerifyForm({
  initialUsername,
  isVerified,
  topLanguages,
  totalCommits,
}: {
  initialUsername: string;
  isVerified: boolean;
  topLanguages: string[];
  totalCommits: number;
}) {
  const router = useRouter();
  const [username, setUsername] = useState(initialUsername);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onVerify() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/github/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ githubUsername: username }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Verification failed.");
        return;
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex gap-2">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="your-github-username"
          className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
        />
        <Button onClick={onVerify} disabled={loading || !username.trim()}>
          {loading ? "Verifying…" : "Verify"}
        </Button>
      </div>

      {error && <p className="text-sm text-danger-foreground">{error}</p>}

      {isVerified && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Badge tone="success">GitHub verified</Badge>
          <span>
            Top languages: {topLanguages.join(", ") || "N/A"} · {totalCommits} commits
          </span>
        </div>
      )}
    </div>
  );
}
