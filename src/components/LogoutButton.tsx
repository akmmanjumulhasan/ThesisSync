"use client";

import { useRouter } from "next/navigation";

export function LogoutButton({ className = "text-sm text-muted hover:text-foreground" }: { className?: string }) {
  const router = useRouter();

  async function onLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button onClick={onLogout} className={className}>
      Log out
    </button>
  );
}
