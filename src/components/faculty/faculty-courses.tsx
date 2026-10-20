"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, DataTableColumn } from "@/components/admin/data-table";
import { PaginationBar } from "@/components/admin/pagination-bar";
import { Users } from "lucide-react";

const PAGE_SIZE = 10;

function paginate<T>(rows: T[], page: number, pageSize = PAGE_SIZE) {
  const total = rows.length;
  const start = (page - 1) * pageSize;
  return { items: rows.slice(start, start + pageSize), total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

interface FacultyCourse {
  subCode: string;
  title: string | null;
  branch: string | null;
  credits: number | null;
  facRoll: string;
  facultyName: string | null;
  section: string | null;
}

interface RosterRow {
  roll: string;
  name: string;
  attendancePercent: number | null;
  lastScore: number | null;
}

export function FacultyCourses() {
  const [rosterCourse, setRosterCourse] = useState<FacultyCourse | null>(null);
  const [coursesPage, setCoursesPage] = useState(1);
  const [rosterPage, setRosterPage] = useState(1);
  const [rosterSearch, setRosterSearch] = useState("");
  const [rosterPageSize, setRosterPageSize] = useState(PAGE_SIZE);

  const { data: coursesData, isLoading: coursesLoading } = useSWR(`/api/faculty/courses`, (url: string) =>
    apiClient.get<{ items: FacultyCourse[] }>(url)
  );
  const { data: rosterData, isLoading: rosterLoading } = useSWR(
    rosterCourse
      ? `/api/faculty/courses/${encodeURIComponent(rosterCourse.subCode)}/students${
          rosterCourse.section ? `?section=${encodeURIComponent(rosterCourse.section)}` : ""
        }`
      : null,
    (url: string) => apiClient.get<{ items: RosterRow[] }>(url)
  );

  const allCourses = coursesData?.items ?? [];
  const allRoster = rosterData?.items ?? [];
  const courses = paginate(allCourses, coursesPage);
  const rosterSearchQuery = rosterSearch.trim().toLowerCase();
  const filteredRoster = rosterSearchQuery
    ? allRoster.filter(
        (r) => r.roll.toLowerCase().includes(rosterSearchQuery) || r.name.toLowerCase().includes(rosterSearchQuery)
      )
    : allRoster;
  const roster = paginate(filteredRoster, rosterPage, rosterPageSize);

  const courseColumns: DataTableColumn<FacultyCourse>[] = [
    { key: "subCode", header: "Code", render: (r) => <span className="font-medium">{r.subCode}</span> },
    { key: "title", header: "Course Name", render: (r) => r.title ?? "—" },
    { key: "section", header: "Section", render: (r) => r.section ?? "—" },
    { key: "credits", header: "Credits", render: (r) => r.credits ?? "—" },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setRosterCourse(r);
            setRosterSearch("");
            setRosterPage(1);
          }}
        >
          <Users className="mr-2 h-4 w-4" />
          View Students
        </Button>
      ),
    },
  ];

  const rosterColumns: DataTableColumn<RosterRow>[] = [
    { key: "roll", header: "Roll", render: (r) => r.roll },
    { key: "name", header: "Name", render: (r) => r.name },
    { key: "attendance", header: "Attendance", render: (r) => (r.attendancePercent === null ? "—" : `${r.attendancePercent}%`) },
    { key: "lastScore", header: "Last Score", render: (r) => (r.lastScore === null ? "—" : r.lastScore) },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Courses</h1>
        <p className="text-sm text-muted-foreground">Real course list for the current semester cycle, sourced live from the university system.</p>
      </div>

      <DataTable
        columns={courseColumns}
        rows={courses.items}
        rowKey={(r) => r.subCode}
        loading={coursesLoading}
        emptyMessage="You aren't mapped to any courses for the current semester cycle."
      />
      {allCourses.length > 0 && (
        <PaginationBar
          page={coursesPage}
          totalPages={courses.totalPages}
          total={courses.total}
          pageSize={PAGE_SIZE}
          onPageChange={setCoursesPage}
        />
      )}

      <Dialog
        open={rosterCourse !== null}
        onOpenChange={(open) => {
          if (!open) setRosterCourse(null);
          setRosterPage(1);
          setRosterSearch("");
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {rosterCourse ? `${rosterCourse.title ?? rosterCourse.subCode} (${rosterCourse.subCode})` : "Students"}
            </DialogTitle>
          </DialogHeader>
          {allRoster.length > 0 && (
            <Input
              placeholder="Search by roll or name"
              value={rosterSearch}
              onChange={(event) => {
                setRosterSearch(event.target.value);
                setRosterPage(1);
              }}
            />
          )}
          <DataTable
            columns={rosterColumns}
            rows={roster.items}
            rowKey={(r) => r.roll}
            loading={rosterLoading}
            emptyMessage={rosterSearchQuery ? "No students match your search." : "No students registered for this course yet."}
          />
          {filteredRoster.length > 0 && (
            <PaginationBar
              page={rosterPage}
              totalPages={roster.totalPages}
              total={roster.total}
              pageSize={rosterPageSize}
              onPageChange={setRosterPage}
              onPageSizeChange={(size) => {
                setRosterPageSize(size);
                setRosterPage(1);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
