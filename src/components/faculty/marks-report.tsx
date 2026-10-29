"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiClient, downloadFile } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { format } from "@/lib/format-date";
import { FileSpreadsheet } from "lucide-react";

interface MatrixResponse {
  quizzes: { id: number; title: string; date: string; totalMarks: number }[];
  maxTotal: number;
  rows: { roll: string; name: string; marks: (number | string | null)[]; total: number }[];
  filterOptions: { courses: { code: string; name: string }[]; sections: { courseCode: string; name: string }[] };
}

const fetcher = (url: string) => apiClient.get<MatrixResponse>(url);

export function MarksReport() {
  const [courseCode, setCourseCode] = useState("all");
  const [sectionName, setSectionName] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  // Filters apply on Generate Report, not on every keystroke.
  const [applied, setApplied] = useState<string | null>(null);

  const buildParams = () => {
    const params = new URLSearchParams();
    if (courseCode !== "all") params.set("courseCode", courseCode);
    if (sectionName.trim()) params.set("sectionName", sectionName.trim());
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (search.trim()) params.set("search", search.trim());
    return params;
  };

  // Always fetched (empty filters) so the course dropdown has options before the first Generate.
  const { data, isLoading } = useSWR(`/api/faculty/reports/marks-matrix?${applied ?? ""}`, fetcher);
  const courses = data?.filterOptions.courses ?? [];
  const sectionNames = [
    ...new Set(
      (data?.filterOptions.sections ?? []).filter((s) => courseCode === "all" || s.courseCode === courseCode).map((s) => s.name),
    ),
  ].sort();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Marks Report</h1>
        <p className="text-sm text-muted-foreground">
          Every completed quiz in the chosen date range as a column, with each student&apos;s total. AB = absent.
        </p>
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
              onValueChange={(value) => {
                setCourseCode(value);
                setSectionName("");
              }}
              options={[
                { value: "all", label: "All courses" },
                ...courses.map((c) => ({ value: c.code, label: `${c.name} (${c.code})` })),
              ]}
              searchPlaceholder="Search courses..."
            />
          </div>
          <div className="space-y-1.5">
            <Label>Section</Label>
            <SearchableSelect
              value={sectionName || "all"}
              onValueChange={(value) => setSectionName(value === "all" ? "" : value)}
              options={[{ value: "all", label: "All sections" }, ...sectionNames.map((name) => ({ value: name, label: name }))]}
              searchPlaceholder="Search sections..."
            />
          </div>
          <div className="space-y-1.5">
            <Label>Student</Label>
            <Input placeholder="Name or roll number" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex gap-2 sm:col-span-5">
            <Button onClick={() => setApplied(buildParams().toString())}>Generate Report</Button>
            <Button
              variant="outline"
              disabled={applied === null}
              onClick={() => downloadFile(`/api/faculty/reports/marks-matrix?${applied}&export=excel`, "marks-report.xlsx")}
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Download Excel
            </Button>
          </div>
        </CardContent>
      </Card>

      {applied === null ? (
        <p className="text-sm text-muted-foreground">Choose filters and press Generate Report.</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data || data.quizzes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No completed quizzes match these filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left" colSpan={2}>Quiz Details</th>
                {data.quizzes.map((q) => (
                  <th key={q.id} className="px-3 py-2 text-center">{q.title}</th>
                ))}
                <th className="px-3 py-2 text-center">Total</th>
              </tr>
              <tr>
                <th className="px-3 py-1 text-left font-normal" colSpan={2}>Quiz Date</th>
                {data.quizzes.map((q) => (
                  <th key={q.id} className="px-3 py-1 text-center font-normal">{format(q.date)}</th>
                ))}
                <th />
              </tr>
              <tr>
                <th className="px-3 py-1 text-left font-normal" colSpan={2}>Max Marks</th>
                {data.quizzes.map((q) => (
                  <th key={q.id} className="px-3 py-1 text-center font-normal">{q.totalMarks}</th>
                ))}
                <th className="px-3 py-1 text-center">{data.maxTotal}</th>
              </tr>
              <tr className="border-t">
                <th className="px-3 py-2 text-left">Roll Number</th>
                <th className="px-3 py-2 text-left">Student Name</th>
                <th colSpan={data.quizzes.length + 1} />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.roll} className="border-t">
                  <td className="px-3 py-2">{r.roll}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  {r.marks.map((m, i) => (
                    <td key={data.quizzes[i].id} className="px-3 py-2 text-center">{m ?? "—"}</td>
                  ))}
                  <td className="px-3 py-2 text-center font-semibold">{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
