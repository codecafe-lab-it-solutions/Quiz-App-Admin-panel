"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DataTable, DataTableColumn } from "@/components/admin/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { SearchableSelect, SearchableSelectOption } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BookOpen, Plus, Users } from "lucide-react";

interface SectionCourse {
  id: number;
  subCode: string;
  courseTitle: string;
  facRoll: string;
  facultyName: string | null;
}

interface Section {
  name: string;
  major: string;
  sem: string;
  studentCount: number;
  courses: SectionCourse[];
}

interface ListResponse {
  items: Section[];
  currentSubList: string;
}

interface FacultyOption {
  roll: string;
  name: string;
}

interface CourseOption {
  code: string;
  title: string;
}

interface BranchSemOption {
  branch: string;
  sem: string;
  major: string;
}

interface StudentCandidate {
  roll: string;
  name: string;
  batch: string | null;
  status: "eligible" | "already_registered" | "no_batch_table";
}

interface CandidatesResponse {
  items: StudentCandidate[];
  major: string;
  sem: string;
}

interface SplitSectionStudent {
  roll: string;
  name: string;
}

interface SplitSection {
  section: string;
  facRoll: string;
  facultyName: string | null;
  students: SplitSectionStudent[];
}

interface SplitCandidatesResponse {
  items: SplitSection[];
}

interface SplitMoveResult {
  movedCount: number;
  keptBothCount: number;
  skipped: { roll: string; reason: string }[];
}

const fetcher = (url: string) => apiClient.get<ListResponse>(url);
const facultyFetcher = (url: string) => apiClient.get<{ items: FacultyOption[] }>(url);
const courseFetcher = (url: string) => apiClient.get<{ items: CourseOption[] }>(url);
const branchSemFetcher = (url: string) => apiClient.get<{ items: BranchSemOption[] }>(url);
const candidatesFetcher = (url: string) => apiClient.get<CandidatesResponse>(url);
const splitCandidatesFetcher = (url: string) => apiClient.get<SplitCandidatesResponse>(url);

const schema = z.object({
  facRoll: z.string().trim().min(1, "Faculty is required"),
  subCode: z.string().trim().min(1, "Course is required"),
  branch: z.string().trim().min(1, "Branch is required"),
  sem: z.string().trim().min(1, "Semester is required"),
});
type FormValues = z.infer<typeof schema>;

interface AllotmentResult {
  registeredCount: number;
  alreadyRegisteredCount: number;
  skippedNoBatchCount: number;
}

const STATUS_LABEL: Record<StudentCandidate["status"], string> = {
  eligible: "Will be allotted",
  already_registered: "Already registered",
  no_batch_table: "No registration table for this batch",
};

