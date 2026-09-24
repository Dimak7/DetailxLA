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
  { label: "Dashboard", sections: ["dashboard"] },
  { label: "Bookings & Schedule", sections: ["calendar", "bookings", "services"] },
  { label: "Customers & CRM", sections: ["customers", "leads", "reviews"] },
  { label: "Employees & Payroll", sections: ["employees", "schedule", "hours", "payroll", "performance", "my_schedule"] },
  { label: "Marketing", sections: ["marketing", "messages", "gallery"] },
  { label: "Inventory", sections: ["inventory"] },
  { label: "Expenses & Finance", sections: ["expenses", "payments", "reports", "analytics"] },
  { label: "Settings", sections: ["settings"] },
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
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link href="/">
          <Wordmark />
        </Link>
        <nav aria-label="Business workspace">
          {navigationGroups.map((group) => {
            const visible = group.sections.filter((section) => sections.includes(section));
            if (!visible.length) return null;
            return <div className="admin-nav-group" key={group.label}>
              <p>{group.label}</p>
              {visible.map((section) => <Link key={section} href={"/admin/" + section} className={path === "/admin/" + section ? "active" : ""}>
                <span>{sectionLabels[section]}</span>
              </Link>)}
            </div>;
          })}
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
          <span>WEST LOOP AUTO SPA / BUSINESS WORKSPACE</span>
          <Link href="/" target="_blank">
            View website ↗
          </Link>
        </div>
        {children}
      </main>
    </div>
  );
}
