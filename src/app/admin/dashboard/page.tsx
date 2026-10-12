"use client";

import useSWR from "swr";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";
import { KpiCard } from "@/components/admin/kpi-card";
import { LiveTrackingBoard } from "@/components/admin/live-tracking-board";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, GraduationCap, Radio, CalendarCheck, ArrowRight } from "lucide-react";

interface DashboardSummary {
  totalFaculty: number;
  totalStudents: number;
  liveQuizCount: number;
  todayAttendancePercentage: number;
  todayPresentCount: number;
  todayAbsentCount: number;
}

const fetcher = (url: string) => apiClient.get<DashboardSummary>(url);

export default function AdminDashboardPage() {
  const { data, isLoading } = useSWR("/api/admin/dashboard/summary", fetcher, {
    refreshInterval: 30000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Overview of quizzes and attendance.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Total Faculty"
          value={isLoading ? "…" : data?.totalFaculty ?? 0}
          icon={GraduationCap}
          hint="Active faculty accounts"
        />
        <KpiCard
          title="Total Students"
          value={isLoading ? "…" : data?.totalStudents ?? 0}
          icon={Users}
          hint="Active student accounts"
        />
        <KpiCard
          title="Quizzes Running Now"
          value={isLoading ? "…" : data?.liveQuizCount ?? 0}
          icon={Radio}
          accent="destructive"
          hint="Currently live quizzes"
        />
        <KpiCard
          title="Today's Attendance"
          value={isLoading ? "…" : `${data?.todayAttendancePercentage ?? 0}%`}
          icon={CalendarCheck}
          accent="success"
          hint={
            isLoading
              ? undefined
              : `${data?.todayPresentCount ?? 0} present · ${data?.todayAbsentCount ?? 0} absent`
          }
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Live Tracking</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/reports/live-tracking">
              View full report <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          <LiveTrackingBoard compact />
        </CardContent>
      </Card>
    </div>
  );
}
