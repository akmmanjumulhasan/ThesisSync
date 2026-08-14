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

  // ---- Module 2 (Member 3): the archive the novelty checker scores against --
  // Stands in for the University Thesis Repository (Module 3, Member 1) until
  // that feature is built. Deliberately clustered around citation graphs, NLP,
  // and topic modelling so the similarity engine has genuinely near-neighbour
  // work to find rather than a set of unrelated titles that all score zero.
  const archive: {
    title: string;
    abstract: string;
    department: string;
    year: number;
    supervisor: string;
    keywords: string[];
  }[] = [
    {
      title: "Graph-Based Topic Modeling for Academic Search",
      abstract:
        "This thesis builds a graph-based topic model over academic search logs, combining citation structure with keyword co-occurrence to surface latent research themes. Topics are extracted from a citation network and ranked by centrality, improving retrieval over keyword-only baselines.",
      department: "CSE",
      year: 2024,
      supervisor: "Dr. Farhana Islam",
      keywords: ["topic modeling", "citation graph", "academic search", "information retrieval"],
    },
    {
      title: "Bangla NLP Resource Survey",
      abstract:
        "A survey of available Bangla language resources for natural language processing, covering annotated corpora, embeddings, and benchmark tasks. The work catalogues gaps in low-resource Bangla tooling and proposes priorities for future dataset construction.",
      department: "CSE",
      year: 2023,
      supervisor: "Dr. Kamal Hossain",
      keywords: ["bangla", "low-resource", "nlp", "corpus"],
    },
    {
      title: "Citation Networks in Scientometrics",
      abstract:
        "An analysis of citation network structure across scientometric datasets, measuring how community detection over citation graphs predicts emerging research fronts. Network embeddings are evaluated against bibliometric baselines.",
      department: "CSE",
      year: 2022,
      supervisor: "Dr. Nabila Karim",
      keywords: ["citation network", "scientometrics", "community detection", "embeddings"],
    },
    {
      title: "Keyword Overlap Methods for Research Gap Detection",
      abstract:
        "This work detects research gaps by measuring keyword overlap between published abstracts within a field. Terms that appear rarely relative to their neighbours are proposed as candidate gaps, with a manual validation study over three CSE subfields.",
      department: "CSE",
      year: 2023,
      supervisor: "Dr. Farhana Islam",
      keywords: ["gap detection", "keyword overlap", "abstracts", "bibliometrics"],
    },
    {
      title: "Transformer Embeddings for Cross-Lingual Document Retrieval",
      abstract:
        "Multilingual transformer embeddings are fine-tuned for cross-lingual document retrieval between English and Bangla, with contrastive training over parallel abstracts. Retrieval quality is measured on a constructed low-resource benchmark.",
      department: "CSE",
      year: 2024,
      supervisor: "Dr. Imran Chowdhury",
      keywords: ["transformers", "embeddings", "cross-lingual", "retrieval"],
    },
    {
      title: "Plagiarism Detection Using Cosine Similarity on Student Submissions",
      abstract:
        "A duplication detection pipeline for student coursework using tf-idf vectors and cosine similarity, with thresholds calibrated against manually labelled cases. The system reports matched passages and their contributing terms to a reviewing instructor.",
      department: "CSE",
      year: 2022,
      supervisor: "Dr. Shirin Akhter",
      keywords: ["plagiarism", "cosine similarity", "tf-idf", "academic integrity"],
    },
    {
      title: "Supervisor Allocation Under Capacity Constraints",
      abstract:
        "An optimisation approach to allocating thesis supervisors to students under expertise and capacity constraints, formulated as a bipartite matching problem and evaluated on three years of departmental allocation records.",
      department: "CSE",
      year: 2023,
      supervisor: "Dr. Tanzim Rahman",
      keywords: ["matching", "optimisation", "allocation", "scheduling"],
    },
    {
      title: "Sentiment Analysis of Code-Mixed Bangla-English Social Text",
      abstract:
        "Sentiment classification over code-mixed Bangla-English social media text, comparing character-level models against multilingual transformers on a newly annotated dataset of user comments.",
      department: "CSE",
      year: 2024,
      supervisor: "Dr. Kamal Hossain",
      keywords: ["sentiment", "code-mixing", "bangla", "social media"],
    },
    {
      title: "Knowledge Graph Construction from Scholarly Abstracts",
      abstract:
        "Entity and relation extraction over scholarly abstracts to construct a domain knowledge graph, with downstream evaluation on link prediction and expert finding tasks.",
      department: "CSE",
      year: 2022,
      supervisor: "Dr. Nabila Karim",
      keywords: ["knowledge graph", "relation extraction", "scholarly text"],
    },
    {
      title: "Automated Question Generation for Viva Preparation",
      abstract:
        "A sequence-to-sequence model generates examiner-style questions from thesis text, evaluated on relevance and difficulty by a panel of faculty reviewers.",
      department: "CSE",
      year: 2024,
      supervisor: "Dr. Ayesha Siddiqua",
      keywords: ["question generation", "education", "sequence to sequence"],
    },
    {
      title: "Energy-Aware Scheduling in Edge Computing Clusters",
      abstract:
        "A scheduling policy for edge computing clusters that trades latency against energy draw, validated in simulation across bursty workload traces.",
      department: "EEE",
      year: 2023,
      supervisor: "Dr. Rezaul Karim",
      keywords: ["edge computing", "scheduling", "energy efficiency"],
    },
    {
      title: "Water Quality Prediction Using Ensemble Regression",
      abstract:
        "Ensemble regression models predict river water quality indices from sensor readings, with feature importance analysis identifying the dominant seasonal drivers.",
      department: "CEE",
      year: 2022,
      supervisor: "Dr. Nasrin Jahan",
      keywords: ["water quality", "regression", "ensemble", "sensors"],
    },
  ];

  for (const thesis of archive) {
    await prisma.archivedThesis.create({ data: thesis });
  }

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
