const workspaces = [
  { label: "Dashboard", target: "dashboard", sections: ["dashboard"] },
  { label: "Bookings", target: "bookings", sections: ["bookings", "calendar", "services"] },
  { label: "Customers", target: "customers", sections: ["customers", "leads", "reviews"] },
  { label: "Team", target: "employees", sections: ["employees", "schedule", "hours", "payroll", "performance", "my_schedule"] },
  { label: "Growth", target: "marketing", sections: ["marketing", "messages", "gallery"] },
  { label: "Operations", target: "inventory", sections: ["inventory", "expenses", "payments"] },
  { label: "Reports", target: "reports", sections: ["reports", "analytics"] },
];

export function adminNavigation(allowedSections: string[]) {
  const allowed = new Set(allowedSections);
  return workspaces.flatMap((workspace) => {
    const sections = workspace.sections.filter((section) => allowed.has(section));
    const target = allowed.has(workspace.target) ? workspace.target : sections[0];
    return target ? [{ ...workspace, sections, target, label: target === "my_schedule" ? "My schedule" : workspace.label }] : [];
  });
}
