/**
 * The 7-stage thesis journey from the functional-requirements plan. Only Discover and
 * Match are backed by real, shipped features today (research keywords/skills, and the
 * Unified Matchmaking Engine). Everything from Propose onward is planned, so a student
 * or their supervisor can advance no further than "Propose" until those ship.
 */
export const JOURNEY_STEPS = ["Discover", "Match", "Propose", "Write", "Review", "Defend", "Archive"] as const;
