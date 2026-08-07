import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Badge } from "@/components/ui/Badge";
import { allRoadmapItems, slugify } from "@/lib/roadmap";

export default async function ComingSoonPage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { slug } = await params;
  const item = allRoadmapItems().find((i) => slugify(i.title) === slug);
  if (!item) notFound();

  const Icon = item.icon;

  return (
    <div className="mx-auto max-w-lg py-10 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-surface text-muted ring-1 ring-border">
        <Icon className="h-6 w-6" />
      </div>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">
        {item.moduleName} · {item.owner}
      </p>
      <h1 className="mt-1 text-xl font-bold text-foreground">{item.title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">{item.description}</p>

      <div className="mt-4 flex justify-center">
        <Badge tone="neutral">Planned, not built yet</Badge>
      </div>

      <Link
        href="/dashboard"
        className="mt-8 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-background"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
