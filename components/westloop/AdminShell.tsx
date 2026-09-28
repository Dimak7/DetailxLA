"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "./PublicShell";
import { BRAND_NAME } from "@/lib/brand";
import { adminNavigation } from "@/lib/platform/admin-navigation";
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
  const workspaces = adminNavigation(sections);
  const home = sections.includes("dashboard") ? "dashboard" : sections.includes("my_schedule") ? "my_schedule" : workspaces[0]?.target || "bookings";
  const quickLinks = [
    { section: "bookings", label: "New booking", href: "/admin/bookings?new=booking" },
    { section: "customers", label: "New customer", href: "/admin/customers" },
    { section: "employees", label: "New employee", href: "/admin/employees" },
    { section: "expenses", label: "New expense", href: "/admin/expenses" },
    { section: "inventory", label: "New inventory item", href: "/admin/inventory" },
  ].filter((item) => sections.includes(item.section) && user.role !== "staff");
  const currentSection = path.split("/").filter(Boolean).at(-1) || "dashboard";
  const activeWorkspace = workspaces.find((workspace) => workspace.sections.includes(currentSection));
  return (
    <div className="admin-shell">
      <header className="app-global-bar">
        <Link className="app-brand" href={`/admin/${home}`} aria-label={`${BRAND_NAME} home`}><Wordmark /></Link>
        <span className="app-business-name">{BRAND_NAME.toUpperCase()} <small>Business workspace</small></span>
        <div className="app-global-actions">
          <form action="/admin/bookings" className="admin-global-search"><input name="search" aria-label="Search bookings" placeholder="Search" /><button>Search</button></form>
          {quickLinks.length > 0 && <details className="admin-quick-menu"><summary aria-label="Quick actions">+</summary><div>{quickLinks.map((item) => <Link key={item.section} href={item.href}>{item.label}</Link>)}</div></details>}
          <details className="app-profile"><summary>{user.name.slice(0, 1).toUpperCase()}</summary><div><strong>{user.name}</strong><small>{user.role} · {user.email}</small>{sections.includes("settings") && <Link href="/admin/settings">Settings</Link>}<button onClick={async () => { await fetch("/api/admin/logout", { method: "POST" }); location.assign("/admin/login"); }}>Sign out</button></div></details>
        </div>
      </header>
      <div className="app-body">
        <aside className="admin-sidebar"><nav aria-label="Business workspaces">{workspaces.map((workspace) => <Link key={workspace.target} href={`/admin/${workspace.target}`} className={activeWorkspace?.target === workspace.target ? "active" : ""}>{workspace.label}</Link>)}{sections.includes("settings") && <Link href="/admin/settings" className={currentSection === "settings" ? "active" : ""}>Settings</Link>}</nav></aside>
        <main id="main" className="admin-main"><div className="admin-topbar"><span>WORKSPACE</span><strong>{activeWorkspace?.label || "Dashboard"}{currentSection !== activeWorkspace?.target ? ` / ${sectionLabels[currentSection] || currentSection}` : ""}</strong></div>{children}</main>
      </div>
    </div>
  );
}
