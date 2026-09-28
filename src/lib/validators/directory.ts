import { z } from "zod";

// isr_login_tbl.user_mobile - same 10-digit format the forgot-password SMS
// OTP send gates on (see MOBILE_REGEX in api/auth/forgot-password/route.ts).
// A number that doesn't match this simply never gets an SMS OTP - keeping
// the two in sync means an admin can't create an account that then silently
// can't receive one.
const mobileSchema = z.string().trim().regex(/^\d{10}$/, "Enter a valid 10-digit mobile number");

export const facultyCreateSchema = z.object({
  roll: z.string().trim().min(1, "Roll is required"),
  name: z.string().trim().min(2, "Name must be at least 2 characters"),
  email: z.string().trim().email("Enter a valid email"),
  mobile: mobileSchema,
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const studentCreateSchema = z
  .object({
    roll: z.string().trim().min(1, "Roll is required"),
    name: z.string().trim().min(2, "Name must be at least 2 characters"),
    email: z.string().trim().email("Enter a valid email"),
    mobile: mobileSchema,
    password: z.string().min(6, "Password must be at least 6 characters"),
    major: z.string().trim().min(1, "Major is required"),
    batch: z.string().trim().min(1, "Batch is required"),
    // isr_stu_main_tbl.sem_now is a real INT column in the legacy database, so
    // this must be a plain numeric string (no "Final", "III", etc.).
    semNow: z.string().trim().regex(/^\d+$/, "Semester must be a whole number"),
  });

export const facultyUpdateSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").optional(),
  email: z.string().trim().email("Enter a valid email").optional(),
  mobile: mobileSchema.optional(),
  password: z.string().min(6, "Password must be at least 6 characters").optional(),
});

export const studentUpdateSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").optional(),
  email: z.string().trim().email("Enter a valid email").optional(),
  mobile: mobileSchema.optional(),
  password: z.string().min(6, "Password must be at least 6 characters").optional(),
  major: z.string().trim().min(1, "Major is required").optional(),
  batch: z.string().trim().min(1, "Batch is required").optional(),
  semNow: z.string().trim().regex(/^\d+$/, "Semester must be a whole number").optional(),
});

export const loginStatusUpdateSchema = z.object({
  active: z.boolean(),
});

// The section this mapping belongs to is always derived live from branch +
// sem (Major + Semester), never a manually picked existing section.
export const facultyCourseMappingCreateSchema = z.object({
  facRoll: z.string().trim().min(1, "Faculty roll is required"),
  subCode: z.string().trim().min(1, "Course code is required"),
  branch: z.string().trim().min(1, "Branch is required"),
  sem: z.string().trim().min(1, "Semester is required"),
});

export const studentCourseMappingCreateSchema = z.object({
  roll: z.string().trim().min(1, "Student roll is required"),
  subCode: z.string().trim().min(1, "Course code is required"),
});

// Same shape as facultyCourseMappingCreateSchema, plus the exact students
// (from the Sections page's candidate checklist) to allot into the course -
// an empty array is valid (create the section with nobody allotted yet).
export const sectionCreateSchema = z.object({
  facRoll: z.string().trim().min(1, "Faculty roll is required"),
  subCode: z.string().trim().min(1, "Course code is required"),
  branch: z.string().trim().min(1, "Branch is required"),
  sem: z.string().trim().min(1, "Semester is required"),
  rolls: z.array(z.string().trim().min(1)).default([]),
});

// "Split Existing Sections" flow: a brand-new section, named directly rather
// than derived from branch/semester, mapped to one or more courses at once -
// same "one section name, several course rows" shape every other section
// already has. Each course carries its own list of moves (which students,
// and which existing section each is being pulled out of - a student can
// have several section tags at once, so the API needs to know exactly which
// one to remove for that course).
export const sectionSplitSchema = z.object({
  facRoll: z.string().trim().min(1, "Faculty roll is required"),
  sectionName: z.string().trim().min(1, "Section name is required"),
  courses: z
    .array(
      z.object({
        subCode: z.string().trim().min(1, "Course code is required"),
        moves: z
          .array(
            z.object({
              roll: z.string().trim().min(1),
              fromSection: z.string().trim().min(1),
            }),
          )
          .min(1, "Pick at least one student to move"),
      }),
    )
    .min(1, "Pick at least one course"),
});
