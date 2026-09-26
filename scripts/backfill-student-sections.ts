import { PrismaClient } from "@prisma/client";
import { getBatchRegistrations, getRealMajors } from "@/lib/legacy-db";
import { getCurrentSubList } from "@/lib/config";
import { parseSectionList, pickSectionFromRegistrations } from "@/lib/section-sync";

// One-time backfill of isr_stu_main_tbl.section (the comma-joined list of
// sections a student belongs to - see getStudentsForRealSections) for students
// whose section is still empty.
//
// Only ever FILLS empty values - a section that's already set is never read
// back into a decision or overwritten (e.g. 2022-batch students legitimately
// carry "_9" sections that don't match their current semester). Each missing
// section is derived from the courses the student is actually registered for
// in the current sub_list, matched against isr_sub_available_tbl (same major,
// preferring the student's current semester) - NOT from sem_now alone. A
// student with no registrations, or whose registrations point to more than one
// candidate section, is left empty and listed in the report for a person to
// decide.
//
// Dry-run by default - prints what it would do and touches nothing.
//
// Usage:
//   tsx scripts/backfill-student-sections.ts            (dry run)
//   tsx scripts/backfill-student-sections.ts --apply     (writes for real)

const prisma = new PrismaClient();
const ROLL_CHUNK = 500;

async function main() {
  const apply = process.argv.slice(2).includes("--apply");
  const subList = await getCurrentSubList();
  const realMajors = await getRealMajors();

  const all = await prisma.isrStuMainTbl.findMany({
    select: { roll: true, major: true, semNow: true, batch: true, section: true },
  });
  const empty = all.filter((s) => parseSectionList(s.section).length === 0);

  const subAvailableRows = await prisma.isrSubAvailableTbl.findMany({
    where: { subList, section: { not: null } },
    select: { subCode: true, section: true, branch: true, sem: true },
  });

  const rollsByBatch = new Map<string, string[]>();
  for (const s of empty) {
    if (!s.batch) continue;
    const list = rollsByBatch.get(s.batch) ?? [];
    list.push(s.roll);
    rollsByBatch.set(s.batch, list);
  }

  const codesByRoll = new Map<string, Set<string>>();
  for (const [batch, rolls] of rollsByBatch) {
    for (let i = 0; i < rolls.length; i += ROLL_CHUNK) {
      const regs = await getBatchRegistrations(batch, subList, { rolls: rolls.slice(i, i + ROLL_CHUNK) });
      for (const r of regs) {
        if (!codesByRoll.has(r.roll)) codesByRoll.set(r.roll, new Set());
        codesByRoll.get(r.roll)!.add(r.subCode);
      }
    }
  }

  const toFill: { roll: string; section: string }[] = [];
  const noRegistrations: string[] = [];
  const ambiguous: string[] = [];
  for (const s of empty) {
    const codes = codesByRoll.get(s.roll);
    if (!codes || codes.size === 0) {
      noRegistrations.push(s.roll);
      continue;
    }
    const section = pickSectionFromRegistrations(subAvailableRows, s, codes, realMajors);
    if (section) toFill.push({ roll: s.roll, section });
    else ambiguous.push(s.roll);
  }

  console.log(
    `${apply ? "APPLYING" : "DRY RUN"} - sub_list ${subList}: ${all.length} student(s), ${empty.length} with an empty section.`
  );
  console.log(`  ${toFill.length} can be filled from their registrations`);
  console.log(`  ${noRegistrations.length} have no registration this cycle - left empty`);
  console.log(`  ${ambiguous.length} match zero or several candidate sections - left empty for manual review`);
  console.log("First 10 that would be filled:");
  for (const u of toFill.slice(0, 10)) console.log(`  ${u.roll}  ->  "${u.section}"`);
  if (ambiguous.length > 0) console.log(`Ambiguous (first 20): ${ambiguous.slice(0, 20).join(", ")}`);

  if (!apply) {
    console.log("\nRe-run with --apply to actually write these values.");
    return;
  }

  let written = 0;
  for (const u of toFill) {
    // The where-clause re-checks emptiness so a value set since the read above
    // (or by another process) can never be overwritten.
    const result = await prisma.isrStuMainTbl.updateMany({
      where: { roll: u.roll, OR: [{ section: null }, { section: "" }] },
      data: { section: u.section },
    });
    written += result.count;
  }
  console.log(`Done. ${written} student(s) updated.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
