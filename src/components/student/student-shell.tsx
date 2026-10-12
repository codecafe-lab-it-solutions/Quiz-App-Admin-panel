"use client";

import { PortalShell } from "@/components/shell/portal-shell";
import { APP_NAME } from "@/lib/brand";
import { STUDENT_NAV_GROUPS } from "@/components/student/student-nav";

interface StudentShellProps {
  name: string;
  email: string;
  children: React.ReactNode;
}

export function StudentShell({ name, email, children }: StudentShellProps) {
  return (
    <PortalShell
      name={name}
      email={email}
      roleLabel="Student"
      brandLines={[APP_NAME, "Student Portal"]}
      navGroups={STUDENT_NAV_GROUPS}
    >
      {children}
    </PortalShell>
  );
}
