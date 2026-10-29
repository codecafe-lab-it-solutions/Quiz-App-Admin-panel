import { z } from "zod";

export const attendanceReportQuerySchema = z.object({
  courseCode: z.string().trim().min(1).optional(),
  sectionName: z.string().trim().min(1).optional(),
  studentRoll: z.array(z.string()).optional(),
  search: z.string().trim().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(100),
  export: z.enum(["excel", "pdf"]).optional(),
  // "true" = only students a faculty/admin marked present by hand.
  markedByFaculty: z.enum(["true"]).optional(),
});
export type AttendanceReportQuery = z.infer<typeof attendanceReportQuerySchema>;

export const resultsReportQuerySchema = attendanceReportQuerySchema.extend({
  resultStatus: z.enum(["pending", "declared", "published"]).optional(),
});
export type ResultsReportQuery = z.infer<typeof resultsReportQuerySchema>;

export const violationsQuerySchema = z.object({
  quizId: z.coerce.number().int().positive().optional(),
  studentRoll: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(100),
});
export type ViolationsQuery = z.infer<typeof violationsQuerySchema>;