export default function SectionsPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [viewingSection, setViewingSection] = useState<Section | null>(null);
  const [selectedRolls, setSelectedRolls] = useState<Set<string>>(new Set());
  const [showOthers, setShowOthers] = useState(false);
  const [mode, setMode] = useState<"branch" | "split">("branch");

  // Split-mode ("Split Existing Sections") state - kept separate from the
  // react-hook-form-driven branch/semester flow above since the two modes
  // share almost no fields (a new section name typed directly instead of
  // derived, and a per-student "which existing section did this pick come
  // from" map instead of a plain roll set).
  const [splitSectionName, setSplitSectionName] = useState("");
  const [splitFacRoll, setSplitFacRoll] = useState("");
  const [splitFacLabel, setSplitFacLabel] = useState("");
  const [splitFacSearch, setSplitFacSearch] = useState("");
  const [splitSubCode, setSplitSubCode] = useState("");
  const [splitCourseLabel, setSplitCourseLabel] = useState("");
  const [splitCourseSearch, setSplitCourseSearch] = useState("");
  const [splitSelections, setSplitSelections] = useState<Map<string, string>>(new Map());

  const { data, isLoading, mutate } = useSWR("/api/admin/sections", fetcher);

  const {
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });
  const facRoll = watch("facRoll");
  const subCode = watch("subCode");
  const branch = watch("branch");
  const sem = watch("sem");

  // Faculty dropdown - server-searched, real isr_faculty_tbl rolls only.
  const [facSearch, setFacSearch] = useState("");
  const [facLabel, setFacLabel] = useState("");
  const facSearchDebounced = useDebouncedValue(facSearch, 250);
  const { data: facData, isLoading: facLoading } = useSWR(
    dialogOpen
      ? `/api/admin/faculty?search=${encodeURIComponent(facSearchDebounced)}&pageSize=20`
      : null,
    facultyFetcher,
  );
  const facOptions: SearchableSelectOption[] = (facData?.items ?? []).map((f) => ({
    value: f.roll,
    label: `${f.name} (${f.roll})`,
  }));

  // Course dropdown - server-searched, same real catalog Faculty <-> Course
  // mapping uses.
  const [courseSearch, setCourseSearch] = useState("");
  const [courseLabel, setCourseLabel] = useState("");
  const courseSearchDebounced = useDebouncedValue(courseSearch, 250);
  const { data: courseData, isLoading: courseLoading } = useSWR(
    dialogOpen
      ? `/api/admin/mapping/faculty-course-section/courses?search=${encodeURIComponent(courseSearchDebounced)}&pageSize=20`
      : null,
    courseFetcher,
  );
  const courseOptions: SearchableSelectOption[] = (courseData?.items ?? []).map((c) => ({
    value: c.code,
    label: c.title === c.code ? c.code : `${c.code} - ${c.title}`,
  }));

  // Branch/Semester dropdowns - scoped to whichever course was picked, so
  // only real (branch, sem) combinations that course is actually offered as
  // are selectable.
  const { data: branchSemData } = useSWR(
    dialogOpen && subCode
      ? `/api/admin/mapping/faculty-course-section/branch-options?subCode=${encodeURIComponent(subCode)}`
      : null,
    branchSemFetcher,
  );
  const branchSemOptions = branchSemData?.items ?? [];

  const [branchSearch, setBranchSearch] = useState("");
  const distinctBranches = [...new Map(branchSemOptions.map((o) => [o.branch, o])).values()];
  const branchOptions: SearchableSelectOption[] = distinctBranches
    .filter((o) => o.branch.toLowerCase().includes(branchSearch.trim().toLowerCase()))
    .map((o) => ({
      value: o.branch,
      label: o.branch,
      description: o.major !== o.branch ? `→ ${o.major}` : undefined,
    }));

  const [semSearch, setSemSearch] = useState("");
  const semOptionsForBranch = branchSemOptions.filter((o) => o.branch === branch);
  const semOptions: SearchableSelectOption[] = semOptionsForBranch
    .filter((o) => o.sem.includes(semSearch.trim()))
    .map((o) => ({ value: o.sem, label: `Semester ${o.sem}` }));

  const selectedMajor = branchSemOptions.find((o) => o.branch === branch && o.sem === sem)?.major ?? null;
  const sectionName = selectedMajor && sem ? `${selectedMajor}_${sem}` : null;

  // Live candidate list for the picked course+branch+semester - who's
  // actually a real member of this section, and whether they'd be newly
  // allotted, are already registered, or can't be (no batch table).
  const { data: candidatesData, isLoading: candidatesLoading } = useSWR(
    dialogOpen && subCode && branch && sem
      ? `/api/admin/sections/candidates?subCode=${encodeURIComponent(subCode)}&branch=${encodeURIComponent(branch)}&sem=${encodeURIComponent(sem)}`
      : null,
    candidatesFetcher,
  );
  const candidates = candidatesData?.items ?? [];
  const eligibleCandidates = candidates.filter((c) => c.status === "eligible");
  const alreadyRegisteredCandidates = candidates.filter((c) => c.status === "already_registered");
  const noTableCandidates = candidates.filter((c) => c.status === "no_batch_table");

  // Default selection: every eligible student, reset whenever the candidate
  // list itself changes (new course/branch/semester picked).
  useEffect(() => {
    setSelectedRolls(new Set(eligibleCandidates.map((c) => c.roll)));
    setShowOthers(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidatesData]);

  // Split-mode Faculty dropdown - same server-searched faculty list as the
  // branch/semester flow above, just bound to its own field.
  const splitFacSearchDebounced = useDebouncedValue(splitFacSearch, 250);
  const { data: splitFacData, isLoading: splitFacLoading } = useSWR(
    dialogOpen && mode === "split"
      ? `/api/admin/faculty?search=${encodeURIComponent(splitFacSearchDebounced)}&pageSize=20`
      : null,
    facultyFetcher,
  );
  const splitFacOptions: SearchableSelectOption[] = (splitFacData?.items ?? []).map((f) => ({
    value: f.roll,
    label: `${f.name} (${f.roll})`,
  }));

  // Split-mode Course dropdown - scoped to courses the picked faculty already
  // has a real mapping row for, not the full catalog.
  const splitCourseSearchDebounced = useDebouncedValue(splitCourseSearch, 250);
  const { data: splitCourseData, isLoading: splitCourseLoading } = useSWR(
    dialogOpen && mode === "split" && splitFacRoll
      ? `/api/admin/sections/faculty-courses?facRoll=${encodeURIComponent(splitFacRoll)}`
      : null,
    courseFetcher,
  );
  const splitCourseOptions: SearchableSelectOption[] = (splitCourseData?.items ?? [])
    .filter((c) =>
      splitCourseSearch.trim()
        ? c.code.toLowerCase().includes(splitCourseSearch.trim().toLowerCase()) ||
          c.title.toLowerCase().includes(splitCourseSearch.trim().toLowerCase())
        : true,
    )
    .map((c) => ({
      value: c.code,
      label: c.title === c.code ? c.code : `${c.code} - ${c.title}`,
    }));

  // Every existing section of the picked course, each with its live roster -
  // the pool this new section's students get hand-picked out of.
  const { data: splitCandidatesData, isLoading: splitCandidatesLoading } = useSWR(
    dialogOpen && mode === "split" && splitSubCode
      ? `/api/admin/sections/split-candidates?subCode=${encodeURIComponent(splitSubCode)}`
      : null,
    splitCandidatesFetcher,
  );
  const splitSections = splitCandidatesData?.items ?? [];

  const existingSectionNames = new Set((data?.items ?? []).map((s) => s.name.toLowerCase()));
  const trimmedSplitSectionName = splitSectionName.trim();
  const splitSectionNameTaken =
    trimmedSplitSectionName.length > 0 && existingSectionNames.has(trimmedSplitSectionName.toLowerCase());

  const toggleSplitStudent = (roll: string, section: string) => {
    setSplitSelections((prev) => {
      const next = new Map(prev);
      if (next.get(roll) === section) next.delete(roll);
      else next.set(roll, section);
      return next;
    });
  };

  const onSplitSubmit = async () => {
    if (!trimmedSplitSectionName) {
      toast.error("Section name is required");
      return;
    }
    if (splitSectionNameTaken) {
      toast.error(`A section named "${trimmedSplitSectionName}" already exists`);
      return;
    }
    if (!splitFacRoll) {
      toast.error("Faculty is required");
      return;
    }
    if (!splitSubCode) {
      toast.error("Course is required");
      return;
    }
    if (splitSelections.size === 0) {
      toast.error("Pick at least one student to move");
      return;
    }

    setSubmitting(true);
    try {
      const moves = [...splitSelections.entries()].map(([roll, fromSection]) => ({ roll, fromSection }));
      const result = await apiClient.post<{ moveResult: SplitMoveResult }>("/api/admin/sections/split", {
        facRoll: splitFacRoll,
        subCode: splitSubCode,
        sectionName: trimmedSplitSectionName,
        moves,
      });
      const { movedCount, keptBothCount, skipped } = result.moveResult;
      const parts = [`${movedCount} student${movedCount === 1 ? "" : "s"} moved`];
      if (keptBothCount > 0) {
        parts.push(`${keptBothCount} kept in their old section too (shared with another course)`);
      }
      if (skipped.length > 0) {
        parts.push(`${skipped.length} skipped`);
      }
      toast.success(`Section created — ${parts.join(", ")}`);
      setDialogOpen(false);
      mutate();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Failed to create section");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleRoll = (roll: string) => {
    setSelectedRolls((prev) => {
      const next = new Set(prev);
      if (next.has(roll)) next.delete(roll);
      else next.add(roll);
      return next;
    });
  };

  const allEligibleSelected =
    eligibleCandidates.length > 0 && eligibleCandidates.every((c) => selectedRolls.has(c.roll));
  const toggleSelectAll = () => {
    setSelectedRolls(allEligibleSelected ? new Set() : new Set(eligibleCandidates.map((c) => c.roll)));
  };

  const openCreate = () => {
    reset({ facRoll: "", subCode: "", branch: "", sem: "" });
    setFacSearch("");
    setFacLabel("");
    setCourseSearch("");
    setCourseLabel("");
    setBranchSearch("");
    setSemSearch("");
    setSelectedRolls(new Set());
    setShowOthers(false);
    setMode("branch");
    setSplitSectionName("");
    setSplitFacRoll("");
    setSplitFacLabel("");
    setSplitFacSearch("");
    setSplitSubCode("");
    setSplitCourseLabel("");
    setSplitCourseSearch("");
    setSplitSelections(new Map());
    setDialogOpen(true);
  };

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const result = await apiClient.post<{ allotment: AllotmentResult }>("/api/admin/sections", {
        ...values,
        rolls: [...selectedRolls],
      });
      const { registeredCount, alreadyRegisteredCount } = result.allotment;
      toast.success(
        `Section created — ${registeredCount} student${registeredCount === 1 ? "" : "s"} allotted` +
          (alreadyRegisteredCount > 0 ? ` (${alreadyRegisteredCount} already registered)` : ""),
      );
      setDialogOpen(false);
      mutate();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Failed to create section");
    } finally {
      setSubmitting(false);
    }
  };

  const columns: DataTableColumn<Section>[] = [
    {
      key: "name",
      header: "Section",
      render: (r) => <span className="font-medium">{r.name}</span>,
    },
    { key: "major", header: "Major", render: (r) => r.major },
    { key: "sem", header: "Semester", render: (r) => r.sem },
    {
      key: "studentCount",
      header: "Students",
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-muted-foreground" />
          {r.studentCount}
        </span>
      ),
    },
    {
      key: "courses",
      header: "Courses & Faculty",
      render: (r) => (
        <Button variant="outline" size="sm" onClick={() => setViewingSection(r)}>
          <BookOpen className="mr-2 h-3.5 w-3.5" />
          {r.courses.length} course{r.courses.length === 1 ? "" : "s"}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sections</h1>
          <p className="text-sm text-muted-foreground">
            Every real section (Major_Semester) offered this cycle, with how many students belong
            to it and which courses/faculty it's mapped to.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data?.currentSubList && (
            <Badge variant="secondary">Showing: {data.currentSubList}</Badge>
          )}
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Create Section
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Sections</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(r) => r.name}
            loading={isLoading}
            emptyMessage="No sections yet. Create one to get started."
          />
        </CardContent>
      </Card>

      {/* Courses & faculty for one section - kept out of the main table so a
          section with a dozen+ courses doesn't turn every row into a wall of
          badges. */}
      <Dialog open={viewingSection != null} onOpenChange={(open) => !open && setViewingSection(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewingSection?.name} - Courses & Faculty</DialogTitle>
            <DialogDescription>
              Every course this section is mapped to, and who teaches it.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {viewingSection?.courses.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-md border p-2.5 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">{c.courseTitle}</p>
                  <p className="text-xs text-muted-foreground">{c.subCode}</p>
                </div>
                <Badge variant="secondary" className="shrink-0 font-normal">
                  {c.facultyName ?? c.facRoll}
                </Badge>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingSection(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Section</DialogTitle>
            <DialogDescription>
              {mode === "branch" ? (
                <>
                  Maps a faculty to a course for a branch/semester
                  {data?.currentSubList ? ` (${data.currentSubList})` : ""} - pick which real students
                  in that Major_Semester get registered for the course. Every field is picked from
                  real data - nothing typed.
                </>
              ) : (
                <>
                  Name a new section and hand-pick students out of a course&apos;s existing sections
                  to move into it. Each moved student&apos;s section is updated, not duplicated.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-1.5 rounded-md bg-muted p-1">
            <button
              type="button"
              onClick={() => setMode("branch")}
              className={`flex-1 rounded-sm px-2.5 py-1.5 text-sm font-medium transition-colors ${
                mode === "branch" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              From Branch/Semester
            </button>
            <button
              type="button"
              onClick={() => setMode("split")}
              className={`flex-1 rounded-sm px-2.5 py-1.5 text-sm font-medium transition-colors ${
                mode === "split" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Split Existing Sections
            </button>
          </div>
          {mode === "branch" && (
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="flex-1 space-y-4 overflow-y-auto pr-1"
            noValidate
          >
            <div className="space-y-1.5">
              <Label>Faculty</Label>
              <SearchableSelect
                value={facRoll || null}
                onValueChange={(v) => {
                  setValue("facRoll", v, { shouldValidate: true });
                  setFacLabel(facOptions.find((o) => o.value === v)?.label ?? v);
                }}
                options={facOptions}
                search={facSearch}
                onSearchChange={setFacSearch}
                placeholder="Select faculty"
                searchPlaceholder="Search by name, roll, email..."
                loading={facLoading}
                emptyText="No faculty found."
              />
              {errors.facRoll && (
                <p className="text-sm text-destructive">{errors.facRoll.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Course</Label>
              <SearchableSelect
                value={subCode || null}
                onValueChange={(v) => {
                  setValue("subCode", v, { shouldValidate: true });
                  setCourseLabel(courseOptions.find((o) => o.value === v)?.label ?? v);
                  setValue("branch", "");
                  setValue("sem", "");
                  setBranchSearch("");
                  setSemSearch("");
                }}
                options={courseOptions}
                search={courseSearch}
                onSearchChange={setCourseSearch}
                placeholder="Select course"
                searchPlaceholder="Search course code or title..."
                loading={courseLoading}
                emptyText="No matching courses."
              />
              {errors.subCode && (
                <p className="text-sm text-destructive">{errors.subCode.message}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Branch</Label>
                <SearchableSelect
                  value={branch || null}
                  onValueChange={(v) => {
                    setValue("branch", v, { shouldValidate: true });
                    const matches = branchSemOptions.filter((o) => o.branch === v);
                    setValue("sem", matches.length === 1 ? matches[0].sem : "", {
                      shouldValidate: true,
                    });
                    setSemSearch("");
                  }}
                  options={branchOptions}
                  search={branchSearch}
                  onSearchChange={setBranchSearch}
                  placeholder={subCode ? "Select branch" : "Pick a course first"}
                  searchPlaceholder="Search branch..."
                  disabled={!subCode}
                  emptyText="No branches offered for this course."
                />
                {errors.branch && (
                  <p className="text-sm text-destructive">{errors.branch.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Semester</Label>
                <SearchableSelect
                  value={sem || null}
                  onValueChange={(v) => setValue("sem", v, { shouldValidate: true })}
                  options={semOptions}
                  search={semSearch}
                  onSearchChange={setSemSearch}
                  placeholder={branch ? "Select semester" : "Pick a branch first"}
                  searchPlaceholder="Search semester..."
                  disabled={!branch}
                  emptyText="No semesters found."
                />
                {errors.sem && (
                  <p className="text-sm text-destructive">{errors.sem.message}</p>
                )}
              </div>
            </div>

            {sectionName && (
              <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
                <p>
                  <span className="text-muted-foreground">Faculty:</span> {facLabel || "—"}
                </p>
                <p>
                  <span className="text-muted-foreground">Course:</span> {courseLabel || "—"}
                </p>
                <p>
                  <span className="text-muted-foreground">Section:</span>{" "}
                  <span className="font-medium">{sectionName}</span>
                </p>
              </div>
            )}

            {sectionName && !candidatesLoading && candidates.length > 0 && (
              <div className="flex flex-wrap gap-1.5 text-xs">
                <Badge variant="success" className="font-normal">
                  {eligibleCandidates.length} can be allotted
                </Badge>
                {alreadyRegisteredCandidates.length > 0 && (
                  <Badge variant="outline" className="font-normal">
                    {alreadyRegisteredCandidates.length} already registered
                  </Badge>
                )}
                {noTableCandidates.length > 0 && (
                  <Badge variant="outline" className="font-normal">
                    {noTableCandidates.length} no registration table
                  </Badge>
                )}
              </div>
            )}

            {sectionName && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Students to allot</Label>
                  {eligibleCandidates.length > 0 && (
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      {allEligibleSelected ? "Deselect all" : "Select all"}
                    </button>
                  )}
                </div>
                <div className="max-h-56 overflow-y-auto rounded-md border">
                  {candidatesLoading ? (
                    <p className="p-3 text-sm text-muted-foreground">Loading students...</p>
                  ) : candidates.length === 0 ? (
                    <p className="p-3 text-sm text-muted-foreground">
                      No real students found in this Major_Semester yet.
                    </p>
                  ) : eligibleCandidates.length === 0 ? (
                    <p className="p-3 text-sm text-muted-foreground">
                      Nobody new to allot — every real student here is either already registered
                      for this course, or their batch has no registration table on record.
                    </p>
                  ) : (
                    <div className="divide-y">
                      {eligibleCandidates.map((c) => (
                        <div
                          key={c.roll}
                          className="flex items-center gap-2.5 p-2 text-sm hover:bg-accent/50"
                        >
                          <Checkbox
                            checked={selectedRolls.has(c.roll)}
                            onCheckedChange={() => toggleRoll(c.roll)}
                          />
                          <span
                            onClick={() => toggleRoll(c.roll)}
                            className="min-w-0 flex-1 cursor-pointer"
                          >
                            <span className="block truncate font-medium">{c.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {c.roll} · {c.batch ?? "no batch"}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {selectedRolls.size} student{selectedRolls.size === 1 ? "" : "s"} will be
                  allotted to this course on create.
                </p>
              </div>
            )}

            {sectionName && (alreadyRegisteredCandidates.length > 0 || noTableCandidates.length > 0) && (
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setShowOthers((v) => !v)}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  {showOthers ? "Hide" : "Show"} the{" "}
                  {alreadyRegisteredCandidates.length + noTableCandidates.length} other student
                  {alreadyRegisteredCandidates.length + noTableCandidates.length === 1 ? "" : "s"} already
                  accounted for
                </button>
                {showOthers && (
                  <div className="max-h-40 overflow-y-auto rounded-md border">
                    <div className="divide-y">
                      {[...alreadyRegisteredCandidates, ...noTableCandidates].map((c) => (
                        <div key={c.roll} className="flex items-center gap-2.5 p-2 text-sm opacity-60">
                          <Checkbox checked={c.status === "already_registered"} disabled />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{c.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {c.roll} · {c.batch ?? "no batch"}
                            </span>
                          </span>
                          <Badge variant="outline" className="shrink-0 font-normal">
                            {STATUS_LABEL[c.status]}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </form>
          )}
          {mode === "split" && (
          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <Label>New section name</Label>
              <input
                type="text"
                value={splitSectionName}
                onChange={(e) => setSplitSectionName(e.target.value)}
                placeholder="e.g. CD_5_B"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              {splitSectionNameTaken && (
                <p className="text-sm text-destructive">
                  A section named &quot;{trimmedSplitSectionName}&quot; already exists.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Faculty (new section&apos;s owner)</Label>
              <SearchableSelect
                value={splitFacRoll || null}
                onValueChange={(v) => {
                  setSplitFacRoll(v);
                  setSplitFacLabel(splitFacOptions.find((o) => o.value === v)?.label ?? v);
                  setSplitSubCode("");
                  setSplitCourseLabel("");
                  setSplitCourseSearch("");
                  setSplitSelections(new Map());
                }}
                options={splitFacOptions}
                search={splitFacSearch}
                onSearchChange={setSplitFacSearch}
                placeholder="Select faculty"
                searchPlaceholder="Search by name, roll, email..."
                loading={splitFacLoading}
                emptyText="No faculty found."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Course</Label>
              <SearchableSelect
                value={splitSubCode || null}
                onValueChange={(v) => {
                  setSplitSubCode(v);
                  setSplitCourseLabel(splitCourseOptions.find((o) => o.value === v)?.label ?? v);
                  setSplitSelections(new Map());
                }}
                options={splitCourseOptions}
                search={splitCourseSearch}
                onSearchChange={setSplitCourseSearch}
                placeholder={splitFacRoll ? "Select course" : "Pick a faculty first"}
                searchPlaceholder="Search course code or title..."
                loading={splitCourseLoading}
                disabled={!splitFacRoll}
                emptyText="This faculty has no courses mapped yet."
              />
            </div>

            {splitSubCode && (
              <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
                <p>
                  <span className="text-muted-foreground">New faculty:</span> {splitFacLabel || "—"}
                </p>
                <p>
                  <span className="text-muted-foreground">Course:</span> {splitCourseLabel || "—"}
                </p>
                <p>
                  <span className="text-muted-foreground">New section:</span>{" "}
                  <span className="font-medium">{trimmedSplitSectionName || "—"}</span>
                </p>
              </div>
            )}

            {splitSubCode && (
              <div className="space-y-2">
                <Label>Pick students out of this course&apos;s existing sections</Label>
                {splitCandidatesLoading ? (
                  <p className="text-sm text-muted-foreground">Loading sections...</p>
                ) : splitSections.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No existing sections found for this course yet.
                  </p>
                ) : (
                  splitSections.map((s) => (
                    <div key={s.section} className="space-y-1 rounded-md border">
                      <div className="flex items-center justify-between border-b bg-muted/40 px-2.5 py-1.5 text-xs font-medium">
                        <span>{s.section}</span>
                        <span className="text-muted-foreground">
                          {s.facultyName ?? s.facRoll} · {s.students.length} student
                          {s.students.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="max-h-40 overflow-y-auto">
                        {s.students.length === 0 ? (
                          <p className="p-2 text-sm text-muted-foreground">No students in this section.</p>
                        ) : (
                          <div className="divide-y">
                            {s.students.map((st) => (
                              <div
                                key={st.roll}
                                className="flex items-center gap-2.5 p-2 text-sm hover:bg-accent/50"
                              >
                                <Checkbox
                                  checked={splitSelections.get(st.roll) === s.section}
                                  onCheckedChange={() => toggleSplitStudent(st.roll, s.section)}
                                />
                                <span
                                  onClick={() => toggleSplitStudent(st.roll, s.section)}
                                  className="min-w-0 flex-1 cursor-pointer"
                                >
                                  <span className="block truncate font-medium">{st.name}</span>
                                  <span className="block truncate text-xs text-muted-foreground">{st.roll}</span>
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
                <p className="text-xs text-muted-foreground">
                  {splitSelections.size} student{splitSelections.size === 1 ? "" : "s"} will be moved
                  into the new section on create.
                </p>
              </div>
            )}
          </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            {mode === "branch" ? (
              <Button type="button" onClick={handleSubmit(onSubmit)} disabled={submitting}>
                {submitting ? "Creating..." : "Create & Allot Students"}
              </Button>
            ) : (
              <Button type="button" onClick={onSplitSubmit} disabled={submitting}>
                {submitting ? "Creating..." : "Create & Move Students"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
