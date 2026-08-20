import type { ComponentType } from "react";
import {
  CompassIcon,
  UsersIcon,
  DocumentIcon,
  ChartIcon,
  GitBranchIcon,
  ShieldCheckIcon,
  HistoryIcon,
  ArchiveIcon,
  ChatIcon,
  LayersIcon,
  SlidersIcon,
  BellIcon,
} from "@/components/ui/icons";

export type RoadmapStatus = "live" | "planned";

export interface RoadmapItem {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  status: RoadmapStatus;
  owner: string;
  /** Where a "live" item actually lives. Required once status is "live". */
  liveHref?: string;
}

export interface RoadmapModule {
  name: string;
  focus: string;
  /** Workflow-stage label used for the sidebar's grouped nav (mirrors the module 1:1). */
  stage: string;
  items: RoadmapItem[];
}

export interface NumberedNavItem extends RoadmapItem {
  number: number;
  href: string;
}

export interface NavStageGroup {
  stage: string;
  items: NumberedNavItem[];
}

/** Every roadmap item, grouped by workflow stage and numbered continuously. Feeds the sidebar nav. */
export function stageGroups(): NavStageGroup[] {
  let n = 0;
  return ROADMAP.map((mod) => ({
    stage: mod.stage,
    items: mod.items.map((item) => {
      n += 1;
      return { ...item, number: n, href: roadmapHref(item) };
    }),
  }));
}

/** URL-safe id for a roadmap item, used to link to it (built or not). */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Every roadmap card is clickable: live items go straight to the feature, planned ones go to a status page. */
export function roadmapHref(item: RoadmapItem): string {
  if (item.status === "live" && item.liveHref) return item.liveHref;
  return `/dashboard/coming-soon/${slugify(item.title)}`;
}

/** Flat list of every item, each tagged with its parent module. Used by the coming-soon lookup and by counts. */
export function allRoadmapItems(): (RoadmapItem & { moduleName: string })[] {
  return ROADMAP.flatMap((mod) => mod.items.map((item) => ({ ...item, moduleName: mod.name })));
}

/** The full project plan from the CSE471 functional-requirements doc: what's live today, and what's next. */
export const ROADMAP: RoadmapModule[] = [
  {
    name: "Module 1",
    focus: "Discover a topic & find your people",
    stage: "Discover & Match",
    items: [
      {
        title: "Research Landscape & Trend Analyzer",
        description:
          "Maps what's already published on a topic and highlights where a novel contribution still fits.",
        icon: CompassIcon,
        status: "live",
        owner: "Member 1 · You",
        liveHref: "/dashboard/research",
      },
      {
        title: "Unified Matchmaking Engine",
        description:
          "GitHub-verified matching with supervisors and teammates, ranked by fit and availability.",
        icon: UsersIcon,
        status: "live",
        owner: "Member 2 · You",
        liveHref: "/dashboard/matchmaking",
      },
      {
        title: "Structured Thesis Proposal Builder",
        description:
          "A guided proposal form with CrossRef-validated citations, gating chapter work until it's approved.",
        icon: DocumentIcon,
        status: "live",
        owner: "Member 3",
        liveHref: "/dashboard/proposal",
      },
    ],
  },
  {
    name: "Module 2",
    focus: "Prove the work & track progress",
    stage: "Build & Validate",
    items: [
      {
        title: "Automated Evaluation & LaTeX Charts",
        description: "Turns a results CSV into publication-ready charts and formal evaluation notation.",
        icon: ChartIcon,
        status: "live",
        owner: "Member 1 · You",
        liveHref: "/dashboard/evaluation",
      },
      {
        title: "Git-to-Task Contribution Analytics",
        description: "A kanban board that updates itself from GitHub commits and pull requests.",
        icon: GitBranchIcon,
        status: "live",
        owner: "Member 2 · You",
        liveHref: "/dashboard/contribution",
      },
      {
        title: "Topic Novelty & Similarity Checker",
        description: "Screens proposals and drafts against the repository so duplication surfaces early.",
        icon: ShieldCheckIcon,
        status: "live",
        owner: "Member 3",
        liveHref: "/dashboard/novelty",
      },
    ],
  },
  {
    name: "Module 3",
    focus: "Write, review & defend",
    stage: "Write & Defend",
    items: [
      {
        title: "Version Control & Inline Annotation",
        description: "Timestamped draft versions with side-by-side diffs and inline supervisor comments.",
        icon: HistoryIcon,
        status: "planned",
        owner: "Member 1",
      },
      {
        title: "University Thesis Repository",
        description: "A searchable archive of completed theses by keyword, department, year, and supervisor.",
        icon: ArchiveIcon,
        status: "planned",
        owner: "Member 1",
      },
      {
        title: "AI Mock Defense Simulator",
        description: "Practice your viva against an AI examiner that asks challenging, context-aware questions.",
        icon: ChatIcon,
        status: "live",
        owner: "Member 2 · You",
        liveHref: "/dashboard/defense",
      },
      {
        title: "IEEE Conference Paper Transpiler",
        description: "Renders an approved thesis straight into a print-ready, two-column IEEE paper.",
        icon: LayersIcon,
        status: "live",
        owner: "Member 2 · You",
        liveHref: "/dashboard/paper",
      },
      {
        title: "Chapter Approval Workflow",
        description: "Draft → Submitted → In Review → Approved → Locked, with a full audit trail at each stage.",
        icon: SlidersIcon,
        status: "planned",
        owner: "Member 3",
      },
      {
        title: "Smart Notification System",
        description: "Email and SMS alerts for approvals, feedback, and approaching deadlines.",
        icon: BellIcon,
        status: "planned",
        owner: "Member 3",
      },
    ],
  },
];
