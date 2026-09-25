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
const workspaces = [
  { label: "Home", target: "dashboard", sections: ["dashboard"] },
  { label: "Bookings", target: "bookings", sections: ["bookings", "calendar", "services"] },
  { label: "Customers", target: "customers", sections: ["customers", "leads", "reviews"] },
  { label: "Team", target: "employees", sections: ["employees", "schedule", "hours", "payroll", "performance", "my_schedule"] },
  { label: "Growth", target: "marketing", sections: ["marketing", "messages", "gallery"] },
  { label: "Operations", target: "inventory", sections: ["inventory", "expenses", "payments"] },
  { label: "Reports", target: "reports", sections: ["reports", "analytics"] },
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
  const activeWorkspace = workspaces.find((workspace) => workspace.sections.includes(currentSection));
  return (
    <div className="admin-shell">
      <header className="app-global-bar">
        <Link className="app-brand" href="/admin/dashboard" aria-label="West Loop Auto Spa home"><Wordmark /></Link>
        <nav className="app-primary-nav" aria-label="Business workspaces">
          {workspaces.filter((workspace) => sections.includes(workspace.target)).map((workspace) => <Link key={workspace.target} href={`/admin/${workspace.target}`} className={activeWorkspace?.target === workspace.target ? "active" : ""}>{workspace.label}</Link>)}
        </nav>
        <div className="app-global-actions">
          <form action="/admin/bookings" className="admin-global-search"><input name="search" aria-label="Search bookings and customers" placeholder="Search the business" /><button>Search</button></form>
          {sections.includes("bookings") && <details className="admin-quick-menu"><summary>Create</summary><div><Link href="/admin/bookings?new=booking">New booking</Link><Link href="/admin/customers">New customer</Link><Link href="/admin/employees">New employee</Link><Link href="/admin/expenses">New expense</Link><Link href="/admin/inventory">New inventory item</Link></div></details>}
          <details className="app-profile"><summary>{user.name.slice(0, 1).toUpperCase()}</summary><div><strong>{user.name}</strong><small>{user.role} · {user.email}</small><Link href="/admin/settings">Settings</Link><button onClick={async () => { await fetch("/api/admin/logout", { method: "POST" }); location.assign("/admin/login"); }}>Sign out</button></div></details>
        </div>
      </header>
      <main id="main" className="admin-main">
        <div className="admin-topbar"><span>WORKSPACE</span><strong>{activeWorkspace?.label || "Home"}{currentSection !== activeWorkspace?.target ? ` / ${sectionLabels[currentSection] || currentSection}` : ""}</strong></div>
        {children}
      </main>
    </div>
  );
}
