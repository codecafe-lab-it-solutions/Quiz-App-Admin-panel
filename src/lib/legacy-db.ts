import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { listBatchRegistry } from "@/lib/config";
import { ApiError } from "@/lib/api-response";

/**
 * Every read (and, per an explicit product decision, the admin-panel writes
 * below) against the legacy university database (isr_* tables) goes through
 * this file. These tables are otherwise owned by the legacy system. One open
 * item from the integration spec is isolated here so a later fix only
 * touches one place:
 *  - the column names inside isr_reg_<batch>_tbl (getStudentCourses / getCourseRegistrations)
 *
 * isr_login_tbl.user_password uses MD5 (confirmed against the real legacy
 * system) - see hashLegacyPassword/verifyLegacyPassword. This is a property
 * of the external portal, not a choice made here - it must never be changed
 * to a stronger scheme unilaterally, since that would silently break login
 * against the real legacy system for anyone whose password was last set there.
 */

export type LegacyUserType = "FAC" | "STU";

export interface LegacyFaculty {
  roll: string;
  name: string;
  email: string;
  mobile: string | null;
  status: number;
  dept: string | null;
  empCode: string | null;
  facStatus: string | null;
}

export interface LegacyStudent {
  roll: string;
  name: string;
  email: string;
  mobile: string | null;
  major: string;
  batch: string;
  semNow: string;
  status: number;
  regStatus: string | null;
  attnOk: string | null;
  stuStatus: string | null;
  // Derived live from major+semNow (2026-08-18: the app-owned Section table
  // this used to read no longer exists), e.g. "CE_3". Null if major or semNow
  // is missing.
  section: string | null;
}

export interface FacultyCourseMapping {
  id: number;
  sem: string;
  subList: string;
  subCode: string;
  facRoll: string;
  facultyName: string | null;
  branch: string;
  major: string;
  // This row's own real Major_Semester section (isr_sub_available_tbl.section).
  section: string | null;
}

export interface StudentCourseRow {
  roll: string;
  subCode: string;
}

export interface CourseCatalogEntry {
  // The real isr_sub_available_tbl row id (avai_sr) this entry comes from -
  // needed because the same faculty can teach the same subCode under
  // several different branches (e.g. a shared elective), each its own row
  // with its own section, so subCode alone doesn't uniquely identify one.
  id: number;
  subCode: string;
  title: string | null;
  branch: string | null;
  sem: string | null;
  credits: number | null;
  facRoll: string;
  facultyName: string | null;
  // This row's own real Major_Semester section (isr_sub_available_tbl.section
  // - see resolveMajorFromBranch/assignFacultyToDefaultSection), independent
  // of whether a Course/SectionCourse link exists in the app's own catalog.
  section: string | null;
}

// ---------------------------------------------------------------------------
// Login / credential verification
// ---------------------------------------------------------------------------

// A user can sign in with any of their 3 real identifiers - roll, email, or
// mobile - so this matches on whichever one they typed rather than assuming
// a fixed field. Scoped by userType so a roll/email/mobile that happens to
// collide across a student and faculty row (shouldn't happen, but isr_login_tbl
// has no cross-type uniqueness constraint to rely on) never cross-matches.
export async function findLoginByIdentifier(identifier: string, userType: LegacyUserType) {
  return prisma.isrLoginTbl.findFirst({
    where: {
      userType,
      OR: [{ userRoll: identifier }, { userEmail: identifier }, { userMobile: identifier }],
    },
  });
}

// isr_login_tbl.user_password is MD5 - confirmed against the real legacy
// system (an external portal this app doesn't own; see the file header).
// Both directions - hashLegacyPassword (writes, see createFaculty/
// createStudent/updateFaculty/updateStudent below) and verifyLegacyPassword
// (reads, here) - must stay on this exact scheme, or a password set from
// this app would stop working in the real legacy portal and vice versa.
export function hashLegacyPassword(plainPassword: string): string {
  return crypto.createHash("md5").update(plainPassword).digest("hex");
}

export async function verifyLegacyPassword(plainPassword: string, storedHash: string | null): Promise<boolean> {
  if (storedHash == null) return false;
  return hashLegacyPassword(plainPassword) === storedHash;
}

// ---------------------------------------------------------------------------
// Faculty / Student profile lookup
// ---------------------------------------------------------------------------

export async function getFacultyByRoll(roll: string): Promise<LegacyFaculty | null> {
  const rows = await prisma.$queryRaw<
    { roll: string; name: string; user_email: string; user_mobile: string | null; status: number; dept: string | null; emp_code: string | null; fac_status: string | null }[]
  >`
    SELECT f.roll AS roll, f.name AS name, l.user_email AS user_email, l.user_mobile AS user_mobile, l.status AS status,
           f.dept AS dept, f.emp_code AS emp_code, f.fac_status AS fac_status
    FROM isr_faculty_tbl f
    JOIN isr_login_tbl l ON l.user_roll = f.roll
    WHERE f.roll = ${roll} AND l.user_type = 'FAC'
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    roll: row.roll,
    name: row.name,
    email: row.user_email,
    mobile: row.user_mobile,
    status: row.status,
    dept: row.dept,
    empCode: row.emp_code,
    facStatus: row.fac_status,
  };
}

export async function getStudentByRoll(roll: string): Promise<LegacyStudent | null> {
  const rows = await prisma.$queryRaw<
    {
      // sem_now is a real INT column - mysql2 returns a JS number for it.
      roll: string; stu_name: string; user_email: string; user_mobile: string | null; major: string; batch: string; sem_now: number | null;
      status: number; reg_status: string | null; attn_ok: string | null; stu_status: string | null;
    }[]
  >`
    SELECT d.stu_roll AS roll, d.stu_name AS stu_name, l.user_email AS user_email, l.user_mobile AS user_mobile, l.status AS status,
           m.major AS major, m.batch AS batch, m.sem_now AS sem_now,
           m.reg_status AS reg_status, m.attn_ok AS attn_ok, m.stu_status AS stu_status
    FROM isr_stu_data_tbl d
    JOIN isr_login_tbl l ON l.user_roll = d.stu_roll
    LEFT JOIN isr_stu_main_tbl m ON m.roll = d.stu_roll
    WHERE d.stu_roll = ${roll} AND l.user_type = 'STU'
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    roll: row.roll,
    name: row.stu_name,
    email: row.user_email,
    mobile: row.user_mobile,
    major: row.major ?? "",
    batch: row.batch ?? "",
    semNow: row.sem_now == null ? "" : String(row.sem_now),
    status: row.status,
    section: row.major && row.sem_now != null ? `${row.major}_${row.sem_now}` : null,
    regStatus: row.reg_status,
    attnOk: row.attn_ok,
    stuStatus: row.stu_status,
  };
}

export interface MatchedAccount {
  type: "student" | "faculty";
  roll: string;
  name: string | null;
  email: string | null;
}

