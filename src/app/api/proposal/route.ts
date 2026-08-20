import { NextResponse } from "next/server";
import { ProposalEvent, ProposalStatus, RequestStatus, Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { CrossRefService } from "@/services/crossref.service";

const CORE_FIELDS = ["problemStatement", "researchObjectives", "methodologyOutline", "expectedContribution"] as const;

/**
 * Structured Thesis Proposal Builder: the signed-in student's proposal, its
 * CrossRef-resolved references, and its submission/feedback history.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  if (session.role !== Role.STUDENT) {
    return NextResponse.json({ error: "Only students can build a thesis proposal." }, { status: 403 });
  }

  const [proposal, acceptedSupervisor] = await Promise.all([
    prisma.thesisProposal.findUnique({
      where: { studentId: session.sub },
      include: {
        references: { orderBy: { createdAt: "asc" } },
        history: { orderBy: [{ version: "desc" }, { createdAt: "desc" }], include: { actor: { select: { name: true } } } },
      },
    }),
    prisma.matchRequest.findFirst({
      where: { studentId: session.sub, status: RequestStatus.ACCEPTED },
      include: { supervisor: { include: { user: { select: { name: true } } } } },
    }),
  ]);

  return NextResponse.json({
    proposal,
    hasSupervisor: Boolean(acceptedSupervisor),
    supervisorName: acceptedSupervisor?.supervisor.user.name ?? null,
  });
}

/** Save a draft, or submit for supervisor approval (which resolves every cited DOI against CrossRef first). */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  if (session.role !== Role.STUDENT) {
    return NextResponse.json({ error: "Only students can build a thesis proposal." }, { status: 403 });
  }

  const body = await req.json();
  const submit = body.submit === true;

  const fields: Record<string, string> = {};
  for (const key of CORE_FIELDS) {
    const value = typeof body[key] === "string" ? body[key].trim().slice(0, 4000) : "";
    fields[key] = value;
  }
  // title/abstract feed the University Thesis Repository (Module 3, Member 1)
  // once this proposal is approved — not part of CORE_FIELDS since they
  // predate this feature and are validated/capped separately here.
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 300) : "";
  const abstract = typeof body.abstract === "string" ? body.abstract.trim().slice(0, 4000) : "";

  const dois: string[] = Array.isArray(body.dois)
    ? [...new Set(body.dois.map((d: unknown) => (typeof d === "string" ? d.trim() : "")).filter(Boolean) as string[])]
    : [];

  const existing = await prisma.thesisProposal.findUnique({ where: { studentId: session.sub } });

  if (existing?.status === ProposalStatus.APPROVED) {
    return NextResponse.json(
      { error: "Your proposal has already been approved and can no longer be edited." },
      { status: 409 }
    );
  }

  if (submit) {
    if (CORE_FIELDS.some((key) => !fields[key]) || !title || !abstract) {
      return NextResponse.json(
        {
          error:
            "Title, abstract, problem statement, research objectives, methodology outline, and expected contribution are all required to submit.",
        },
        { status: 400 }
      );
    }
    const acceptedSupervisor = await prisma.matchRequest.findFirst({
      where: { studentId: session.sub, status: RequestStatus.ACCEPTED },
    });
    if (!acceptedSupervisor) {
      return NextResponse.json(
        { error: "Match with a supervisor before submitting your proposal for approval." },
        { status: 400 }
      );
    }
  }

  // Resolve every cited DOI against CrossRef before anything is written.
  const resolved = await CrossRefService.resolveMany(dois);

  if (submit && resolved.some((r) => !r.found)) {
    return NextResponse.json(
      { error: "Fix or remove the unresolved reference(s) before submitting." },
      { status: 400 }
    );
  }

  const nextVersion = submit && existing?.status === ProposalStatus.RETURNED ? existing.version + 1 : (existing?.version ?? 1);

  const proposal = await prisma.$transaction(async (tx) => {
    const saved = await tx.thesisProposal.upsert({
      where: { studentId: session.sub },
      update: {
        ...fields,
        title,
        abstract,
        status: submit ? ProposalStatus.SUBMITTED : (existing?.status ?? ProposalStatus.DRAFT),
        version: nextVersion,
        submittedAt: submit ? new Date() : existing?.submittedAt,
      },
      create: {
        studentId: session.sub,
        ...fields,
        title,
        abstract,
        status: submit ? ProposalStatus.SUBMITTED : ProposalStatus.DRAFT,
        version: 1,
        submittedAt: submit ? new Date() : null,
      },
    });

    await tx.proposalReference.deleteMany({ where: { proposalId: saved.id } });
    if (resolved.length > 0) {
      await tx.proposalReference.createMany({
        data: resolved.map((r) => ({
          proposalId: saved.id,
          doi: r.doi,
          resolvedTitle: r.title,
          resolvedVenue: r.venue,
          resolvedYear: r.year,
          status: r.found ? "VALIDATED" : "NOT_FOUND",
        })),
      });
    }

    if (submit) {
      await tx.proposalHistoryEntry.create({
        data: {
          proposalId: saved.id,
          version: nextVersion,
          event: ProposalEvent.SUBMITTED,
          actorId: session.sub,
        },
      });
    }

    return tx.thesisProposal.findUniqueOrThrow({
      where: { id: saved.id },
      include: {
        references: { orderBy: { createdAt: "asc" } },
        history: { orderBy: [{ version: "desc" }, { createdAt: "desc" }], include: { actor: { select: { name: true } } } },
      },
    });
  });

  return NextResponse.json({ proposal });
}
