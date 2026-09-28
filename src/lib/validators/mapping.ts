import { z } from "zod";

export const facultyCourseMappingQuerySchema = z.object({
  facultyRoll: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(10),
});

// Backs the "Add Mapping" dialog's Course search dropdown - real courses
// only, never a typed code.
export const courseCatalogQuerySchema = z.object({
  search: z.string().trim().optional().default(""),
  // Capped at 200 to match the other bounded list schemas in this file - the
  // student-course-section browse filter fetches the full catalog at exactly
  // this size (see student-course-section/page.tsx), which a 50-cap rejected.
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

// Backs the same dialog's Branch/Semester dropdowns, scoped to whichever
// course was picked - real (branch, sem) pairs that course is actually
// offered as, never typed free text.
export const branchSemOptionsQuerySchema = z.object({
  subCode: z.string().trim().min(1, "Course is required"),
});

// Backs the "Split Existing Sections" flow's Course dropdown - scoped to
// whichever faculty was picked (courses they already have a real mapping row
// for), never the full catalog.
export const facultyCoursesQuerySchema = z.object({
  facRoll: z.string().trim().min(1, "Faculty is required"),
});

// Backs the same flow's existing-sections roster picker, once a course is
// picked.
export const splitCandidatesQuerySchema = z.object({
  subCode: z.string().trim().min(1, "Course is required"),
});

// No `.refine` requiring roll/courseCode - when neither is given, the route
// returns a bounded "recently registered" default list instead of erroring,
// so the page shows real data immediately rather than only after a search.
// `batch`/`sectionName` are browse filters (pick from a dropdown instead of
// typing an exact roll/course code) - they narrow whichever of the above
// branches runs, and on their own drive a bounded per-batch/per-section
// browse instead of falling back to the generic recent list.
export const studentCourseMappingQuerySchema = z.object({
  roll: z.string().trim().min(1).optional(),
  courseCode: z.string().trim().min(1).optional(),
  batch: z.string().trim().min(1).optional(),
  sectionName: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});