// Best-effort match of a free-typed identifier (email/roll/mobile) against
// the legacy accounts DB, tried as a student first then faculty - used by
// the admin-panel "Delete Account" request queue both to display who a
// request matches and to act on that exact account (delete/deactivate).
export async function resolveAccountByIdentifier(identifier: string): Promise<MatchedAccount | null> {
  const student = await findLoginByIdentifier(identifier, "STU");
  if (student) {
    const profile = await getStudentByRoll(student.userRoll);
    return { type: "student", roll: student.userRoll, name: profile?.name ?? null, email: student.userEmail };
  }
  const faculty = await findLoginByIdentifier(identifier, "FAC");
  if (faculty) {
    const profile = await getFacultyByRoll(faculty.userRoll);
    return { type: "faculty", roll: faculty.userRoll, name: profile?.name ?? null, email: faculty.userEmail };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Login activation (isr_login_tbl.status: 1-Active, 2-Inactive)
// ---------------------------------------------------------------------------

export async function setLoginStatus(roll: string, userType: LegacyUserType, active: boolean): Promise<void> {
  const login = await prisma.isrLoginTbl.findUnique({ where: { userRoll: roll } });
  if (!login || login.userType !== userType) {
    throw new ApiError(404, userType === "FAC" ? "Faculty not found" : "Student not found");
  }
  await prisma.isrLoginTbl.update({ where: { userRoll: roll }, data: { status: active ? 1 : 2 } });
}

export async function countFaculty(): Promise<number> {
  return prisma.isrLoginTbl.count({ where: { userType: "FAC" } });
}

export async function countStudents(): Promise<number> {
  return prisma.isrLoginTbl.count({ where: { userType: "STU" } });
}

// Batch name resolution - used by reports/attendance screens that display
// student/faculty names but no longer have a Prisma relation to join through.
export async function getStudentNamesByRolls(rolls: string[]): Promise<Map<string, string>> {
  if (rolls.length === 0) return new Map();
  const rows = await prisma.isrStuDataTbl.findMany({ where: { stuRoll: { in: [...new Set(rolls)] } } });
  return new Map(rows.map((r) => [r.stuRoll, r.stuName]));
}

// Derived live from major+semNow (2026-08-18: the app-owned SectionStudent
// table this used to read no longer exists) - joined in for the admin
// student list/detail views and report exports.
export async function getSectionNamesByRolls(rolls: string[]): Promise<Map<string, string>> {
  if (rolls.length === 0) return new Map();
  const rows = await prisma.isrStuMainTbl.findMany({
    where: { roll: { in: [...new Set(rolls)] } },
    select: { roll: true, major: true, semNow: true },
  });
  const byRoll = new Map<string, string>();
  for (const row of rows) {
    if (!row.major || row.semNow == null) continue;
    byRoll.set(row.roll, `${row.major}_${row.semNow}`);
  }
  return byRoll;
}

export async function getFacultyNamesByRolls(rolls: string[]): Promise<Map<string, string>> {
  if (rolls.length === 0) return new Map();
  const rows = await prisma.isrFacultyTbl.findMany({ where: { roll: { in: [...new Set(rolls)] } } });
  return new Map(rows.map((r) => [r.roll, r.name]));
}

// ---------------------------------------------------------------------------
// Directory listings (admin panel)
// ---------------------------------------------------------------------------

export async function listFaculty(params: { search?: string; page: number; pageSize: number }) {
  const search = (params.search ?? "").trim();
  const like = `%${search}%`;
  const offset = (params.page - 1) * params.pageSize;

  const whereClause = search
    ? Prisma.sql`WHERE f.name LIKE ${like} OR l.user_email LIKE ${like} OR f.roll LIKE ${like}`
    : Prisma.empty;

  const [items, countRows] = await Promise.all([
    prisma.$queryRaw<{ roll: string; name: string; user_email: string; user_mobile: string | null; status: number; dept: string | null; fac_status: string | null }[]>(Prisma.sql`
      SELECT f.roll AS roll, f.name AS name, l.user_email AS user_email, l.user_mobile AS user_mobile, l.status AS status, f.dept AS dept, f.fac_status AS fac_status
      FROM isr_faculty_tbl f
      JOIN isr_login_tbl l ON l.user_roll = f.roll AND l.user_type = 'FAC'
      ${whereClause}
      ORDER BY f.name ASC
      LIMIT ${params.pageSize} OFFSET ${offset}
    `),
    prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) AS total
      FROM isr_faculty_tbl f
      JOIN isr_login_tbl l ON l.user_roll = f.roll AND l.user_type = 'FAC'
      ${whereClause}
    `),
  ]);

  return {
    items: items.map((r) => ({ roll: r.roll, name: r.name, email: r.user_email, mobile: r.user_mobile, status: r.status, dept: r.dept, facStatus: r.fac_status })),
    total: Number(countRows[0]?.total ?? 0),
  };
}

export async function listStudents(params: {
  search?: string;
  major?: string;
  batch?: string;
  semNow?: string;
  page: number;
  pageSize: number;
}) {
  const search = (params.search ?? "").trim();
  const like = `%${search}%`;
  const offset = (params.page - 1) * params.pageSize;

  // Built as a single WHERE clause via Prisma.sql to keep every value parameterized.
  const conditions: ReturnType<typeof Prisma.sql>[] = [];
  if (search) {
    conditions.push(Prisma.sql`(d.stu_name LIKE ${like} OR l.user_email LIKE ${like} OR d.stu_roll LIKE ${like})`);
  }
  if (params.major) conditions.push(Prisma.sql`m.major = ${params.major}`);
  if (params.batch) conditions.push(Prisma.sql`m.batch = ${params.batch}`);
  if (params.semNow) conditions.push(Prisma.sql`m.sem_now = ${params.semNow}`);

  const whereClause = conditions.length
    ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
    : Prisma.empty;

  const [items, countRows] = await Promise.all([
    prisma.$queryRaw<
      // sem_now is a real INT column - mysql2 returns a JS number for it.
      { roll: string; stu_name: string; user_email: string; user_mobile: string | null; major: string; batch: string; sem_now: number | null; status: number; category: string | null }[]
    >(Prisma.sql`
      SELECT d.stu_roll AS roll, d.stu_name AS stu_name, l.user_email AS user_email, l.user_mobile AS user_mobile, l.status AS status,
             m.major AS major, m.batch AS batch, m.sem_now AS sem_now, d.category AS category
      FROM isr_stu_data_tbl d
      JOIN isr_login_tbl l ON l.user_roll = d.stu_roll AND l.user_type = 'STU'
      LEFT JOIN isr_stu_main_tbl m ON m.roll = d.stu_roll
      ${whereClause}
      ORDER BY d.stu_name ASC
      LIMIT ${params.pageSize} OFFSET ${offset}
    `),
    prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) AS total
      FROM isr_stu_data_tbl d
      JOIN isr_login_tbl l ON l.user_roll = d.stu_roll AND l.user_type = 'STU'
      LEFT JOIN isr_stu_main_tbl m ON m.roll = d.stu_roll
      ${whereClause}
    `),
  ]);

  return {
    items: items.map((r) => ({
      roll: r.roll,
      name: r.stu_name,
      email: r.user_email,
      mobile: r.user_mobile,
      major: r.major ?? "",
      batch: r.batch ?? "",
      semNow: r.sem_now == null ? "" : String(r.sem_now),
      status: r.status,
      category: r.category,
      section: r.major && r.sem_now != null ? `${r.major}_${r.sem_now}` : null,
    })),
    total: Number(countRows[0]?.total ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Faculty / Student CRUD - writes into the legacy tables at the admin's
// explicit request. Roll and email must be unique across isr_login_tbl. Roll
// is the identity/primary key across every one of these tables, so it's
// never editable once created - only name/email/password/profile fields are.
// ---------------------------------------------------------------------------

export async function createFaculty(data: {
  roll: string;
  name: string;
  email: string;
  mobile: string;
  password: string;
}): Promise<LegacyFaculty> {
  const existingRoll = await prisma.isrLoginTbl.findUnique({ where: { userRoll: data.roll } });
  if (existingRoll) throw new ApiError(409, "A user with this roll number already exists");

  const existingEmail = await prisma.isrLoginTbl.findFirst({ where: { userEmail: data.email } });
  if (existingEmail) throw new ApiError(409, "A user with this email already exists");

  const passwordHash = hashLegacyPassword(data.password);

  await prisma.$transaction([
    prisma.isrLoginTbl.create({
      data: { userRoll: data.roll, userEmail: data.email, userMobile: data.mobile, userPassword: passwordHash, userType: "FAC" },
    }),
    prisma.isrFacultyTbl.create({ data: { roll: data.roll, name: data.name } }),
  ]);

  return { roll: data.roll, name: data.name, email: data.email, mobile: data.mobile, status: 1, dept: null, empCode: null, facStatus: null };
}

export async function updateFaculty(
  roll: string,
  data: { name?: string; email?: string; mobile?: string; password?: string }
): Promise<LegacyFaculty> {
  const login = await prisma.isrLoginTbl.findUnique({ where: { userRoll: roll } });
  if (!login || login.userType !== "FAC") throw new ApiError(404, "Faculty not found");

  if (data.email && data.email !== login.userEmail) {
    const emailConflict = await prisma.isrLoginTbl.findFirst({ where: { userEmail: data.email, userRoll: { not: roll } } });
    if (emailConflict) throw new ApiError(409, "A user with this email already exists");
  }

  if (data.email || data.mobile || data.password) {
    await prisma.isrLoginTbl.update({
      where: { userRoll: roll },
      data: {
        ...(data.email ? { userEmail: data.email } : {}),
        ...(data.mobile ? { userMobile: data.mobile } : {}),
        ...(data.password ? { userPassword: hashLegacyPassword(data.password) } : {}),
      },
    });
  }

  if (data.name) {
    await prisma.isrFacultyTbl.update({ where: { roll }, data: { name: data.name } });
  }

  const faculty = await getFacultyByRoll(roll);
  if (!faculty) throw new ApiError(404, "Faculty not found");
  return faculty;
}

export async function deleteFaculty(roll: string): Promise<void> {
  const login = await prisma.isrLoginTbl.findUnique({ where: { userRoll: roll } });
  if (!login || login.userType !== "FAC") throw new ApiError(404, "Faculty not found");

  // Mapping rows aren't FK-linked to isr_faculty_tbl (facRoll is a bare
  // string, see the mapping section below), so they'd otherwise be orphaned.
  await prisma.isrSubAvailableTbl.deleteMany({ where: { facRoll: roll } });
  await prisma.isrFacultyTbl.delete({ where: { roll } });
  await prisma.isrLoginTbl.delete({ where: { userRoll: roll } });
}

export async function createStudent(data: {
  roll: string;
  name: string;
  email: string;
  mobile: string;
  password: string;
  major: string;
  batch: string;
  semNow: string;
}): Promise<LegacyStudent> {
  const existingRoll = await prisma.isrLoginTbl.findUnique({ where: { userRoll: data.roll } });
  if (existingRoll) throw new ApiError(409, "A user with this roll number already exists");

  const existingEmail = await prisma.isrLoginTbl.findFirst({ where: { userEmail: data.email } });
  if (existingEmail) throw new ApiError(409, "A user with this email already exists");

  const passwordHash = hashLegacyPassword(data.password);

  await prisma.$transaction([
    prisma.isrLoginTbl.create({
      data: { userRoll: data.roll, userEmail: data.email, userMobile: data.mobile, userPassword: passwordHash, userType: "STU" },
    }),
    prisma.isrStuDataTbl.create({ data: { stuRoll: data.roll, stuName: data.name } }),
    prisma.isrStuMainTbl.create({
      // isr_stu_main_tbl.sem_now is a real INT column - convert at this boundary
      // so every app-facing surface (forms, validators, API types) can keep
      // treating the semester value as a string.
      data: { roll: data.roll, major: data.major, name: data.name, batch: data.batch, semNow: Number(data.semNow) },
    }),
  ]);

  return {
    roll: data.roll, name: data.name, email: data.email, mobile: data.mobile, major: data.major, batch: data.batch, semNow: data.semNow,
    status: 1, section: null, regStatus: null, attnOk: null, stuStatus: null,
  };
}

export async function updateStudent(
  roll: string,
  data: { name?: string; email?: string; mobile?: string; password?: string; major?: string; batch?: string; semNow?: string }
): Promise<LegacyStudent> {
  const login = await prisma.isrLoginTbl.findUnique({ where: { userRoll: roll } });
  if (!login || login.userType !== "STU") throw new ApiError(404, "Student not found");

  if (data.email && data.email !== login.userEmail) {
    const emailConflict = await prisma.isrLoginTbl.findFirst({ where: { userEmail: data.email, userRoll: { not: roll } } });
    if (emailConflict) throw new ApiError(409, "A user with this email already exists");
  }

  if (data.email || data.mobile || data.password) {
    await prisma.isrLoginTbl.update({
      where: { userRoll: roll },
      data: {
        ...(data.email ? { userEmail: data.email } : {}),
        ...(data.mobile ? { userMobile: data.mobile } : {}),
        ...(data.password ? { userPassword: hashLegacyPassword(data.password) } : {}),
      },
    });
  }

  if (data.name) {
    await prisma.isrStuDataTbl.update({ where: { stuRoll: roll }, data: { stuName: data.name } });
  }

  if (data.name || data.major || data.batch || data.semNow) {
    await prisma.isrStuMainTbl.upsert({
      where: { roll },
      update: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.major ? { major: data.major } : {}),
        ...(data.batch ? { batch: data.batch } : {}),
        ...(data.semNow ? { semNow: Number(data.semNow) } : {}),
      },
      create: {
        roll,
        name: data.name ?? "",
        major: data.major ?? "",
        batch: data.batch ?? "",
        semNow: data.semNow ? Number(data.semNow) : 0,
      },
    });
  }

  const student = await getStudentByRoll(roll);
  if (!student) throw new ApiError(404, "Student not found");
  return student;
}

export async function deleteStudent(roll: string): Promise<void> {
  const login = await prisma.isrLoginTbl.findUnique({ where: { userRoll: roll } });
  if (!login || login.userType !== "STU") throw new ApiError(404, "Student not found");

  const student = await getStudentByRoll(roll);
  if (student?.batch) {
    const tableName = await resolveBatchTable(student.batch);
    if (tableName) {
      await prisma.$executeRawUnsafe(`DELETE FROM \`${tableName}\` WHERE \`${REG_ROLL_COLUMN}\` = ?`, roll);
    }
  }

  await prisma.isrStuMainTbl.deleteMany({ where: { roll } });
  await prisma.isrStuDataTbl.delete({ where: { stuRoll: roll } });
  await prisma.isrLoginTbl.delete({ where: { userRoll: roll } });
}

// ---------------------------------------------------------------------------
// Faculty <-> Course mapping (isr_sub_available_tbl)
// ---------------------------------------------------------------------------

// isr_sub_available_tbl.branch is NOT the same code space as
// isr_stu_main_tbl.major, confirmed against the real dump: most branch
// values already match a real major exactly ("CE", "PE", "IT", ...), but a
// real subset use a "D" + major prefix instead ("DCE", "DPE", "DFS" - real
// isr_sub_available_tbl rows for CE202/CE203/etc, all genuinely Civil
// Engineering courses, are branch="DCE" even though the real major for
// those students is "CE"). Sections are keyed by the student-facing major
// (Major_Semester, e.g. "CE_3") - so a faculty mapping's section has to
// resolve through this real-data mismatch instead of using `branch` as-is,
// or a "DCE" row would create a phantom section unrelated to the real "CE"
// cohort its own students actually belong to.
export async function getRealMajors(): Promise<Set<string>> {
  const rows = await prisma.isrStuMainTbl.findMany({ distinct: ["major"], select: { major: true } });
  return new Set(rows.map((r) => r.major));
}

export function resolveMajorFromBranch(branch: string, realMajors: Set<string>): string {
  const b = branch.trim();
  if (realMajors.has(b)) return b;
  if (b.startsWith("D") && realMajors.has(b.slice(1))) return b.slice(1);
  return b;
}

export async function getFacultyCourseMappings(
  subList: string,
  params: { facultyRoll?: string; page: number; pageSize: number }
) {
  const offset = (params.page - 1) * params.pageSize;

  // facRoll is nullable on the real table (a mapping row with no faculty
  // assigned yet) - excluded here since a null-faculty row isn't a "who
  // teaches this course" fact worth listing.
  const rows = await prisma.isrSubAvailableTbl.findMany({
    where: { subList, facRoll: params.facultyRoll ?? { not: null } },
    orderBy: { subCode: "asc" },
    skip: offset,
    take: params.pageSize,
  });
  const total = await prisma.isrSubAvailableTbl.count({
    where: { subList, facRoll: params.facultyRoll ?? { not: null } },
  });

  const facultyRolls = [...new Set(rows.map((r) => r.facRoll!))];
  const facultyNames = facultyRolls.length
    ? await prisma.isrFacultyTbl.findMany({ where: { roll: { in: facultyRolls } } })
    : [];
  const nameByRoll = new Map(facultyNames.map((f) => [f.roll, f.name]));
  const realMajors = await getRealMajors();

  const items: FacultyCourseMapping[] = rows.map((r) => ({
    id: r.id,
    sem: r.sem != null ? String(r.sem) : "",
    subList: r.subList ?? "",
    subCode: r.subCode ?? "",
    facRoll: r.facRoll!,
    facultyName: nameByRoll.get(r.facRoll!) ?? null,
    branch: r.branch ?? "",
    major: resolveMajorFromBranch(r.branch ?? "", realMajors),
    section: r.section,
  }));

  return { items, total };
}

export async function isFacultyMappedToCourse(facultyRoll: string, courseCode: string, subList: string) {
  const count = await prisma.isrSubAvailableTbl.count({
    where: { facRoll: facultyRoll, subCode: courseCode, subList },
  });
  return count > 0;
}

export async function createFacultyCourseMapping(data: {
  facRoll: string;
  subCode: string;
  branch: string;
  major: string;
  sem: string;
  subList: string;
}): Promise<FacultyCourseMapping> {
  const faculty = await prisma.isrFacultyTbl.findUnique({ where: { roll: data.facRoll } });
  if (!faculty) throw new ApiError(404, "No faculty found for this roll number");

  const alreadyMapped = await isFacultyMappedToCourse(data.facRoll, data.subCode, data.subList);
  if (alreadyMapped) throw new ApiError(409, "This faculty is already mapped to this course for the current cycle");

  const semNum = Number(data.sem);
  if (!Number.isFinite(semNum)) throw new ApiError(400, "Semester must be a number");

  const row = await prisma.isrSubAvailableTbl.create({
    data: {
      sem: semNum,
      subList: data.subList,
      subCode: data.subCode,
      facRoll: data.facRoll,
      branch: data.branch,
      // App-added column (see schema.prisma) - this row's own branch+sem
      // deterministically resolve to exactly one section, set once here.
      section: `${data.major}_${data.sem}`,
    },
  });

  return {
    id: row.id,
    sem: data.sem,
    subList: data.subList,
    subCode: data.subCode,
    facRoll: data.facRoll,
    facultyName: faculty.name,
    branch: data.branch,
    major: data.major,
    section: row.section,
  };
}

export async function deleteFacultyCourseMapping(id: number): Promise<void> {
  const existing = await prisma.isrSubAvailableTbl.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "Mapping not found");
  await prisma.isrSubAvailableTbl.delete({ where: { id } });
}

