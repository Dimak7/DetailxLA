"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "./PublicShell";
import type { Session } from "@/lib/platform/types";
const sectionLabels: Record<string, string> = {
  dashboard: "Dashboard",
  calendar: "Calendar",
  bookings: "Bookings",
  services: "Services",
  customers: "Customers",
  leads: "Leads",
  employees: "Employees",
  schedule: "Schedule",
  my_schedule: "My schedule",
  hours: "Hours",
  payroll: "Payroll",
  performance: "Performance",
  marketing: "Campaigns",
  messages: "Messages",
  reviews: "Reviews",
  gallery: "Gallery",
  expenses: "Expenses",
  payments: "Payments",
  inventory: "Inventory",
  reports: "Reports",
  analytics: "Analytics",
  settings: "Settings",
};
const navigationGroups = [
  { label: "Dashboard", target: "dashboard" },
  { label: "Bookings", target: "bookings" },
  { label: "CRM", target: "customers" },
  { label: "Team", target: "employees" },
  { label: "Marketing", target: "marketing" },
  { label: "Operations", target: "inventory" },
  { label: "Settings", target: "settings" },
];
export function AdminShell({
  user,
  sections,
  children,
}: {
  user: Session;
  sections: string[];
  children: React.ReactNode;
}) {
  const path = usePathname();
  const currentSection = path.split("/").filter(Boolean).at(-1) || "dashboard";
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link href="/">
          <Wordmark />
        </Link>
        <nav aria-label="Business workspace">
          {navigationGroups.filter((group) => sections.includes(group.target)).map((group) => <Link key={group.target} href={"/admin/" + group.target} className={path === "/admin/" + group.target ? "active" : ""}><span>{group.label}</span></Link>)}
        </nav>
        <div className="admin-user">
          {user.name}
          <p>
            {user.role} · {user.email}
          </p>
          <button
            onClick={async () => {
              await fetch("/api/admin/logout", { method: "POST" });
              location.assign("/admin/login");
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main id="main" className="admin-main">
        <div className="admin-topbar">
          <div><span className="admin-breadcrumb">WEST LOOP AUTO SPA / BUSINESS WORKSPACE</span><strong>{sectionLabels[currentSection] || "Dashboard"}</strong></div>
          <div className="admin-top-actions">
            <form action="/admin/bookings" className="admin-global-search"><input name="search" aria-label="Search bookings and customers" placeholder="Search bookings, customers..." /><button>Search</button></form>
            {sections.includes("bookings") && <Link className="admin-quick-add" href="/admin/bookings?new=booking">+ Add</Link>}
            <Link href="/" target="_blank">View website ↗</Link>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
