"use client";

import { useState } from "react";
import { PortalShell } from "@/components/shell/portal-shell";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ChangePasswordDialog } from "@/components/admin/change-password-dialog";
import { APP_NAME } from "@/lib/brand";
import { ADMIN_NAV_GROUPS } from "@/components/admin/admin-nav";
import { KeyRound } from "lucide-react";

interface AdminShellProps {
  name: string;
  email: string;
  role: string;
  children: React.ReactNode;
}

export function AdminShell({ name, email, role, children }: AdminShellProps) {
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  return (
    <>
      <PortalShell
        name={name}
        email={email}
        roleLabel={role.replace("_", " ")}
        brandLines={[APP_NAME, "Admin Panel"]}
        navGroups={ADMIN_NAV_GROUPS}
        extraMenuItems={
          <DropdownMenuItem onClick={() => setChangePasswordOpen(true)}>
            <KeyRound className="mr-2 h-4 w-4" />
            Change password
          </DropdownMenuItem>
        }
      >
        {children}
      </PortalShell>
      <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
    </>
  );
}