export interface SectionSummary {
  name: string;
  major: string;
  sem: string;
  studentCount: number;
  courses: {
    id: number;
    subCode: string;
    courseTitle: string;
    facRoll: string;
    facultyName: string | null;
  }[];
}

// Section-first view over the same isr_sub_available_tbl rows the Faculty <->
// Course mapping page manages - grouped by section name (a section is real
// data only, never typed: every row that resolves to the same Major_Semester
// is the same section, whichever course/faculty it happens to be under).
// studentCount is the real isr_stu_main_tbl membership for that major+sem,
// same live-derivation the quiz section picker uses (see section-sync.ts) -
// not a cached count.
export async function getAllSections(subList: string): Promise<SectionSummary[]> {
  const rows = await prisma.isrSubAvailableTbl.findMany({
    where: { subList, section: { not: null }, subCode: { not: null }, facRoll: { not: null } },
  });
  if (rows.length === 0) return [];

  const realMajors = await getRealMajors();
  const facultyRolls = [...new Set(rows.map((r) => r.facRoll!))];
  const subCodes = [...new Set(rows.map((r) => r.subCode!))];

  const [facultyRows, curriculumRows] = await Promise.all([
    facultyRolls.length
      ? prisma.isrFacultyTbl.findMany({ where: { roll: { in: facultyRolls } } })
      : Promise.resolve([]),
    subCodes.length
      ? prisma.isrCurriculumTbl.findMany({ where: { bsmsCode: { in: subCodes }, subList } })
      : Promise.resolve([]),
  ]);
  const facultyNameByRoll = new Map(facultyRows.map((f) => [f.roll, f.name]));
  const titleByCode = new Map(curriculumRows.map((c) => [c.bsmsCode, c.title]));

  const bySection = new Map<
    string,
    { major: string; sem: string; courses: SectionSummary["courses"] }
  >();
  for (const row of rows) {
    const name = row.section!;
    const major = resolveMajorFromBranch(row.branch ?? "", realMajors);
    const entry = bySection.get(name) ?? { major, sem: row.sem != null ? String(row.sem) : "", courses: [] };
    entry.courses.push({
      id: row.id,
      subCode: row.subCode!,
      courseTitle: titleByCode.get(row.subCode!) ?? row.subCode!,
      facRoll: row.facRoll!,
      facultyName: facultyNameByRoll.get(row.facRoll!) ?? null,
    });
    bySection.set(name, entry);
  }

  const entries = [...bySection.entries()];
  const counts = await Promise.all(
    entries.map(([, v]) =>
      prisma.isrStuMainTbl.count({ where: { major: v.major, semNow: Number(v.sem) } }),
    ),
  );

  return entries
    .map(([name, v], i) => ({
      name,
      major: v.major,
      sem: v.sem,
      studentCount: counts[i],
      courses: v.courses,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Real course catalog for the "Add Mapping" course picker - a proper union
// of isr_curriculum_tbl and isr_sub_available_tbl, since neither is a
// complete list on its own (confirmed against the real C2 dump: 21 real
// course codes only ever appear in isr_sub_available_tbl, never in
// curriculum). Title comes from curriculum when available, falls back to the
// bare code otherwise.
export async function searchRealCourseCatalog(
  subList: string,
  search: string,
  limit: number
): Promise<{ code: string; title: string }[]> {
  const like = `%${search.trim()}%`;
  const rows = await prisma.$queryRawUnsafe<{ code: string; title: string | null }[]>(
    `SELECT code, MAX(title) AS title FROM (
       SELECT bsms_code AS code, title AS title FROM isr_curriculum_tbl WHERE sub_list = ?
       UNION ALL
       SELECT sub_code AS code, NULL AS title FROM isr_sub_available_tbl WHERE sub_list = ? AND sub_code IS NOT NULL
     ) t
     WHERE code LIKE ?
     GROUP BY code
     ORDER BY code ASC
     LIMIT ?`,
    subList,
    subList,
    like,
    limit
  );
  return rows.map((r) => ({ code: r.code, title: r.title ?? r.code }));
}

// Real Branch+Semester options for a specific course - the admin picks from
// these instead of typing (no guardrail before against picking a
// branch/semester combination unrelated to what that course is actually
// offered as). Same two-source union as above, since a course can be
// "offered" per curriculum without a faculty row yet, or have a faculty row
// without a curriculum entry.
export async function getRealBranchSemOptions(
  subCode: string,
  subList: string
): Promise<{ branch: string; sem: string }[]> {
  const rows = await prisma.$queryRawUnsafe<{ branch: string; sem: string }[]>(
    `SELECT DISTINCT bsms_branch AS branch, sem AS sem FROM isr_curriculum_tbl
       WHERE bsms_code = ? AND sub_list = ? AND bsms_branch IS NOT NULL AND sem IS NOT NULL
     UNION
     SELECT DISTINCT branch AS branch, sem AS sem FROM isr_sub_available_tbl
       WHERE sub_code = ? AND sub_list = ? AND branch IS NOT NULL AND sem IS NOT NULL`,
    subCode,
    subList,
    subCode,
    subList
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Student <-> Course mapping (isr_reg_<batch>_tbl) - dynamic table, allow-listed
// ---------------------------------------------------------------------------

const SAFE_TABLE_NAME = /^[a-zA-Z0-9_]+$/;

async function resolveBatchTable(batch: string): Promise<string | null> {
  const registry = await listBatchRegistry();
  const entry = registry.find((r) => r.batchName === batch && r.isActive);
  if (!entry) return null;
  if (!SAFE_TABLE_NAME.test(entry.tableName)) {
    throw new Error(`Batch table registry entry for "${batch}" has an unsafe table name`);
  }
  return entry.tableName;
}

// Confirmed from the integration spec's real isr_reg_<batch>_tbl export: the
// roll column is `stu_roll` (not `roll` - every other isr_* table uses `roll`
// or `stu_roll` inconsistently, this one is `stu_roll`), and every row also
// carries `sub_list`, so registrations must be scoped to the current cycle
// the same way isr_sub_available_tbl reads are.
const REG_ROLL_COLUMN = "stu_roll";
const REG_SUB_CODE_COLUMN = "sub_code";
const REG_SUB_LIST_COLUMN = "sub_list";
// Confirmed real auto-increment PK (see prisma/migrations/20260810090000_legacy_reg_table_full_parity) -
// only used to order "most recently registered first" for getRecentRegistrations.
const REG_PK_COLUMN = "reg_sr";

export async function getStudentCourses(roll: string, batch: string, subList: string): Promise<StudentCourseRow[]> {
  const tableName = await resolveBatchTable(batch);
  if (!tableName) return [];

  try {
    const rows = await prisma.$queryRawUnsafe<Record<string, string>[]>(
      `SELECT \`${REG_ROLL_COLUMN}\` AS roll, \`${REG_SUB_CODE_COLUMN}\` AS sub_code FROM \`${tableName}\` WHERE \`${REG_ROLL_COLUMN}\` = ? AND \`${REG_SUB_LIST_COLUMN}\` = ?`,
      roll,
      subList
    );
    return rows.map((r) => ({ roll: r.roll, subCode: r.sub_code }));
  } catch (error) {
    console.error(`getStudentCourses: query against ${tableName} failed`, error);
    return [];
  }
}

export async function getCourseRegistrations(courseCode: string, subList: string): Promise<(StudentCourseRow & { batch: string })[]> {
  const registry = (await listBatchRegistry()).filter((r) => r.isActive);
  const results: (StudentCourseRow & { batch: string })[] = [];

  for (const entry of registry) {
    if (!SAFE_TABLE_NAME.test(entry.tableName)) continue;
    try {
      const rows = await prisma.$queryRawUnsafe<Record<string, string>[]>(
        `SELECT \`${REG_ROLL_COLUMN}\` AS roll, \`${REG_SUB_CODE_COLUMN}\` AS sub_code FROM \`${entry.tableName}\` WHERE \`${REG_SUB_CODE_COLUMN}\` = ? AND \`${REG_SUB_LIST_COLUMN}\` = ?`,
        courseCode,
        subList
      );
      results.push(...rows.map((r) => ({ roll: r.roll, subCode: r.sub_code, batch: entry.batchName })));
    } catch (error) {
      console.error(`getCourseRegistrations: query against ${entry.tableName} failed`, error);
    }
  }

  return results;
}

// UI-facing paginated form of getCourseRegistrations, for the Student <->
// Course mapping page's course browse filter - that page needs a real
// page/pageSize with a total count, not the full unbounded scan
// getCourseRegistrations does for its other (internal, correctness-critical)
// callers. Counts each active batch table first (cheap), then only pulls
// LIMIT/OFFSET rows from the specific table(s) this page actually falls on -
// never loads more than one page's worth of rows into memory, however many
// batch tables exist.
export async function getCourseRegistrationsPaged(
  courseCode: string,
  subList: string,
  opts: { batch?: string; page: number; pageSize: number }
): Promise<{ items: (StudentCourseRow & { batch: string })[]; total: number }> {
  const registry = (await listBatchRegistry()).filter(
    (r) => r.isActive && (!opts.batch || r.batchName === opts.batch) && SAFE_TABLE_NAME.test(r.tableName)
  );

  const perTable: { entry: (typeof registry)[number]; count: number }[] = [];
  let total = 0;
  for (const entry of registry) {
    try {
      const rows = await prisma.$queryRawUnsafe<{ c: bigint | number }[]>(
        `SELECT COUNT(*) AS c FROM \`${entry.tableName}\` WHERE \`${REG_SUB_CODE_COLUMN}\` = ? AND \`${REG_SUB_LIST_COLUMN}\` = ?`,
        courseCode,
        subList
      );
      const count = Number(rows[0]?.c ?? 0);
      perTable.push({ entry, count });
      total += count;
    } catch (error) {
      console.error(`getCourseRegistrationsPaged: count against ${entry.tableName} failed`, error);
    }
  }

  let remainingSkip = (opts.page - 1) * opts.pageSize;
  let remainingTake = opts.pageSize;
  const items: (StudentCourseRow & { batch: string })[] = [];

  for (const { entry, count } of perTable) {
    if (remainingTake <= 0) break;
    if (remainingSkip >= count) {
      remainingSkip -= count;
      continue;
    }
    const tableSkip = remainingSkip;
    const tableTake = Math.min(remainingTake, count - tableSkip);
    remainingSkip = 0;
    try {
      const rows = await prisma.$queryRawUnsafe<Record<string, string>[]>(
        `SELECT \`${REG_ROLL_COLUMN}\` AS roll, \`${REG_SUB_CODE_COLUMN}\` AS sub_code FROM \`${entry.tableName}\` WHERE \`${REG_SUB_CODE_COLUMN}\` = ? AND \`${REG_SUB_LIST_COLUMN}\` = ? ORDER BY \`${REG_PK_COLUMN}\` LIMIT ${tableTake} OFFSET ${tableSkip}`,
        courseCode,
        subList
      );
      items.push(...rows.map((r) => ({ roll: r.roll, subCode: r.sub_code, batch: entry.batchName })));
      remainingTake -= tableTake;
    } catch (error) {
      console.error(`getCourseRegistrationsPaged: page query against ${entry.tableName} failed`, error);
    }
  }

  return { items, total };
}

// Course browse combined with a section filter (roll set already known and
// bounded, unlike a full course scan) - resolves each member's real batch
// and queries only those specific tables with both sub_code and an IN-list
// of rolls, instead of scanning every active batch table for the course and
// filtering client-side.
export async function getCourseRegistrationsForRolls(
  courseCode: string,
  subList: string,
  rolls: string[]
): Promise<(StudentCourseRow & { batch: string })[]> {
  if (rolls.length === 0) return [];
  const members = await prisma.isrStuMainTbl.findMany({
    where: { roll: { in: rolls } },
    select: { roll: true, batch: true },
  });
  const rollsByBatch = new Map<string, string[]>();
  for (const m of members) {
    if (!m.batch) continue;
    const list = rollsByBatch.get(m.batch) ?? [];
    list.push(m.roll);
    rollsByBatch.set(m.batch, list);
  }

  const results: (StudentCourseRow & { batch: string })[] = [];
  for (const [batch, batchRolls] of rollsByBatch) {
    const tableName = await resolveBatchTable(batch);
    if (!tableName) continue;
    try {
      const placeholders = batchRolls.map(() => "?").join(",");
      const rows = await prisma.$queryRawUnsafe<Record<string, string>[]>(
        `SELECT \`${REG_ROLL_COLUMN}\` AS roll, \`${REG_SUB_CODE_COLUMN}\` AS sub_code FROM \`${tableName}\` WHERE \`${REG_SUB_CODE_COLUMN}\` = ? AND \`${REG_SUB_LIST_COLUMN}\` = ? AND \`${REG_ROLL_COLUMN}\` IN (${placeholders})`,
        courseCode,
        subList,
        ...batchRolls
      );
      results.push(...rows.map((r) => ({ roll: r.roll, subCode: r.sub_code, batch })));
    } catch (error) {
      console.error(`getCourseRegistrationsForRolls: query against ${tableName} failed`, error);
    }
  }
  return results;
}

// Only 3 of the real student batches (btechpeg23/24/25) have an actual
// isr_reg_<batch>_tbl in the database - confirmed against the live schema:
// every other batch (the other ~94% of students, by roll count) has no
// registration table at all, so getCourseRegistrations can never find a row
// for them regardless of what course they're really taking. Naively
// intersecting a student list against getCourseRegistrations would therefore
// wipe out almost every student system-wide, not just the ones who aren't
// really taking the course - worse than not filtering at all.
//
// So this only *excludes* a student when their own batch actually has a
// registration table and that table's rows say they're not registered for
// this course - i.e. when there's real per-student evidence to act on. A
// student whose batch has no registration table at all is left in the list
// unfiltered (section membership is the best available signal for them).
export async function narrowToCourseRegistrants(rolls: string[], courseCode: string, subList: string): Promise<string[]> {
  if (rolls.length === 0) return [];

  const [registry, students, registrations] = await Promise.all([
    listBatchRegistry(),
    prisma.isrStuMainTbl.findMany({ where: { roll: { in: rolls } }, select: { roll: true, batch: true } }),
    getCourseRegistrations(courseCode, subList),
  ]);
  const verifiableBatches = new Set(registry.filter((r) => r.isActive).map((r) => r.batchName));
  const batchByRoll = new Map(students.map((s) => [s.roll, s.batch]));
  const registeredRolls = new Set(registrations.map((r) => r.roll));

  return rolls.filter((roll) => {
    const batch = batchByRoll.get(roll);
    const isVerifiable = !!batch && verifiableBatches.has(batch);
    return !isVerifiable || registeredRolls.has(roll);
  });
}

// Bounded default listing for the admin mapping page - a handful of the most
// recently registered rows per active batch table, so the page shows real
// data immediately instead of only after a search (the per-table LIMIT keeps
// this cheap even as more batch tables get registered over time).
const RECENT_PER_TABLE_LIMIT = 10;

export async function getRecentRegistrations(subList: string, limit: number): Promise<(StudentCourseRow & { batch: string })[]> {
  const registry = (await listBatchRegistry()).filter((r) => r.isActive);
  const results: (StudentCourseRow & { batch: string })[] = [];

  for (const entry of registry) {
    if (!SAFE_TABLE_NAME.test(entry.tableName)) continue;
    try {
      const rows = await prisma.$queryRawUnsafe<Record<string, string>[]>(
        `SELECT \`${REG_ROLL_COLUMN}\` AS roll, \`${REG_SUB_CODE_COLUMN}\` AS sub_code FROM \`${entry.tableName}\` WHERE \`${REG_SUB_LIST_COLUMN}\` = ? ORDER BY \`${REG_PK_COLUMN}\` DESC LIMIT ${RECENT_PER_TABLE_LIMIT}`,
        subList
      );
      results.push(...rows.map((r) => ({ roll: r.roll, subCode: r.sub_code, batch: entry.batchName })));
    } catch (error) {
      console.error(`getRecentRegistrations: query against ${entry.tableName} failed`, error);
    }
  }

  return results.slice(0, limit);
}

// Backs the mapping page's Batch filter - a single batch table is cheap to
// query directly (unlike scanning all ~60), optionally narrowed to a
// specific roll set (e.g. a section's members) instead of just LIMITed.
export async function getBatchRegistrations(
  batch: string,
  subList: string,
  opts: { rolls?: string[]; limit?: number } = {}
): Promise<StudentCourseRow[]> {
  const tableName = await resolveBatchTable(batch);
  if (!tableName) return [];

  try {
    if (opts.rolls) {
      if (opts.rolls.length === 0) return [];
      const placeholders = opts.rolls.map(() => "?").join(",");
      const rows = await prisma.$queryRawUnsafe<Record<string, string>[]>(
        `SELECT \`${REG_ROLL_COLUMN}\` AS roll, \`${REG_SUB_CODE_COLUMN}\` AS sub_code FROM \`${tableName}\` WHERE \`${REG_SUB_LIST_COLUMN}\` = ? AND \`${REG_ROLL_COLUMN}\` IN (${placeholders}) ORDER BY \`${REG_PK_COLUMN}\` DESC`,
        subList,
        ...opts.rolls
      );
      return rows.map((r) => ({ roll: r.roll, subCode: r.sub_code }));
    }

    const rows = await prisma.$queryRawUnsafe<Record<string, string>[]>(
      `SELECT \`${REG_ROLL_COLUMN}\` AS roll, \`${REG_SUB_CODE_COLUMN}\` AS sub_code FROM \`${tableName}\` WHERE \`${REG_SUB_LIST_COLUMN}\` = ? ORDER BY \`${REG_PK_COLUMN}\` DESC LIMIT ${opts.limit ?? 50}`,
      subList
    );
    return rows.map((r) => ({ roll: r.roll, subCode: r.sub_code }));
  } catch (error) {
    console.error(`getBatchRegistrations: query against ${tableName} failed`, error);
    return [];
  }
}

// Paginated form of the batch-only browse (no roll filter) - real
// LIMIT/OFFSET plus a total count, instead of the fixed 50-row cap
// getBatchRegistrations({ limit }) applies with no way to see further rows.
export async function getBatchRegistrationsPaged(
  batch: string,
  subList: string,
  opts: { page: number; pageSize: number }
): Promise<{ items: StudentCourseRow[]; total: number }> {
  const tableName = await resolveBatchTable(batch);
  if (!tableName) return { items: [], total: 0 };

  try {
    const countRows = await prisma.$queryRawUnsafe<{ c: bigint | number }[]>(
      `SELECT COUNT(*) AS c FROM \`${tableName}\` WHERE \`${REG_SUB_LIST_COLUMN}\` = ?`,
      subList
    );
    const total = Number(countRows[0]?.c ?? 0);
    const skip = (opts.page - 1) * opts.pageSize;
    const rows = await prisma.$queryRawUnsafe<Record<string, string>[]>(
      `SELECT \`${REG_ROLL_COLUMN}\` AS roll, \`${REG_SUB_CODE_COLUMN}\` AS sub_code FROM \`${tableName}\` WHERE \`${REG_SUB_LIST_COLUMN}\` = ? ORDER BY \`${REG_PK_COLUMN}\` DESC LIMIT ${opts.pageSize} OFFSET ${skip}`,
      subList
    );
    return { items: rows.map((r) => ({ roll: r.roll, subCode: r.sub_code })), total };
  } catch (error) {
    console.error(`getBatchRegistrationsPaged: query against ${tableName} failed`, error);
    return { items: [], total: 0 };
  }
}

export interface SectionAllotmentResult {
  registeredCount: number;
  alreadyRegisteredCount: number;
  skippedNoBatchCount: number;
}

export interface SectionStudentCandidate {
  roll: string;
  name: string;
  batch: string | null;
  // eligible - can be registered now; already_registered - already has a real
  // registration row for this course, nothing to do; no_batch_table - real
  // student with no batch, or a batch with no isr_reg_<batch>_tbl configured
  // in the batch registry, so there's nowhere to write a registration row.
  status: "eligible" | "already_registered" | "no_batch_table";
}

// Shared registration-status lookup for a set of students against one
// course - batch table resolved once per batch, one bounded IN(...) query
// per batch for who's already registered, instead of the per-student
// existence check createStudentCourseMapping does. Used by both the
// candidate preview (getSectionStudentCandidates) and the actual bulk write
// (bulkRegisterStudentsForSection) so they can never disagree about who's
// eligible.
async function resolveRegistrationStatus(
  subCode: string,
  subList: string,
  students: { roll: string; batch: string | null }[],
): Promise<Map<string, { tableName: string | null; alreadyRegistered: boolean }>> {
  const result = new Map<string, { tableName: string | null; alreadyRegistered: boolean }>();
  const rollsByBatch = new Map<string, string[]>();

  for (const s of students) {
    if (!s.batch) {
      result.set(s.roll, { tableName: null, alreadyRegistered: false });
      continue;
    }
    const list = rollsByBatch.get(s.batch) ?? [];
    list.push(s.roll);
    rollsByBatch.set(s.batch, list);
  }

  for (const [batch, rolls] of rollsByBatch) {
    const tableName = await resolveBatchTable(batch);
    if (!tableName) {
      for (const roll of rolls) result.set(roll, { tableName: null, alreadyRegistered: false });
      continue;
    }

    const placeholders = rolls.map(() => "?").join(",");
    const existingRows = await prisma.$queryRawUnsafe<{ roll: string }[]>(
      `SELECT \`${REG_ROLL_COLUMN}\` AS roll FROM \`${tableName}\` WHERE \`${REG_SUB_CODE_COLUMN}\` = ? AND \`${REG_SUB_LIST_COLUMN}\` = ? AND \`${REG_ROLL_COLUMN}\` IN (${placeholders})`,
      subCode,
      subList,
      ...rolls,
    );
    const existingRolls = new Set(existingRows.map((r) => r.roll));
    for (const roll of rolls) {
      result.set(roll, { tableName, alreadyRegistered: existingRolls.has(roll) });
    }
  }

  return result;
}

// Real students who'd be affected by allotting this section - every
// isr_stu_main_tbl member of the given major+sem, each tagged with whether
// they'd actually be registered (eligible), are already registered, or can't
// be (no batch table) - so the admin can see and choose exactly who gets
// allotted before creating the section, not just a blind count after.
export async function getSectionStudentCandidates(data: {
  subCode: string;
  subList: string;
  major: string;
  sem: string;
}): Promise<SectionStudentCandidate[]> {
  const semNow = Number(data.sem);
  if (!Number.isFinite(semNow)) return [];

  const students = await prisma.isrStuMainTbl.findMany({
    where: { major: data.major, semNow },
    select: { roll: true, name: true, batch: true },
  });
  if (students.length === 0) return [];

  const statusByRoll = await resolveRegistrationStatus(data.subCode, data.subList, students);

  return students
    .map((s) => {
      const info = statusByRoll.get(s.roll);
      const status: SectionStudentCandidate["status"] = !info?.tableName
        ? "no_batch_table"
        : info.alreadyRegistered
          ? "already_registered"
          : "eligible";
      return { roll: s.roll, name: s.name, batch: s.batch, status };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Registers exactly the given rolls for the course - the admin's selection
// from getSectionStudentCandidates's eligible list, not a re-derived
// major+sem query, so what gets written matches what was shown and picked.
// A roll that's already registered, or has no batch table, is silently
// skipped (same as before) rather than failing the whole call - defense in
// depth in case the selection is stale by the time this runs.
export async function bulkRegisterStudentsForSection(data: {
  subCode: string;
  subList: string;
  rolls: string[];
}): Promise<SectionAllotmentResult> {
  if (data.rolls.length === 0) {
    return { registeredCount: 0, alreadyRegisteredCount: 0, skippedNoBatchCount: 0 };
  }

  const students = await prisma.isrStuMainTbl.findMany({
    where: { roll: { in: data.rolls } },
    select: { roll: true, batch: true },
  });
  const statusByRoll = await resolveRegistrationStatus(data.subCode, data.subList, students);

  let registeredCount = 0;
  let alreadyRegisteredCount = 0;
  let skippedNoBatchCount = data.rolls.length - students.length; // rolls that weren't even real students

  for (const s of students) {
    const info = statusByRoll.get(s.roll);
    if (!info?.tableName) {
      skippedNoBatchCount++;
      continue;
    }
    if (info.alreadyRegistered) {
      alreadyRegisteredCount++;
      continue;
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO \`${info.tableName}\` (\`${REG_ROLL_COLUMN}\`, \`${REG_SUB_CODE_COLUMN}\`, \`${REG_SUB_LIST_COLUMN}\`) VALUES (?, ?, ?)`,
      s.roll,
      data.subCode,
      data.subList,
    );
    registeredCount++;
  }

  return { registeredCount, alreadyRegisteredCount, skippedNoBatchCount };
}

export async function createStudentCourseMapping(data: {
  roll: string;
  subCode: string;
  subList: string;
}): Promise<StudentCourseRow & { batch: string; major: string; semNow: string }> {
  const student = await getStudentByRoll(data.roll);
  if (!student || !student.batch) throw new ApiError(404, "No student found for this roll number, or the student has no batch on record");

  const tableName = await resolveBatchTable(student.batch);
  if (!tableName) throw new ApiError(400, `No registration table is configured for batch "${student.batch}"`);

  const existing = await prisma.$queryRawUnsafe<{ cnt: bigint }[]>(
    `SELECT COUNT(*) AS cnt FROM \`${tableName}\` WHERE \`${REG_ROLL_COLUMN}\` = ? AND \`${REG_SUB_CODE_COLUMN}\` = ? AND \`${REG_SUB_LIST_COLUMN}\` = ?`,
    data.roll,
    data.subCode,
    data.subList
  );
  if (Number(existing[0]?.cnt ?? 0) > 0) {
    throw new ApiError(409, "Student is already registered for this course");
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO \`${tableName}\` (\`${REG_ROLL_COLUMN}\`, \`${REG_SUB_CODE_COLUMN}\`, \`${REG_SUB_LIST_COLUMN}\`) VALUES (?, ?, ?)`,
    data.roll,
    data.subCode,
    data.subList
  );

  return { roll: data.roll, subCode: data.subCode, batch: student.batch, major: student.major, semNow: student.semNow };
}

export async function deleteStudentCourseMapping(roll: string, subCode: string, subList: string): Promise<void> {
  const student = await getStudentByRoll(roll);
  if (!student || !student.batch) throw new ApiError(404, "No student found for this roll number, or the student has no batch on record");

  const tableName = await resolveBatchTable(student.batch);
  if (!tableName) throw new ApiError(400, `No registration table is configured for batch "${student.batch}"`);

  const result = await prisma.$executeRawUnsafe(
    `DELETE FROM \`${tableName}\` WHERE \`${REG_ROLL_COLUMN}\` = ? AND \`${REG_SUB_CODE_COLUMN}\` = ? AND \`${REG_SUB_LIST_COLUMN}\` = ?`,
    roll,
    subCode,
    subList
  );
  if (Number(result) === 0) throw new ApiError(404, "Registration not found");
}

// ---------------------------------------------------------------------------
// Curriculum catalog (isr_curriculum_tbl) - resolves a bare course code into
// title/credits/branch, and builds the faculty course-list + roster views
// the spec calls out as the literal "Prog/Dept always blank" fix (§5, §8).
// ---------------------------------------------------------------------------

// Resolves a bare course code to its title, preferring the current cycle's
// isr_curriculum_tbl row but falling back to any cycle - some codes (e.g.
// old electives) only have a curriculum row under a past cycle. Falls back
// to the code itself when no curriculum row exists at all (e.g. Quiz.courseCode
// values already stored in the isr_curriculum_tbl-sparse era).
export async function getCourseTitleByCode(subCode: string, subList: string): Promise<string> {
  const rows = await prisma.isrCurriculumTbl.findMany({ where: { bsmsCode: subCode } });
  if (rows.length === 0) return subCode;
  const current = rows.find((r) => r.subList === subList);
  return (current ?? rows[0]).title;
}

export async function getFacultyCourseCatalog(facultyRoll: string, subList: string): Promise<CourseCatalogEntry[]> {
  const rows = await prisma.isrSubAvailableTbl.findMany({
    where: { facRoll: facultyRoll, subList },
    orderBy: { subCode: "asc" },
  });
  // subCode is nullable on the real table - a mapping row without one isn't
  // a course this catalog can resolve, so it's excluded here.
  const mappings = rows.filter((m): m is typeof m & { subCode: string } => m.subCode !== null);
  if (mappings.length === 0) return [];

  const codes = [...new Set(mappings.map((m) => m.subCode))];
  // Not filtered to the current subList: titles are static across cycles,
  // but some codes (e.g. old electives) only have a curriculum row under a
  // past cycle (subList='C1') with nothing under the current one - scoping
  // this to `subList` misses those and leaves title null even though a
  // real title exists one cycle back.
  const curriculum = await prisma.isrCurriculumTbl.findMany({ where: { bsmsCode: { in: codes } } });
  // Keyed by (code, branch) - a shared course (e.g. "CDC") has one real
  // curriculum row PER branch, each with its own sem/credits. A plain
  // by-code Map would collapse all of those down to whichever one happened
  // to load last, so every row for that course would show the same wrong
  // branch/sem/title regardless of its own real isr_sub_available_tbl.branch.
  // Rows from the current subList are inserted last so they win ties with an
  // older cycle's row for the same (code, branch); an older cycle's row only
  // survives in the map when the current cycle has nothing for that key.
  const bySubListThenCurrent = [...curriculum].sort((a, b) =>
    Number(a.subList === subList) - Number(b.subList === subList)
  );
  const byCodeAndBranch = new Map(bySubListThenCurrent.map((c) => [`${c.bsmsCode}::${c.bsmsBranch}`, c]));
  const byCode = new Map(bySubListThenCurrent.map((c) => [c.bsmsCode, c]));
  const faculty = await getFacultyByRoll(facultyRoll);

  return mappings.map((m) => {
    // Prefer the curriculum row matching this row's own real branch; fall
    // back to any curriculum row for the code (better than nothing) only
    // when there's no exact branch match.
    const c = byCodeAndBranch.get(`${m.subCode}::${m.branch}`) ?? byCode.get(m.subCode);
    return {
      id: m.id,
      subCode: m.subCode,
      title: c?.title ?? null,
      // This row's own real branch/sem always win over curriculum - they're
      // the authoritative source for THIS specific mapping row, not a
      // course-wide generality.
      branch: m.branch ?? c?.bsmsBranch ?? null,
      sem: m.sem != null ? String(m.sem) : (c?.sem ?? null),
      credits: c?.bsmsCredit ?? null,
      facRoll: m.facRoll!,
      facultyName: faculty?.name ?? null,
      section: m.section,
    };
  });
}

