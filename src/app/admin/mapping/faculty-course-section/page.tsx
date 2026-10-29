"use client";

import { useState } from "react";
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
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DataTable, DataTableColumn } from "@/components/admin/data-table";
import { FilterBar } from "@/components/admin/filter-bar";
import { PaginationBar, usePageSize } from "@/components/admin/pagination-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { Plus, Trash2 } from "lucide-react";

interface Mapping {
  id: number;
  sem: string;
  subCode: string;
  facRoll: string;
  facultyName: string | null;
  branch: string;
  // Real major (isr_stu_main_tbl code space), resolved from `branch` -
  // isr_sub_available_tbl.branch isn't always the same value (e.g. "DCE"
  // really means major "CE") - see resolveMajorFromBranch. This is what
  // Sections are actually keyed and matched by, not the raw branch.
  major: string;
  sections: { name: string }[];
}

interface ListResponse {
  items: Mapping[];
  currentSubList: string;
  meta: { total: number; page: number; pageSize: number; totalPages: number };
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

// One entry per real isr_sub_available_tbl row for a faculty - `id` is that
// row's own id, since the same course can repeat under different branches
// (e.g. a shared elective taught to several majors), each its own section.
interface FacultyCourseEntry {
  id: number;
  subCode: string;
  title: string | null;
  branch: string | null;
  sem: string | null;
  section: string | null;
}

const fetcher = (url: string) => apiClient.get<ListResponse>(url);
const facultyFetcher = (url: string) => apiClient.get<{ items: FacultyOption[] }>(url);
const courseFetcher = (url: string) => apiClient.get<{ items: CourseOption[] }>(url);
const branchSemFetcher = (url: string) => apiClient.get<{ items: BranchSemOption[] }>(url);
const facultyCoursesFetcher = (url: string) => apiClient.get<{ items: FacultyCourseEntry[] }>(url);

const schema = z.object({
  facRoll: z.string().trim().min(1, "Faculty is required"),
  subCode: z.string().trim().min(1, "Course is required"),
  branch: z.string().trim().min(1, "Branch is required"),
  sem: z.string().trim().min(1, "Semester is required"),
});
type FormValues = z.infer<typeof schema>;

export default function FacultyMappingPage() {
  const [facultyRoll, setFacultyRoll] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (facultyRoll.trim()) params.set("facultyRoll", facultyRoll.trim());
  const { data, isLoading, mutate } = useSWR(
    `/api/admin/mapping/faculty-course-section?${params.toString()}`,
    fetcher,
  );

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

  // Course dropdown - server-searched, real curriculum/availability codes only.
  const [courseSearch, setCourseSearch] = useState("");
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
  // are selectable. Small lists (typically 1-9 rows) - filtered client-side.
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

  // Read-only "Look up Section" tool - separate from Add Mapping above.
  // Faculty -> only the courses that faculty already has a real
  // isr_sub_available_tbl row for -> the Section is read directly off that
  // exact row (isr_sub_available_tbl.section), not re-derived.
  const [lookupFacRoll, setLookupFacRoll] = useState<string | null>(null);
  const [lookupFacSearch, setLookupFacSearch] = useState("");
  const lookupFacSearchDebounced = useDebouncedValue(lookupFacSearch, 250);
  const { data: lookupFacData, isLoading: lookupFacLoading } = useSWR(
    `/api/admin/faculty?search=${encodeURIComponent(lookupFacSearchDebounced)}&pageSize=20`,
    facultyFetcher,
  );
  const lookupFacOptions: SearchableSelectOption[] = (lookupFacData?.items ?? []).map((f) => ({
    value: f.roll,
    label: `${f.name} (${f.roll})`,
  }));

  const [lookupCourseId, setLookupCourseId] = useState<string | null>(null);
  const [lookupCourseSearch, setLookupCourseSearch] = useState("");
  const { data: lookupCoursesData, isLoading: lookupCoursesLoading } = useSWR(
    lookupFacRoll ? `/api/faculty/courses?facultyRoll=${encodeURIComponent(lookupFacRoll)}` : null,
    facultyCoursesFetcher,
  );
  const lookupCourseEntries = lookupCoursesData?.items ?? [];
  const lookupCourseOptions: SearchableSelectOption[] = lookupCourseEntries
    .filter((e) =>
      `${e.subCode} ${e.title ?? ""}`.toLowerCase().includes(lookupCourseSearch.trim().toLowerCase())
    )
    .map((e) => ({
      value: String(e.id),
      label: `${e.subCode}${e.title && e.title !== e.subCode ? ` - ${e.title}` : ""} (${e.branch ?? "—"}, Sem ${e.sem ?? "—"})`,
    }));
  const selectedLookupEntry = lookupCourseEntries.find((e) => String(e.id) === lookupCourseId) ?? null;

  const handleLookupFacultyChange = (v: string) => {
    setLookupFacRoll(v);
    setLookupCourseId(null);
    setLookupCourseSearch("");
  };

  const openCreate = () => {
    reset({ facRoll: "", subCode: "", branch: "", sem: "" });
    setFacSearch("");
    setCourseSearch("");
    setBranchSearch("");
    setSemSearch("");
    setDialogOpen(true);
  };

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      await apiClient.post("/api/admin/mapping/faculty-course-section", values);
      toast.success("Mapping added");
      setDialogOpen(false);
      mutate();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Save failed",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await apiClient.delete(`/api/admin/mapping/faculty-course-section/${id}`);
      toast.success("Mapping deleted");
      mutate();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Delete failed",
      );
    }
  };

  const columns: DataTableColumn<Mapping>[] = [
    {
      key: "faculty",
      header: "Faculty",
      render: (r) => `${r.facultyName ?? "—"} (${r.facRoll})`,
    },
    { key: "subCode", header: "Course code", render: (r) => r.subCode },
    { key: "branch", header: "Branch", render: (r) => r.branch },
    { key: "major", header: "Major", render: (r) => r.major },
    { key: "sem", header: "Semester", render: (r) => r.sem },
    {
      key: "sections",
      header: "Sections",
      render: (r) =>
        r.sections.length > 0
          ? r.sections.map((section) => section.name).join(", ")
          : "—",
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (r) => (
        <ConfirmDialog
          trigger={
            <Button variant="ghost" size="icon">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          }
          title="Delete mapping?"
          description={`Remove ${r.facultyName ?? r.facRoll} from ${r.subCode}? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => handleDelete(r.id)}
        />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Faculty ↔ Course Mapping
          </h1>
          <p className="text-sm text-muted-foreground">
            Live directory synced from the university course-allocation system.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data?.currentSubList && (
            <Badge variant="secondary">Showing: {data.currentSubList}</Badge>
          )}
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Add Mapping
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Look up Section</CardTitle>
          <CardDescription>
            Pick a Faculty, then one of the courses they actually teach (per real isr_sub_available_tbl
            rows) - the Section shown is read directly off that exact row. Read-only, doesn&apos;t create
            or change anything.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Faculty</Label>
              <SearchableSelect
                value={lookupFacRoll}
                onValueChange={handleLookupFacultyChange}
                options={lookupFacOptions}
                search={lookupFacSearch}
                onSearchChange={setLookupFacSearch}
                placeholder="Select faculty"
                searchPlaceholder="Search by name, roll, email..."
                loading={lookupFacLoading}
                emptyText="No faculty found."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Course</Label>
              <SearchableSelect
                value={lookupCourseId}
                onValueChange={setLookupCourseId}
                options={lookupCourseOptions}
                search={lookupCourseSearch}
                onSearchChange={setLookupCourseSearch}
                placeholder={lookupFacRoll ? "Select course" : "Pick a faculty first"}
                searchPlaceholder="Search course code or title..."
                loading={lookupFacRoll ? lookupCoursesLoading : false}
                disabled={!lookupFacRoll}
                emptyText="This faculty has no real course mappings for the current cycle."
              />
            </div>
          </div>
          {selectedLookupEntry && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p>
                <span className="text-muted-foreground">Course:</span> {selectedLookupEntry.subCode}
                {selectedLookupEntry.title && selectedLookupEntry.title !== selectedLookupEntry.subCode
                  ? ` - ${selectedLookupEntry.title}`
                  : ""}
              </p>
              <p>
                <span className="text-muted-foreground">Branch:</span> {selectedLookupEntry.branch ?? "—"}
                {"  ·  "}
                <span className="text-muted-foreground">Semester:</span> {selectedLookupEntry.sem ?? "—"}
              </p>
              <p className="mt-1 font-medium">
                Section: {selectedLookupEntry.section ?? "— (not resolved for this row yet)"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mappings</CardTitle>
          <CardDescription>
            Filter by faculty roll number, or leave blank to see all mappings
            for the current semester.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FilterBar
            search={facultyRoll}
            onSearchChange={(v) => { setFacultyRoll(v); setPage(1); }}
            searchPlaceholder="Filter by faculty roll..."
          />
          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(r) => r.id}
            loading={isLoading}
          />
          {data?.meta && (
            <PaginationBar
              page={data.meta.page}
              totalPages={data.meta.totalPages}
              total={data.meta.total}
              pageSize={data.meta.pageSize}
              onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Mapping</DialogTitle>
            <DialogDescription>
              Maps a faculty member to a course for the current cycle
              {data?.currentSubList ? ` (${data.currentSubList})` : ""}. Every field is
              picked from real data - nothing typed.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-4"
            noValidate
          >
            <div className="space-y-1.5">
              <Label>Faculty</Label>
              <SearchableSelect
                value={facRoll || null}
                onValueChange={(v) => setValue("facRoll", v, { shouldValidate: true })}
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
            <div className="space-y-1.5">
              <Label>Section</Label>
              <p className="text-xs text-muted-foreground">
                {selectedMajor && sem
                  ? `Section: "${selectedMajor}_${sem}" - real data only, not typed.`
                  : "Pick a Branch (and Semester, if it offers more than one) to determine the section."}
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
