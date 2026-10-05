import { Cadre } from '@prisma/client';
import type { CriteriaActuals } from './trackingEngine';

// W3 cadre derivation + cadre-target eligibility check (pure).

export const CADRE_LABEL: Record<Cadre, string> = {
  ASSISTANT_PROFESSOR: 'Assistant Professor',
  SR_ASSISTANT_PROFESSOR: 'Sr. Assistant Professor',
  ASSOCIATE_PROFESSOR: 'Associate Professor',
  PROFESSOR: 'Professor',
};

// Years of experience from date of joining to a reference date (default now).
export function computeExperienceYears(dateOfJoining: Date | string | null | undefined, ref: Date = new Date()): number {
  if (!dateOfJoining) return 0;
  const doj = new Date(dateOfJoining);
  if (Number.isNaN(doj.getTime())) return 0;
  const ms = ref.getTime() - doj.getTime();
  return Math.max(0, ms / (365.25 * 24 * 60 * 60 * 1000));
}

// Map a free-text designation to a cadre band. Order matters (senior-assistant
// before assistant, associate before professor).
export function deriveCadre(designation: string | null | undefined): Cadre | null {
  const d = (designation ?? '').toLowerCase();
  if (!d) return null;
  const isAssistant = d.includes('assistant') || d.includes('asst');
  if (isAssistant && (d.includes('sr') || d.includes('senior'))) return Cadre.SR_ASSISTANT_PROFESSOR;
  if (isAssistant) return Cadre.ASSISTANT_PROFESSOR;
  if (d.includes('associate')) return Cadre.ASSOCIATE_PROFESSOR;
  if (d.includes('professor') || d.includes('prof')) return Cadre.PROFESSOR;
  return null;
}

export interface CadreTargetRow {
  cadre: Cadre;
  minExpYears: number;
  maxExpYears: number | null;
  totalScoreTarget: number;
  feedbackTarget: number;
  indexedCount: number;
  minJournal: number;
  quartileSet: string | null;
  ppcRule: 'DESIRABLE' | 'MANDATORY';
  ppcCount: number;
}

// Pick the target row matching a cadre + experience band. Assistant Professor
// has two bands (< 3 yr / >= 3 yr); other cadres a single band.
export function pickCadreTarget<T extends CadreTargetRow>(
  targets: T[],
  cadre: Cadre,
  expYears: number
): T | null {
  const candidates = targets.filter(
    (t) => t.cadre === cadre && expYears >= t.minExpYears && (t.maxExpYears == null || expYears < t.maxExpYears)
  );
  if (candidates.length === 0) return null;
  // Prefer the tightest (highest minExpYears) matching band.
  return candidates.sort((a, b) => b.minExpYears - a.minExpYears)[0];
}

export interface RequirementCheck {
  key: string;
  label: string;
  target: string;
  actual: string;
  met: boolean;
  gating: boolean; // false = informational (never blocks eligibility)
}

export interface EligibilityResult {
  target: CadreTargetRow | null;
  requirements: RequirementCheck[];
  eligible: boolean;
}

// Number of PPC categories (patents / projects / consultancy) with any entry.
function ppcAchieved(a: CriteriaActuals): number {
  return [a.patentCount > 0, a.projectCount > 0, a.consultancyCount > 0].filter(Boolean).length;
}

export function checkEligibility(actuals: CriteriaActuals, target: CadreTargetRow | null): EligibilityResult {
  if (!target) return { target: null, requirements: [], eligible: false };

  const reqs: RequirementCheck[] = [
    {
      key: 'totalScore', label: 'Total score', target: `>= ${target.totalScoreTarget}`,
      actual: String(actuals.totalScore), met: actuals.totalScore >= target.totalScoreTarget, gating: true,
    },
    {
      key: 'feedback', label: 'Feedback', target: `>= ${target.feedbackTarget}`,
      actual: String(actuals.feedback), met: actuals.feedback >= target.feedbackTarget, gating: true,
    },
    // Indexed publications is the umbrella requirement. A minimum journal count,
    // when the cadre sets one, is a condition *within* it — "N indexed, of which
    // M a journal" — not a separate target. minJournal = 0 => no journal clause
    // is shown at all (the cadre only asks for indexed publications).
    {
      key: 'indexed',
      label: 'Indexed publications (WOS+Scopus)',
      target: `>= ${target.indexedCount}${target.minJournal > 0 ? `, incl. ${target.minJournal} journal${target.minJournal > 1 ? 's' : ''}` : ''}`,
      actual: `${actuals.indexedCount}${target.minJournal > 0 ? ` (${actuals.journalCount} journal${actuals.journalCount === 1 ? '' : 's'})` : ''}`,
      met: actuals.indexedCount >= target.indexedCount && (target.minJournal === 0 || actuals.journalCount >= target.minJournal),
      gating: true,
    },
    {
      key: 'ppc', label: `Patents/Projects/Consultancy (${target.ppcRule.toLowerCase()})`,
      target: `>= ${target.ppcCount}`, actual: String(ppcAchieved(actuals)),
      met: ppcAchieved(actuals) >= target.ppcCount, gating: target.ppcRule === 'MANDATORY',
    },
  ];

  if (target.quartileSet) {
    reqs.push({
      key: 'quartile', label: `Quartile ${target.quartileSet} (manual)`,
      target: target.quartileSet, actual: 'manual check', met: true, gating: false,
    });
  }

  const eligible = reqs.filter((r) => r.gating).every((r) => r.met);
  return { target, requirements: reqs, eligible };
}
