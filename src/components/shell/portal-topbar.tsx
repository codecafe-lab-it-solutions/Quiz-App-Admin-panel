"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BrandLogo } from "@/components/shell/brand-logo";
import { LogOut, Menu, User } from "lucide-react";
import { apiClient } from "@/lib/api-client";

interface PortalTopbarProps {
  name: string;
  email: string;
  roleLabel: string;
  brandLines: [string, string];
  onMenuClick: () => void;
  /** Extra dropdown items rendered above "Log out" (e.g. admin's "Change password"). */
  extraMenuItems?: React.ReactNode;
}

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// Shared top bar for the Admin, Faculty and Student portals - same layout and
// behavior everywhere, only the brand text/role label and (for admin) the
// change-password menu item differ per portal.
export function PortalTopbar({ name, email, roleLabel, brandLines, onMenuClick, extraMenuItems }: PortalTopbarProps) {
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await apiClient.post("/api/auth/logout");
    } catch {
      // ignore - cookies are cleared server-side regardless
    } finally {
      toast.success("Signed out");
      router.push("/login");
      router.refresh();
    }
  };

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-card px-4 lg:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenuClick} aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </Button>

      <div className="flex items-center gap-2">
        <BrandLogo className="h-9 w-9 shrink-0" />
        <span className="hidden text-sm font-semibold leading-tight sm:block">
          {brandLines[0]}
          <br />
          {brandLines[1]}
        </span>
      </div>

      <div className="flex-1" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="flex items-center gap-2 px-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary text-primary-foreground text-xs">{initials(name)}</AvatarFallback>
            </Avatar>
            <div className="hidden text-left sm:block">
              <p className="text-sm font-medium leading-tight">{name}</p>
              <p className="text-xs capitalize leading-tight text-muted-foreground">{roleLabel}</p>
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="flex items-center gap-2">
              <User className="h-4 w-4" />
              <div>
                <p className="text-sm font-medium">{name}</p>
                <p className="text-xs font-normal text-muted-foreground">{email}</p>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {extraMenuItems}
          <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
            <LogOut className="mr-2 h-4 w-4" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
