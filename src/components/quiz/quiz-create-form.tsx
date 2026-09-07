"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { dedupeByCourseCode, hasRealTitle } from "@/lib/course-catalog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableSelect } from "@/components/ui/searchable-select";

interface CourseOption {
  subCode: string;
  title: string | null;
}

interface BuildingOption {
  id: number;
  name: string;
  radiusMeters: number;
}

interface FacultyOption {
  roll: string;
  name: string;
}

interface SectionOption {
  name: string;
}

interface StudentOption {
  roll: string;
  name: string;
}

const fetcher = <T,>(url: string) => apiClient.get<T>(url);

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function QuizCreateForm({ role }: { role: "faculty" | "admin" }) {
  const router = useRouter();
  const [facultyRoll, setFacultyRoll] = useState("");
  const [title, setTitle] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [startTime, setStartTime] = useState(
    toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000)),
  );
  const [endTime, setEndTime] = useState(
    toLocalInputValue(new Date(Date.now() + 90 * 60 * 1000)),
  );
  const [durationMinutes, setDurationMinutes] = useState("30");
  const [randomize, setRandomize] = useState(true);
  const [negativeMarking, setNegativeMarking] = useState(true);
  const [allowSkipSwitch, setAllowSkipSwitch] = useState(true);
  const [requireLocation, setRequireLocation] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedSectionNames, setSelectedSectionNames] = useState<string[]>([]);

  const { data: facultyData } = useSWR(
    role === "admin" ? `/api/admin/faculty?page=1&pageSize=200` : null,
    (url: string) => fetcher<{ items: FacultyOption[] }>(url),
  );

  const coursesUrl =
    role === "admin"
      ? facultyRoll
        ? `/api/faculty/courses?facultyRoll=${encodeURIComponent(facultyRoll)}`
        : null
      : `/api/faculty/courses`;
  const { data: coursesData, isLoading: coursesLoading } = useSWR(
    coursesUrl,
    (url: string) => fetcher<{ items: CourseOption[] }>(url),
  );
  const { data: buildingsData } = useSWR(
    `/api/faculty/buildings`,
    (url: string) => fetcher<{ items: BuildingOption[] }>(url),
  );
  // The catalog API returns one row per branch a faculty teaches a code
  // under (needed for the admin mapping picker), so a shared course across
  // several branches arrives as several rows here - this is just a "pick a
  // course" list, so collapse to one entry per code, preferring a row that
  // actually resolved a title over one that fell back to null.
  const courses = dedupeByCourseCode(
    (coursesData?.items ?? []).filter((c) => hasRealTitle(c)),
  );
  const buildings = buildingsData?.items ?? [];
  const selectedCourse = courses.find((c) => c.subCode === courseCode);

  // Sections linked to the chosen course are offered as checkboxes below for
  // the faculty member to pick manually - not auto-selected. Sourced live
  // from isr_sub_available_tbl (real per-branch sections) and
  // isr_stu_main_tbl/isr_reg_<batch>_tbl (real student membership + course
  // registration) on every call, not from the app's own
  // section_students/section_faculty tables - see /api/faculty/quiz-sections.
  const sectionsUrl = selectedCourse?.subCode
    ? role === "admin"
      ? facultyRoll
        ? `/api/faculty/quiz-sections?subCode=${encodeURIComponent(selectedCourse.subCode)}&facultyRoll=${encodeURIComponent(facultyRoll)}`
        : null
      : `/api/faculty/quiz-sections?subCode=${encodeURIComponent(selectedCourse.subCode)}`
    : null;
  const { data: sectionsData } = useSWR(
    sectionsUrl,
    (url: string) => fetcher<{ items: SectionOption[] }>(url),
  );
  const sections = sectionsData?.items ?? [];
  const sectionNamesAvailable = sections.map((s) => s.name);
  const activeSectionNames = selectedSectionNames;

  // Reset selection (not auto-check) whenever the available section list
  // changes, e.g. after picking a different course - the faculty member
  // checks which section(s) they actually want via the checkboxes below.
  useEffect(() => {
    setSelectedSectionNames([]);
  }, [sectionNamesAvailable.join(",")]);

  const studentsUrl =
    activeSectionNames.length > 0 && selectedCourse?.subCode
      ? role === "admin"
        ? facultyRoll
          ? `/api/faculty/quiz-sections/students?sectionNames=${activeSectionNames.join(",")}&subCode=${encodeURIComponent(selectedCourse.subCode)}&facultyRoll=${encodeURIComponent(facultyRoll)}`
          : null
        : `/api/faculty/quiz-sections/students?sectionNames=${activeSectionNames.join(",")}&subCode=${encodeURIComponent(selectedCourse.subCode)}`
      : null;
  const { data: studentsData } = useSWR(
    studentsUrl,
    (url: string) => fetcher<{ items: StudentOption[] }>(url),
  );
  const candidates = studentsData?.items ?? [];
  const [checkedRolls, setCheckedRolls] = useState<Set<string> | null>(null);
  const effectiveChecked =
    checkedRolls ?? new Set(candidates.map((c) => c.roll));

  const [studentSearch, setStudentSearch] = useState("");
  const visibleCandidates = candidates.filter((c) => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || c.roll.toLowerCase().includes(q);
  });

  const toggleStudent = (roll: string, checked: boolean) => {
    const next = new Set(effectiveChecked);
    if (checked) next.add(roll);
    else next.delete(roll);
    setCheckedRolls(next);
  };

  // Check all / Uncheck all only ever act on the currently visible
  // (searched) rows - same convention as the admin section-member pickers -
  // so searching "PE31" then "Check all" doesn't silently re-check students
  // who scrolled out of view under an earlier, different search term.
  const checkAllStudents = () => {
    const next = new Set(effectiveChecked);
    visibleCandidates.forEach((c) => next.add(c.roll));
    setCheckedRolls(next);
  };
  const uncheckAllStudents = () => {
    const next = new Set(effectiveChecked);
    visibleCandidates.forEach((c) => next.delete(c.roll));
    setCheckedRolls(next);
  };

  useEffect(() => {
    setCourseCode("");
  }, [facultyRoll]);

  useEffect(() => {
    setCheckedRolls(null);
    setStudentSearch("");
  }, [courseCode, activeSectionNames.join(",")]);

  const handleSubmit = async () => {
    if (role === "admin" && !facultyRoll) {
      toast.error("Select which faculty member this quiz is for");
      return;
    }
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    const course = courses.find((c) => c.subCode === courseCode);
    if (!course) {
      toast.error("Select a course");
      return;
    }
    if (activeSectionNames.length === 0) {
      toast.error("Select at least one section for this quiz");
      return;
    }
    if (!buildingId) {
      toast.error("Select a building");
      return;
    }
    const duration = Number(durationMinutes);
    if (!Number.isFinite(duration) || duration <= 0) {
      toast.error("Duration must be a positive number of minutes");
      return;
    }

    setSubmitting(true);
    try {
      const quiz = await apiClient.post<{ id: number }>("/api/faculty/quiz", {
        ...(role === "admin" ? { facultyRoll } : {}),
        title: title.trim(),
        courseCode: course.subCode,
        sectionNames: activeSectionNames,
        buildingId: Number(buildingId),
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        durationMinutes: duration,
        totalMarks: 1,
        randomize,
        negativeMarking,
        allowSkipSwitch,
        requireLocation,
        status: "draft",
      });

      const studentRolls = [...effectiveChecked];
      if (studentRolls.length > 0) {
        await apiClient.post(`/api/faculty/quiz/${quiz.id}/allot`, {
          studentRolls,
        });
        toast.success(
          `Quiz created and ${studentRolls.length} student(s) allotted - now add questions`,
        );
      } else {
        toast.success("Quiz created - now add questions and allot students");
      }
      router.push(
        `${role === "faculty" ? "/faculty/quizzes" : "/admin/tests"}/${quiz.id}`,
      );
    } catch (error) {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : "Failed to create quiz",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quiz Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {role === "admin" && (
          <div className="space-y-1.5">
            <Label>Faculty</Label>
            <SearchableSelect
              value={facultyRoll || null}
              onValueChange={setFacultyRoll}
              options={(facultyData?.items ?? []).map((f) => ({
                value: f.roll,
                label: `${f.name} (${f.roll})`,
              }))}
              placeholder="Select the faculty member this quiz is for"
              searchPlaceholder="Search faculty..."
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Unit 1 Quiz"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Course</Label>
            <SearchableSelect
              value={courseCode || null}
              onValueChange={setCourseCode}
              disabled={role === "admin" && !facultyRoll}
              options={courses.map((c) => ({
                value: c.subCode,
                label: `${c.title ?? c.subCode} (${c.subCode})`,
              }))}
              placeholder={coursesLoading ? "Loading..." : "Select a course"}
              searchPlaceholder="Search courses..."
            />
            {coursesData && courses.length === 0 && !coursesLoading && (
              <p className="text-xs text-muted-foreground">
                No courses mapped to this faculty member yet - ask an admin to
                add one under Mapping → Faculty ↔ Course/Section.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Building</Label>
            <SearchableSelect
              value={buildingId || null}
              onValueChange={setBuildingId}
              options={buildings.map((b) => ({ value: String(b.id), label: b.name }))}
              placeholder="Select a building"
              searchPlaceholder="Search buildings..."
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Sections</Label>
          {!courseCode && (
            <p className="text-xs text-muted-foreground">
              Select a course first.
            </p>
          )}
          {courseCode && sections.length === 0 && (
            <p className="p-2 text-xs text-muted-foreground">
              No sections found for this course yet - ask an admin to check
              the mapping under Mapping → Faculty ↔ Course/Section.
            </p>
          )}
          {courseCode && sections.length > 0 && (
            <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border p-3">
              {sections.map((section) => (
                <div key={section.name} className="flex items-center gap-2">
                  <Checkbox
                    checked={activeSectionNames.includes(section.name)}
                    onCheckedChange={(checked) => {
                      setSelectedSectionNames((prev) => {
                        if (checked === true) {
                          return prev.includes(section.name)
                            ? prev
                            : [...prev, section.name];
                        }
                        return prev.filter((name) => name !== section.name);
                      });
                    }}
                    id={`section-${section.name}`}
                  />
                  <label htmlFor={`section-${section.name}`} className="text-sm">
                    {section.name}
                  </label>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="startTime">Start Time</Label>
            <Input
              id="startTime"
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="endTime">End Time</Label>
            <Input
              id="endTime"
              type="datetime-local"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="durationMinutes">Duration (minutes)</Label>
            <Input
              id="durationMinutes"
              type="number"
              min={1}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="randomize" className="cursor-pointer">
              Randomize order
            </Label>
            <Switch
              id="randomize"
              checked={randomize}
              onCheckedChange={setRandomize}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="negativeMarking" className="cursor-pointer">
              Negative marking
            </Label>
            <Switch
              id="negativeMarking"
              checked={negativeMarking}
              onCheckedChange={setNegativeMarking}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="allowSkipSwitch" className="cursor-pointer">
              Allow skip/switch
            </Label>
            <Switch
              id="allowSkipSwitch"
              checked={allowSkipSwitch}
              onCheckedChange={setAllowSkipSwitch}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="requireLocation" className="cursor-pointer">
              Require GPS
            </Label>
            <Switch
              id="requireLocation"
              checked={requireLocation}
              onCheckedChange={setRequireLocation}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>Allot Students ({effectiveChecked.size} selected)</Label>
            {candidates.length > 0 && (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={checkAllStudents}
                  disabled={visibleCandidates.every((c) => effectiveChecked.has(c.roll))}
                >
                  Check all
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={uncheckAllStudents}
                  disabled={visibleCandidates.every((c) => !effectiveChecked.has(c.roll))}
                >
                  Uncheck all
                </Button>
              </div>
            )}
          </div>
          {candidates.length > 0 && (
            <Input
              placeholder="Search students by name or roll..."
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
            />
          )}
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
            {!courseCode && (
              <p className="p-2 text-xs text-muted-foreground">
                Select a course first.
              </p>
            )}
            {courseCode && sections.length === 0 && (
              <p className="p-2 text-xs text-muted-foreground">
                No sections linked to this course yet - ask an admin to add one
                under Master Data → Sections.
              </p>
            )}
            {courseCode && sections.length > 0 && candidates.length === 0 && (
              <p className="p-2 text-xs text-muted-foreground">
                No students found in this course&apos;s section(s) yet.
              </p>
            )}
            {candidates.length > 0 && visibleCandidates.length === 0 && (
              <p className="p-2 text-xs text-muted-foreground">No students match &quot;{studentSearch}&quot;.</p>
            )}
            {visibleCandidates.map((c) => (
              <div
                key={c.roll}
                className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
              >
                <Checkbox
                  checked={effectiveChecked.has(c.roll)}
                  onCheckedChange={(checked) =>
                    toggleStudent(c.roll, checked === true)
                  }
                  id={`student-${c.roll}`}
                />
                <label htmlFor={`student-${c.roll}`} className="text-sm">
                  {c.name}{" "}
                  <span className="text-muted-foreground">({c.roll})</span>
                </label>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Total marks are calculated automatically as questions are added on the
          next step.
        </p>

        <div className="flex justify-end">
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Creating..." : "Create Quiz & Add Questions"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
