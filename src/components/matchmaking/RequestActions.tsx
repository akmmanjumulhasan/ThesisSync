"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

type Status = "PENDING" | "ACCEPTED" | "DECLINED";

export function RequestActions({ requestId, status }: { requestId: string; status: Status }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function respond(action: "ACCEPT" | "DECLINE") {
    setLoading(true);
    try {
      await fetch("/api/match/request", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action }),
      });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  if (status === "ACCEPTED") return <Badge tone="success">Accepted</Badge>;
  if (status === "DECLINED") return <Badge tone="danger">Declined</Badge>;

  return (
    <div className="flex gap-2">
      <Button variant="outline" disabled={loading} onClick={() => respond("DECLINE")}>
        Decline
      </Button>
      <Button disabled={loading} onClick={() => respond("ACCEPT")}>
        Accept
      </Button>
    </div>
  );
}
