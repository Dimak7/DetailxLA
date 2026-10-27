import type { Role } from "./types";

export function adminLandingPage(role: Role) {
  return role === "staff" ? "/admin/my_schedule" : "/admin/dashboard";
}

export const adminSectionLabels: Record<string, string> = {
  dashboard: "Overview", bookings: "Bookings", calendar: "Calendar", services: "Services",
  customers: "Customers", leads: "Leads", reviews: "Reviews", employees: "People",
  schedule: "Schedule", hours: "Hours", payroll: "Payroll", performance: "Performance",
  my_schedule: "My schedule", team: "Login access", marketing: "Growth", analytics: "Analytics",
  payments: "Payments", expenses: "Expenses", reports: "Reports", inventory: "Inventory",
};

const workspaces = [
  { label: "Overview", target: "dashboard", icon: "home", group: "Workspace", description: "Your day at a glance", sections: ["dashboard"] },
  { label: "Bookings", target: "bookings", icon: "bookings", group: "Workspace", description: "Jobs, calendar & services", sections: ["bookings", "calendar", "services"] },
  { label: "Customers", target: "customers", icon: "customers", group: "Workspace", description: "Clients, leads & reviews", sections: ["customers", "leads", "reviews"] },
  { label: "Team", target: "employees", icon: "team", group: "Workspace", description: "People, shifts & payroll", sections: ["employees", "schedule", "hours", "payroll", "performance", "my_schedule", "team"] },
  { label: "Growth", target: "marketing", icon: "growth", group: "Business", description: "Sources & campaigns", sections: ["marketing", "analytics"] },
  { label: "Money", target: "payments", icon: "money", group: "Business", description: "Payments, costs & reports", sections: ["payments", "expenses", "reports"] },
  { label: "Inventory", target: "inventory", icon: "inventory", group: "Business", description: "Products & stock", sections: ["inventory"] },
];

export function adminNavigation(allowedSections: string[]) {
  const allowed = new Set(allowedSections);
  return workspaces.flatMap((workspace) => {
    const sections = workspace.sections.filter((section) => allowed.has(section));
    const target = allowed.has(workspace.target) ? workspace.target : sections[0];
    return target ? [{ ...workspace, sections, target, label: target === "my_schedule" ? "My schedule" : workspace.label, description: target === "my_schedule" ? "Your jobs, shifts & training" : workspace.description }] : [];
  });
}
