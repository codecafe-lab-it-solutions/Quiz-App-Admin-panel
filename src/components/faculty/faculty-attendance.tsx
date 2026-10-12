"use client";

import { useState } from "react";
import useSWR from "swr";
import { format } from "@/lib/format-date";
import { apiClient, downloadFile } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { DataTable, DataTableColumn } from "@/components/admin/data-table";
import { PaginationBar } from "@/components/admin/pagination-bar";
import { FileSpreadsheet, FileText } from "lucide-react";

interface CourseFilterOption {
  code: string;
  name: string;
}
interface SectionFilterOption {
  name: string;
}
interface AttendanceRow {
  id: number;
  studentRoll: string;
  studentName: string;
  status: "present" | "absent";
  date: string;
  courseCode: string;
  courseName: string;
  quiz: { title: string; sectionNames: string };
  markedByFaculty?: boolean;
  markedByRoll?: string | null;
}

interface ListResponse<T> {
  items: T[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
  filterOptions: { courses: CourseFilterOption[]; sections: SectionFilterOption[] };
}

const statusVariant: Record<string, "default" | "secondary" | "success" | "warning" | "destructive" | "outline"> = {
  present: "success",
  absent: "destructive",
};

export function FacultyAttendance() {
  const [page, setPage] = useState(1);
  const [courseCode, setCourseCode] = useState("all");
  const [sectionName, setSectionName] = useState("all");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [source, setSource] = useState<"all" | "manual">("all");

  const buildParams = (extra?: Record<string, string>) => {
    const params = new URLSearchParams({ page: String(page), pageSize: "10" });
    if (courseCode !== "all") params.set("courseCode", courseCode);
    if (sectionName !== "all") params.set("sectionName", sectionName);
    if (search) params.set("search", search);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("sortOrder", sortOrder);
    if (source === "manual") params.set("markedByFaculty", "true");
    if (extra) Object.entries(extra).forEach(([k, v]) => params.set(k, v));
    return params;
  };

  const { data, isLoading } = useSWR(`/api/faculty/attendance?${buildParams().toString()}`, (url: string) =>
    apiClient.get<ListResponse<AttendanceRow>>(url)
  );
  const attendance = data?.items ?? [];
  const filterOptions = data?.filterOptions ?? { courses: [], sections: [] };

  const handleExport = (type: "excel" | "pdf") => {
    const params = buildParams({ export: type });
    downloadFile(`/api/faculty/attendance?${params.toString()}`, `attendance-report.${type === "excel" ? "xlsx" : "pdf"}`);
  };

  const columns: DataTableColumn<AttendanceRow>[] = [
    { key: "student", header: "Student", render: (r) => `${r.studentName} (${r.studentRoll})` },
    { key: "course", header: "Course", render: (r) => `${r.courseName} (${r.courseCode})` },
    {
      key: "section",
      header: "Section",
      render: (r) => r.quiz.sectionNames.split(",").filter(Boolean).join(", ") || "—",
    },
    { key: "quiz", header: "Quiz", render: (r) => r.quiz.title },
    { key: "date", header: "Date", render: (r) => format(r.date) },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <div className="flex items-center gap-1">
          <Badge variant={statusVariant[r.status]}>{r.status}</Badge>
          {r.markedByFaculty && <Badge variant="outline">Marked by faculty</Badge>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Attendance</h1>
          <p className="text-sm text-muted-foreground">Auto-marked from quiz submissions across every course you teach.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleExport("excel")}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Export Excel
          </Button>
          <Button variant="outline" onClick={() => handleExport("pdf")}>
            <FileText className="mr-2 h-4 w-4" />
            Export PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-5">
          <div className="space-y-1.5">
            <Label>Course</Label>
            <SearchableSelect
              value={courseCode}
              onValueChange={(v) => { setCourseCode(v); setPage(1); }}
              options={[
                { value: "all", label: "All courses" },
                ...filterOptions.courses.map((c) => ({ value: c.code, label: `${c.name} (${c.code})` })),
              ]}
              searchPlaceholder="Search courses..."
            />
          </div>
          <div className="space-y-1.5">
            <Label>Section</Label>
            <SearchableSelect
              value={sectionName}
              onValueChange={(v) => { setSectionName(v); setPage(1); }}
              options={[
                { value: "all", label: "All sections" },
                ...filterOptions.sections.map((s) => ({ value: s.name, label: s.name })),
              ]}
              searchPlaceholder="Search sections..."
            />
          </div>
          <div className="space-y-1.5">
            <Label>Search</Label>
            <Input placeholder="Roll / quiz" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <div className="space-y-1.5">
            <Label>From</Label>
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          </div>
          <div className="space-y-1.5">
            <Label>To</Label>
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
          </div>
          <div className="space-y-1.5">
            <Label>Source</Label>
            <SearchableSelect
              value={source}
              onValueChange={(v) => { setSource(v as "all" | "manual"); setPage(1); }}
              options={[
                { value: "all", label: "All attendance" },
                { value: "manual", label: "Marked present by faculty" },
              ]}
              searchPlaceholder="Search..."
            />
          </div>
          <div className="space-y-1.5">
            <Label>Sort by date</Label>
            <SearchableSelect
              value={sortOrder}
              onValueChange={(v) => { setSortOrder(v as "asc" | "desc"); setPage(1); }}
              options={[
                { value: "desc", label: "Newest first" },
                { value: "asc", label: "Oldest first" },
              ]}
              searchPlaceholder="Search..."
            />
          </div>
        </CardContent>
      </Card>

      <DataTable columns={columns} rows={attendance} rowKey={(r) => r.id} loading={isLoading} emptyMessage="No attendance records yet." />
      {data?.meta && (
        <PaginationBar
          page={data.meta.page}
          totalPages={data.meta.totalPages}
          total={data.meta.total}
          pageSize={data.meta.pageSize}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
