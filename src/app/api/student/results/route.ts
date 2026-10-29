import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, handleApiError } from "@/lib/api-response";
import { getAuthUser, requireRole } from "@/lib/auth";
import { attendanceReportQuerySchema } from "@/lib/validators/reports";
import { paginationMeta } from "@/lib/validators/common";
import { buildWorkbookBuffer, excelResponseHeaders } from "@/lib/excel";
import { buildPdfTableBuffer, pdfResponseHeaders } from "@/lib/pdf";
import { sectionNameWhere } from "@/lib/section-sync";

export async function GET(req: NextRequest) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "student");

    const query = attendanceReportQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const studentRoll = String(user.sub);

    const quizFilter = {
      ...(query.courseCode ? { courseCode: query.courseCode } : {}),
      ...(query.sectionName ? sectionNameWhere(query.sectionName) : {}),
      ...(query.search ? { title: { contains: query.search } } : {}),
    };

    const where = {
      studentRoll,
      status: "published" as const,
      ...(Object.keys(quizFilter).length > 0 ? { quiz: quizFilter } : {}),
      ...(query.from || query.to
        ? {
            publishedAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };

    const baseQuery = {
      where,
      orderBy: { publishedAt: query.sortOrder },
      include: {
        quiz: {
          select: {
            id: true,
            title: true,
            totalMarks: true,
            courseCode: true,
            courseName: true,
            sectionNames: true,
          },
        },
      },
    };

    if (query.export === "excel") {
      const rows = await prisma.result.findMany(baseQuery);
      const buffer = buildWorkbookBuffer(
        [
          { key: "quiz", label: "Quiz" },
          { key: "course", label: "Course" },
          { key: "section", label: "Section" },
          { key: "marks", label: "Marks" },
          { key: "percentage", label: "Percentage" },
          { key: "publishedAt", label: "Published" },
        ],
        rows.map((r) => ({
          quiz: r.quiz.title,
          course: `${r.quiz.courseName} (${r.quiz.courseCode})`,
          section: r.quiz.sectionNames.split(",").filter(Boolean).join(", ") || "—",
          marks: `${r.marksObtained} / ${r.quiz.totalMarks}`,
          percentage: `${r.percentage.toFixed(2)}%`,
          publishedAt: r.publishedAt ? r.publishedAt.toISOString().slice(0, 10) : "—",
        })),
        "My Results",
      );
      return new Response(new Uint8Array(buffer), { headers: excelResponseHeaders("my-results.xlsx") });
    }

    if (query.export === "pdf") {
      const rows = await prisma.result.findMany(baseQuery);
      const buffer = buildPdfTableBuffer(
        "My Results",
        ["Quiz", "Course", "Section", "Marks", "Percentage", "Published"],
        rows.map((r) => [
          r.quiz.title,
          `${r.quiz.courseName} (${r.quiz.courseCode})`,
          r.quiz.sectionNames.split(",").filter(Boolean).join(", ") || "—",
          `${r.marksObtained} / ${r.quiz.totalMarks}`,
          `${r.percentage.toFixed(2)}%`,
          r.publishedAt ? r.publishedAt.toISOString().slice(0, 10) : "—",
        ]),
      );
      return new Response(new Uint8Array(buffer), { headers: pdfResponseHeaders("my-results.pdf") });
    }

    const [items, total, own] = await Promise.all([
      prisma.result.findMany({ ...baseQuery, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      prisma.result.count({ where }),
      prisma.result.findMany({
        where: { studentRoll, status: "published" },
        select: {
          quiz: { select: { courseCode: true, courseName: true, sectionNames: true } },
        },
      }),
    ]);

    const courseOptions = [
      ...new Map(own.map((r) => [r.quiz.courseCode, { code: r.quiz.courseCode, name: r.quiz.courseName }])).values(),
    ];
    // Each section keeps the course it belongs to so the UI can filter by the selected course.
    const sectionOptions = [
      ...new Map(
        own.flatMap((r) =>
          r.quiz.sectionNames.split(",").filter(Boolean).map((name) => [`${r.quiz.courseCode}|${name}`, { courseCode: r.quiz.courseCode, name }] as const),
        ),
      ).values(),
    ];

    return ok({
      items,
      meta: paginationMeta(total, query.page, query.pageSize),
      filterOptions: { courses: courseOptions, sections: sectionOptions },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
