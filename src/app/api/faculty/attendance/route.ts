import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, handleApiError } from "@/lib/api-response";
import { getAuthUser, requireRole } from "@/lib/auth";
import { paginationMeta } from "@/lib/validators/common";
import { getStudentNamesByRolls } from "@/lib/legacy-db";
import { sectionNameWhere } from "@/lib/section-sync";
import { buildWorkbookBuffer, excelResponseHeaders } from "@/lib/excel";
import { buildPdfTableBuffer, pdfResponseHeaders } from "@/lib/pdf";
import { z } from "zod";

const querySchema = z.object({
  courseCode: z.string().trim().min(1).optional(),
  sectionName: z.string().trim().min(1).optional(),
  quizId: z.coerce.number().int().positive().optional(),
  search: z.string().trim().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  export: z.enum(["excel", "pdf"]).optional(),
  // "true" = only students a faculty/admin marked present by hand.
  markedByFaculty: z.enum(["true"]).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "faculty");

    const query = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams));

    const where = {
      quiz: {
        facultyRoll: String(user.sub),
        ...(query.sectionName ? sectionNameWhere(query.sectionName) : {}),
      },
      ...(query.courseCode ? { courseCode: query.courseCode } : {}),
      ...(query.quizId ? { quizId: query.quizId } : {}),
      ...(query.markedByFaculty ? { markedByFaculty: true } : {}),
      ...(query.search
        ? {
            OR: [
              { studentRoll: { contains: query.search } },
              { quiz: { title: { contains: query.search } } },
            ],
          }
        : {}),
      ...(query.from || query.to
        ? {
            date: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };

    const baseQuery = {
      where,
      orderBy: { date: query.sortOrder },
      include: {
        quiz: { select: { id: true, title: true, sectionNames: true } },
      },
    };

    if (query.export === "excel" || query.export === "pdf") {
      const rows = await prisma.attendance.findMany(baseQuery);
      const names = await getStudentNamesByRolls(rows.map((r) => r.studentRoll));

      if (query.export === "excel") {
        const buffer = buildWorkbookBuffer(
          [
            { key: "studentName", label: "Student Name" },
            { key: "rollNo", label: "Roll No" },
            { key: "course", label: "Course" },
            { key: "section", label: "Section" },
            { key: "quiz", label: "Quiz" },
            { key: "date", label: "Date" },
            { key: "status", label: "Status" },
            { key: "markedByFaculty", label: "Marked present by faculty" },
          ],
          rows.map((r) => ({
            studentName: names.get(r.studentRoll) ?? r.studentRoll,
            rollNo: r.studentRoll,
            course: `${r.courseName} (${r.courseCode})`,
            section: r.quiz.sectionNames.split(",").filter(Boolean).join(", ") || "—",
            quiz: r.quiz.title,
            date: r.date.toISOString().slice(0, 10),
            status: r.status,
            markedByFaculty: r.markedByFaculty ? `Yes (${r.markedByRoll ?? ""})` : "No",
          })),
          "Attendance",
        );
        return new Response(new Uint8Array(buffer), { headers: excelResponseHeaders("attendance-report.xlsx") });
      }

      const buffer = buildPdfTableBuffer(
        "Attendance Report",
        ["Student", "Roll No", "Course", "Section", "Quiz", "Date", "Status"],
        rows.map((r) => [
          names.get(r.studentRoll) ?? r.studentRoll,
          r.studentRoll,
          `${r.courseName} (${r.courseCode})`,
          r.quiz.sectionNames.split(",").filter(Boolean).join(", ") || "—",
          r.quiz.title,
          r.date.toISOString().slice(0, 10),
          r.status,
        ]),
      );
      return new Response(new Uint8Array(buffer), { headers: pdfResponseHeaders("attendance-report.pdf") });
    }

    const [items, total] = await Promise.all([
      prisma.attendance.findMany({ ...baseQuery, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      prisma.attendance.count({ where }),
    ]);

    const names = await getStudentNamesByRolls(items.map((r) => r.studentRoll));
    const itemsWithNames = items.map((r) => ({ ...r, studentName: names.get(r.studentRoll) ?? r.studentRoll }));

    const own = await prisma.attendance.findMany({
      where: { quiz: { facultyRoll: String(user.sub) } },
      select: { courseCode: true, courseName: true, quiz: { select: { sectionNames: true } } },
    });
    const courseOptions = [...new Map(own.map((r) => [r.courseCode, { code: r.courseCode, name: r.courseName }])).values()];
    const sectionOptions = [
      ...new Set(own.flatMap((r) => r.quiz.sectionNames.split(",").filter(Boolean))),
    ].map((name) => ({ name }));

    return ok({
      items: itemsWithNames,
      meta: paginationMeta(total, query.page, query.pageSize),
      filterOptions: { courses: courseOptions, sections: sectionOptions },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
