"use client";

import { useState } from "react";
import useSWR from "swr";
import { format, todayInputValue } from "@/lib/format-date";
import { apiClient, downloadFile } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { DataTable, DataTableColumn } from "@/components/admin/data-table";
import { PaginationBar, usePageSize } from "@/components/admin/pagination-bar";
import { FileSpreadsheet, FileText } from "lucide-react";

interface StudentResult {
  id: number;
  marksObtained: number;
  percentage: number;
  publishedAt: string | null;
  quiz: {
    id: number;
    title: string;
    totalMarks: number;
    courseCode: string;
    courseName: string;
    sectionNames: string;
  };
}

interface CourseFilterOption {
  code: string;
  name: string;
}

interface SectionFilterOption {
  name: string;
}

interface ResultsResponse {
  items: StudentResult[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
  filterOptions: { courses: CourseFilterOption[]; sections: SectionFilterOption[] };
}

export function StudentResults() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize();
  const [courseCode, setCourseCode] = useState("all");
  const [sectionName, setSectionName] = useState("all");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState(todayInputValue());
  const [to, setTo] = useState(todayInputValue());
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const buildParams = (extra?: Record<string, string>) => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (courseCode !== "all") params.set("courseCode", courseCode);
    if (sectionName !== "all") params.set("sectionName", sectionName);
    if (search) params.set("search", search);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("sortOrder", sortOrder);
    if (extra) Object.entries(extra).forEach(([k, v]) => params.set(k, v));
    return params;
  };

  const { data, isLoading } = useSWR(`/api/student/results?${buildParams().toString()}`, (url: string) =>
    apiClient.get<ResultsResponse>(url)
  );
  const results = data?.items ?? [];
  const filterOptions = data?.filterOptions ?? { courses: [], sections: [] };

  const handleExport = (type: "excel" | "pdf") => {
    const params = buildParams({ export: type });
    downloadFile(`/api/student/results?${params.toString()}`, `my-results.${type === "excel" ? "xlsx" : "pdf"}`);
  };

  const clearFilters = () => {
    setCourseCode("all");
    setSectionName("all");
    setSearch("");
    setFrom("");
    setTo("");
    setPage(1);
  };

  const columns: DataTableColumn<StudentResult>[] = [
    { key: "title", header: "Quiz", render: (r) => <span className="font-medium">{r.quiz.title}</span> },
    { key: "course", header: "Course", render: (r) => `${r.quiz.courseName} (${r.quiz.courseCode})` },
    {
      key: "section",
      header: "Section",
      render: (r) => r.quiz.sectionNames.split(",").filter(Boolean).join(", ") || "—",
    },
    { key: "marks", header: "Marks", render: (r) => `${r.marksObtained} / ${r.quiz.totalMarks}` },
    { key: "percentage", header: "Percentage", render: (r) => `${r.percentage.toFixed(2)}%` },
    { key: "publishedAt", header: "Published", render: (r) => (r.publishedAt ? format(r.publishedAt) : "—") },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Results</h1>
          <p className="text-sm text-muted-foreground">
            Published results only, showing today by default - a declared-but-unpublished result won&apos;t show here yet.
          </p>
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
            <Label>Quiz search</Label>
            <Input placeholder="Search quiz title" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
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
            <Label>Sort by published date</Label>
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
          <div className="sm:col-span-5">
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters (show all-time)
            </Button>
          </div>
        </CardContent>
      </Card>

      <DataTable columns={columns} rows={results} rowKey={(r) => r.id} loading={isLoading} emptyMessage="No results for this filter." />
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
    </div>
  );
}
