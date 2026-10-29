import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, handleApiError } from "@/lib/api-response";
import { getAuthUser, requireRole } from "@/lib/auth";
import { getStudentNamesByRolls } from "@/lib/legacy-db";
import { sectionNameWhere } from "@/lib/section-sync";
import { excelResponseHeaders } from "@/lib/excel";

const querySchema = z.object({
  courseCode: z.string().trim().min(1).optional(),
  sectionName: z.string().trim().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().trim().optional(),
  export: z.enum(["excel"]).optional(),
});

const DAY_MS = 24 * 60 * 60 * 1000;

// One row per student, one column per completed quiz in the range, plus a
// Total. A cell is the student's marks, "AB" when absent, null when the
// student was never allotted that quiz.
export async function GET(req: NextRequest) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "faculty", "admin");

    const query = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const ownQuizzes = { deletedAt: null, ...(user.role === "faculty" ? { facultyRoll: String(user.sub) } : {}) };

    const quizzes = await prisma.quiz.findMany({
      where: {
        ...ownQuizzes,
        status: "completed",
        ...(query.courseCode ? { courseCode: query.courseCode } : {}),
        ...(query.sectionName ? sectionNameWhere(query.sectionName) : {}),
        ...(query.from || query.to
          ? {
              startTime: {
                ...(query.from ? { gte: query.from } : {}),
                // "to" is a calendar day, so include all of it.
                ...(query.to ? { lt: new Date(query.to.getTime() + DAY_MS) } : {}),
              },
            }
          : {}),
      },
      orderBy: { startTime: "asc" },
      select: { id: true, title: true, startTime: true, totalMarks: true },
    });
    const quizIds = quizzes.map((q) => q.id);

    const [allotments, results, absences, attempts, courseRows] = await Promise.all([
      prisma.quizAllotment.findMany({ where: { quizId: { in: quizIds } }, select: { quizId: true, studentRoll: true } }),
      prisma.result.findMany({ where: { quizId: { in: quizIds } }, select: { quizId: true, studentRoll: true, marksObtained: true } }),
      prisma.attendance.findMany({ where: { quizId: { in: quizIds }, status: "absent" }, select: { quizId: true, studentRoll: true } }),
      prisma.quizAttempt.findMany({
        where: { quizId: { in: quizIds }, status: { in: ["submitted", "auto_submitted"] } },
        select: { quizId: true, studentRoll: true, answers: { select: { marksObtained: true } } },
      }),
      prisma.quiz.findMany({
        where: ownQuizzes,
        select: { courseCode: true, courseName: true, sectionNames: true },
      }),
    ]);

    const key = (quizId: number, roll: string) => `${quizId}|${roll}`;
    const published = new Map(results.map((r) => [key(r.quizId, r.studentRoll), r.marksObtained]));
    // Not published yet: fall back to the attempt's own scored answers.
    const scored = new Map(
      attempts.map((a) => [key(a.quizId, a.studentRoll), a.answers.reduce((sum, ans) => sum + ans.marksObtained, 0)]),
    );
    const absent = new Set(absences.map((a) => key(a.quizId, a.studentRoll)));
    const allotted = new Set(allotments.map((a) => key(a.quizId, a.studentRoll)));

    const rolls = [...new Set(allotments.map((a) => a.studentRoll))].sort();
    const names = await getStudentNamesByRolls(rolls);

    const search = query.search?.toLowerCase();
    const rows = rolls
      .map((roll) => {
        const marks = quizzes.map((q) => {
          const k = key(q.id, roll);
          if (published.has(k)) return published.get(k)!;
          if (scored.has(k)) return scored.get(k)!;
          if (absent.has(k)) return "AB";
          return allotted.has(k) ? 0 : null;
        });
        const total = marks.reduce<number>((sum, m) => sum + (typeof m === "number" ? m : 0), 0);
        return { roll, name: names.get(roll) ?? roll, marks, total };
      })
      .filter((r) => !search || r.roll.toLowerCase().includes(search) || r.name.toLowerCase().includes(search));

    const maxTotal = quizzes.reduce((sum, q) => sum + q.totalMarks, 0);

    if (query.export === "excel") {
      const date = (d: Date) => d.toISOString().slice(0, 10);
      const aoa: (string | number)[][] = [
        ["Quiz Details", "", ...quizzes.map((q) => q.title), "Total"],
        ["Quiz Date", "", ...quizzes.map((q) => date(q.startTime)), ""],
        ["Max Marks", "", ...quizzes.map((q) => q.totalMarks), maxTotal],
        ["Roll Number", "Student Name", ...quizzes.map(() => ""), ""],
        ...rows.map((r) => [r.roll, r.name, ...r.marks.map((m) => m ?? ""), r.total]),
      ];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), "Marks");
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
      return new Response(new Uint8Array(buffer), { headers: excelResponseHeaders("marks-report.xlsx") });
    }

    return ok({
      quizzes: quizzes.map((q) => ({ id: q.id, title: q.title, date: q.startTime.toISOString(), totalMarks: q.totalMarks })),
      maxTotal,
      rows,
      filterOptions: {
        courses: [...new Map(courseRows.map((q) => [q.courseCode, { code: q.courseCode, name: q.courseName }])).values()],
        // Sections come from the quizzes themselves, so each course lists only its own.
        sections: [
          ...new Map(
            courseRows.flatMap((q) =>
              q.sectionNames.split(",").filter(Boolean).map((name) => [`${q.courseCode}|${name}`, { courseCode: q.courseCode, name }] as const),
            ),
          ).values(),
        ],
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
