import "dotenv/config";
import { PrismaClient, Role, TaskStatus, RepoAccessRole } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL as string });
const prisma = new PrismaClient({ adapter });

const DEMO_PASSWORD = "Passw0rd!123";

// Kept as a literal rather than imported from src/services: that module is
// "server-only" and would fail to load under tsx. Mirrors GIT_ANALYTICS_REPO.
const TRACKED_REPO = process.env.GIT_ANALYTICS_REPO ?? "akmmanjumulhasan/ThesisSync";

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // Reset in FK-safe order.
  await prisma.chapterAuditEntry.deleteMany({});
  await prisma.thesisChapter.deleteMany({});
  await prisma.gitEvent.deleteMany({});
  await prisma.kanbanTask.deleteMany({});
  await prisma.repositoryAccess.deleteMany({});
  await prisma.similarityMatch.deleteMany({});
  await prisma.noveltyCheck.deleteMany({});
  await prisma.archivedThesis.deleteMany({});
  await prisma.defenseInteraction.deleteMany({});
  await prisma.mockDefenseSession.deleteMany({});
  await prisma.thesisProposal.deleteMany({});
  await prisma.teamInvite.deleteMany({});
  await prisma.matchRequest.deleteMany({});
  await prisma.developerProfile.deleteMany({});
  await prisma.studentProfile.deleteMany({});
  await prisma.supervisorProfile.deleteMany({});
  await prisma.user.deleteMany({});

  // ---- The logged-in demo student (Member 2) --------------------------------
  const you = await prisma.user.create({
    data: {
      name: "A.K.M Manjumul Hasan Maksud",
      email: "akmmanjumulhasanmaksud@gmail.com",
      studentId: "23101266",
      department: "Computer Science and Engineering",
      role: Role.STUDENT,
      passwordHash,
      studentProfile: {
        create: {
          researchKeywords: ["citation graphs", "low-resource NLP", "gap detection"],
          declaredSkills: ["Python", "PyTorch", "Data pipelines"],
          openToTeam: true,
        },
      },
    },
  });

  // ---- Rest of the group, as plain student accounts --------------------------
  await prisma.user.create({
    data: {
      name: "Dabobbroto Chakroborty",
      email: "dabobbroto.chakroborty@g.bracu.ac.bd",
      studentId: "23101022",
      department: "Computer Science and Engineering",
      role: Role.STUDENT,
      passwordHash,
      studentProfile: { create: { researchKeywords: [], declaredSkills: [] } },
    },
  });

  await prisma.user.create({
    data: {
      name: "Sabrina Afrin",
      email: "sabrina.afrin@g.bracu.ac.bd",
      studentId: "23101028",
      department: "Computer Science and Engineering",
      role: Role.STUDENT,
      passwordHash,
      studentProfile: { create: { researchKeywords: [], declaredSkills: [] } },
    },
  });

  // ---- Supervisors for Supervisor-mode matching ------------------------------
  const supervisorSeeds: {
    name: string;
    email: string;
    researchInterests: string[];
    maxLoad: number;
    activeLoad: number;
    avgResponseDays: number;
    isAvailable?: boolean;
  }[] = [
    {
      name: "Dr. Farhana Islam",
      email: "farhana.islam@bracu.ac.bd",
      researchInterests: ["NLP", "Distributed Systems", "HCI"],
      maxLoad: 8,
      activeLoad: 6,
      avgResponseDays: 1.2,
    },
    {
      name: "Dr. Kamal Hossain",
      email: "kamal.hossain@bracu.ac.bd",
      researchInterests: ["Graph ML", "Information Retrieval"],
      maxLoad: 6,
      activeLoad: 3,
      avgResponseDays: 2,
    },
    {
      name: "Dr. Nabila Karim",
      email: "nabila.karim@bracu.ac.bd",
      researchInterests: ["Citation Analysis", "Bibliometrics", "Graph Databases"],
      maxLoad: 7,
      activeLoad: 7, // at capacity
      avgResponseDays: 4,
    },
    {
      name: "Dr. Imran Chowdhury",
      email: "imran.chowdhury@bracu.ac.bd",
      researchInterests: ["Computer Vision", "Robotics", "Embedded Systems"],
      maxLoad: 5,
      activeLoad: 2,
      avgResponseDays: 3,
    },
    {
      name: "Dr. Shirin Akhter",
      email: "shirin.akhter@bracu.ac.bd",
      researchInterests: ["Cybersecurity", "Network Security", "Cryptography"],
      maxLoad: 6,
      activeLoad: 1,
      avgResponseDays: 2.5,
    },
    {
      name: "Dr. Tanzim Rahman",
      email: "tanzim.rahman@bracu.ac.bd",
      researchInterests: ["Machine Learning Systems", "MLOps", "Distributed Computing"],
      maxLoad: 5,
      activeLoad: 5, // at capacity
      avgResponseDays: 1.5,
    },
    {
      name: "Dr. Ayesha Siddiqua",
      email: "ayesha.siddiqua@bracu.ac.bd",
      researchInterests: ["Database Systems", "Data Engineering", "Cloud Computing"],
      maxLoad: 8,
      activeLoad: 4,
      avgResponseDays: 3.5,
    },
    {
      name: "Dr. Rezaul Karim",
      email: "rezaul.karim@bracu.ac.bd",
      researchInterests: ["Human-Computer Interaction", "UX Research", "Accessibility"],
      maxLoad: 6,
      activeLoad: 0,
      avgResponseDays: 1,
    },
    {
      name: "Dr. Nasrin Jahan",
      email: "nasrin.jahan@bracu.ac.bd",
      researchInterests: ["Bioinformatics", "Computational Biology", "Genomics"],
      maxLoad: 4,
      activeLoad: 2,
      avgResponseDays: 4.5,
      isAvailable: false, // not accepting students this semester
    },
  ];

  for (const s of supervisorSeeds) {
    await prisma.user.create({
      data: {
        name: s.name,
        email: s.email,
        department: "Computer Science and Engineering",
        role: Role.SUPERVISOR,
        passwordHash,
        supervisorProfile: {
          create: {
            researchInterests: s.researchInterests,
            maxLoad: s.maxLoad,
            activeLoad: s.activeLoad,
            avgResponseDays: s.avgResponseDays,
            isAvailable: s.isAvailable ?? true,
          },
        },
      },
    });
  }

  // ---- GitHub-verified students for Teammate-mode matching -------------------
  const teammateSeeds = [
    {
      name: "Rasel Ahmed",
      email: "rasel.ahmed@g.bracu.ac.bd",
      studentId: "23101101",
      githubUsername: "rasel-ahmed-dev",
      topLanguages: ["Python", "TypeScript"],
      totalCommits: 340,
      topRepositories: ["nlp-team-finder", "citation-graph-toolkit"],
      declaredSkills: ["Python", "TypeScript", "NLP"],
      teamPost: "Looking for NLP team",
    },
    {
      name: "Nusrat Jahan",
      email: "nusrat.jahan@g.bracu.ac.bd",
      studentId: "23101142",
      githubUsername: "nusrat-j",
      topLanguages: ["JavaScript", "Python"],
      totalCommits: 210,
      topRepositories: ["data-viz-dashboard"],
      declaredSkills: ["JavaScript", "Python", "Data Visualization"],
      teamPost: null as string | null,
    },
    {
      name: "Tanvir Rahman",
      email: "tanvir.rahman@g.bracu.ac.bd",
      studentId: "23101177",
      githubUsername: "tanvir-r",
      topLanguages: ["C++", "Python"],
      totalCommits: 95,
      topRepositories: ["robotics-sim"],
      declaredSkills: ["C++", "Python", "Robotics"],
      teamPost: null as string | null,
    },
  ];

  for (const t of teammateSeeds) {
    await prisma.user.create({
      data: {
        name: t.name,
        email: t.email,
        studentId: t.studentId,
        department: "Computer Science and Engineering",
        role: Role.STUDENT,
        passwordHash,
        studentProfile: {
          create: {
            researchKeywords: [],
            declaredSkills: t.declaredSkills,
            openToTeam: true,
            teamPost: t.teamPost,
          },
        },
        developerProfile: {
          create: {
            githubUsername: t.githubUsername,
            isVerified: true,
            topLanguages: t.topLanguages,
            totalCommits: t.totalCommits,
            topRepositories: t.topRepositories,
          },
        },
      },
    });
  }

  // ---- Module 2 (Member 2): Git-to-Task kanban board -----------------------
  // Starting cards only. Their columns are meant to move from real commits —
  // a message like "fixes TS-11" is what drives them — so nothing here is
  // pre-marked done by hand.
  const boardTasks: { key: string; title: string; status: TaskStatus }[] = [
    { key: "TS-05", title: "Data collection pipeline", status: TaskStatus.DONE },
    { key: "TS-07", title: "Baseline TF-IDF model", status: TaskStatus.DONE },
    { key: "TS-09", title: "Evaluation script (confusion matrix)", status: TaskStatus.IN_REVIEW },
    { key: "TS-11", title: "Build citation-graph embedding model", status: TaskStatus.IN_PROGRESS },
    { key: "TS-14", title: "Write related-work section", status: TaskStatus.BACKLOG },
    { key: "TS-15", title: "Draft ethics statement", status: TaskStatus.BACKLOG },
  ];

  for (const task of boardTasks) {
    await prisma.kanbanTask.create({
      data: { ...task, repo: TRACKED_REPO, assigneeId: you.id },
    });
  }

  // Demo access to the board above. In the running app this row is only ever
  // created by POST /api/git/repos, which checks against GitHub that the user
  // owns, collaborates on, or has contributed to the repository — seeding it
  // directly just saves the demo account that round trip.
  await prisma.repositoryAccess.create({
    data: {
      userId: you.id,
      fullName: TRACKED_REPO,
      role: RepoAccessRole.OWNER,
      githubLogin: TRACKED_REPO.split("/")[0],
    },
  });

  // ---- Module 2 (Member 3): the novelty checker's archive ------------------
  // Deliberately left empty. Inventing thesis titles here would make the
  // similarity checker report confident percentages against work that does not
  // exist, which is worse than reporting nothing. The archive is populated from
  // real records instead — POST /api/novelty/archive imports actual
  // dissertations from OpenAlex with their DOIs — and will hold the
  // university's own deposited theses once Module 3 (Member 1) ships the
  // repository.

  console.log("=".repeat(70));
  console.log("Seed complete.");
  console.log(`Demo login for everyone: password = "${DEMO_PASSWORD}"`);
  console.log(`Your account: ${you.email}`);
  console.log("=".repeat(70));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
