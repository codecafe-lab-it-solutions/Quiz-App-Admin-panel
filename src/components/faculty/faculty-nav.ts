import { LayoutDashboard, ClipboardList, FileBarChart, FileText } from "lucide-react";
import type { NavGroup } from "@/components/shell/nav-sidebar";

export const FACULTY_NAV_GROUPS: NavGroup[] = [
  {
    title: "Overview",
    items: [{ label: "My Courses", href: "/faculty", icon: LayoutDashboard, exact: true }],
  },
  {
    title: "Tests",
    items: [{ label: "My Quizzes", href: "/faculty/quizzes", icon: ClipboardList }],
  },
  {
    title: "Reports",
    items: [
      { label: "Attendance", href: "/faculty/attendance", icon: FileBarChart },
      { label: "Results", href: "/faculty/results", icon: FileText },
      { label: "Marks Report", href: "/faculty/reports/marks", icon: FileBarChart },
    ],
  },
];
