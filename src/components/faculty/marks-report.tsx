"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiClient, downloadFile } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { MultiSelect } from "@/components/ui/multi-select";
import { format } from "@/lib/format-date";
import { FileSpreadsheet } from "lucide-react";

interface MatrixResponse {
  quizzes: { id: number; title: string; date: string; totalMarks: number }[];
  maxTotal: number;
  rows: {
    roll: string;
    name: string;
    totalQuizzes: number;
    attended: number;
    attendancePercent: number;
    marks: (number | string | null)[];
    total: number;
  }[];
  students: { roll: string; name: string }[];
  filterOptions: {
    courses: { code: string; name: string }[];
    sections: { courseCode: string; name: string }[];
  };
}

const fetcher = (url: string) => apiClient.get<MatrixResponse>(url);

export function MarksReport() {
  const [courseCode, setCourseCode] = useState("all");
  const [sectionNames, setSectionNames] = useState<string[]>([]);
  const [studentRolls, setStudentRolls] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // Filters apply on Generate Report, not on every change.
  const [applied, setApplied] = useState<string | null>(null);

  const buildParams = (withStudents: boolean) => {
    const params = new URLSearchParams();
    if (courseCode !== "all") params.set("courseCode", courseCode);
    if (sectionNames.length) params.set("sectionNames", sectionNames.join(","));
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (withStudents && studentRolls.length) params.set("studentRolls", studentRolls.join(","));
    return params;
  };

  // Option lists follow the current course/section/date choices, before Generate is pressed.
  const { data: options } = useSWR(`/api/faculty/reports/marks-matrix?${buildParams(false)}`, fetcher);
  const { data, isLoading } = useSWR(applied === null ? null : `/api/faculty/reports/marks-matrix?${applied}`, fetcher);

  const courses = options?.filterOptions.courses ?? [];
  const sectionOptions = [
    ...new Set(
      (options?.filterOptions.sections ?? [])
        .filter((s) => courseCode === "all" || s.courseCode === courseCode)
        .map((s) => s.name),
    ),
  ].sort();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Marks Report</h1>
        <p className="text-sm text-muted-foreground">
          Every completed quiz in the chosen date range as a column, with each student&apos;s attendance and total marks. AB = absent.
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
                setSectionNames([]);
                setStudentRolls([]);
              }}
              options={[
                { value: "all", label: "All courses" },
                ...courses.map((c) => ({ value: c.code, label: `${c.name} (${c.code})` })),
              ]}
              searchPlaceholder="Search courses..."
            />
          </div>
          <div className="space-y-1.5">
            <Label>Sections</Label>
            <MultiSelect
              values={sectionNames}
              onValuesChange={(values) => {
                setSectionNames(values);
                setStudentRolls([]);
              }}
              options={sectionOptions.map((name) => ({ value: name, label: name }))}
              placeholder="All sections"
              searchPlaceholder="Search sections..."
            />
          </div>
          <div className="space-y-1.5">
            <Label>Students</Label>
            <MultiSelect
              values={studentRolls}
              onValuesChange={setStudentRolls}
              options={(options?.students ?? []).map((s) => ({ value: s.roll, label: `${s.name} (${s.roll})` }))}
              placeholder="All students"
              searchPlaceholder="Search name or roll..."
            />
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
            <Button onClick={() => setApplied(buildParams(true).toString())}>Generate Report</Button>
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
                <th className="px-3 py-2 text-left" colSpan={5}>Quiz Details</th>
                {data.quizzes.map((q) => (
                  <th key={q.id} className="px-3 py-2 text-center">{q.title}</th>
                ))}
                <th className="px-3 py-2 text-center">Total</th>
              </tr>
              <tr>
                <th className="px-3 py-1 text-left font-normal" colSpan={5}>Quiz Date</th>
                {data.quizzes.map((q) => (
                  <th key={q.id} className="px-3 py-1 text-center font-normal">{format(q.date)}</th>
                ))}
                <th />
              </tr>
              <tr>
                <th className="px-3 py-1 text-left font-normal" colSpan={5}>Max Marks</th>
                {data.quizzes.map((q) => (
                  <th key={q.id} className="px-3 py-1 text-center font-normal">{q.totalMarks}</th>
                ))}
                <th className="px-3 py-1 text-center">{data.maxTotal}</th>
              </tr>
              <tr className="border-t">
                <th className="px-3 py-2 text-left">Roll Number</th>
                <th className="px-3 py-2 text-left">Student Name</th>
                <th className="px-3 py-2 text-center">Total Quizzes</th>
                <th className="px-3 py-2 text-center">Quizzes Attended</th>
                <th className="px-3 py-2 text-center">Attendance %</th>
                <th colSpan={data.quizzes.length + 1} />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.roll} className="border-t">
                  <td className="px-3 py-2">{r.roll}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-center">{r.totalQuizzes}</td>
                  <td className="px-3 py-2 text-center">{r.attended}</td>
                  <td className="px-3 py-2 text-center">{r.attendancePercent}%</td>
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
