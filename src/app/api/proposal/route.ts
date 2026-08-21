import { NextResponse } from "next/server";
import { ProposalEvent, ProposalStatus, RequestStatus, Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { CrossRefService } from "@/services/crossref.service";

const CORE_FIELDS = ["problemStatement", "researchObjectives", "methodologyOutline", "expectedContribution"] as const;

/**
 * The thesis title and abstract.
 *
 * Held apart from CORE_FIELDS because they are shorter and differently capped,
 * but they are required to submit just the same: a proposal without a title is
 * not a proposal, and both are what downstream modules identify the work by —
 * the IEEE Paper Transpiler loads them as the paper's identity, and the Mock
 * Defense Simulator uses them as the examiner's context. Until this form
 * collected them, both read empty columns.
 */
const TITLE_MAX = 300;
const ABSTRACT_MAX = 4000;

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
  fields.title = typeof body.title === "string" ? body.title.trim().slice(0, TITLE_MAX) : "";
  fields.abstract = typeof body.abstract === "string" ? body.abstract.trim().slice(0, ABSTRACT_MAX) : "";

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
    if (!fields.title || !fields.abstract) {
      return NextResponse.json(
        { error: "A thesis title and abstract are required to submit." },
        { status: 400 }
      );
    }
    if (CORE_FIELDS.some((key) => !fields[key])) {
      return NextResponse.json(
        { error: "Problem statement, research objectives, methodology outline, and expected contribution are all required to submit." },
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
        status: submit ? ProposalStatus.SUBMITTED : (existing?.status ?? ProposalStatus.DRAFT),
        version: nextVersion,
        submittedAt: submit ? new Date() : existing?.submittedAt,
      },
      create: {
        studentId: session.sub,
        ...fields,
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
