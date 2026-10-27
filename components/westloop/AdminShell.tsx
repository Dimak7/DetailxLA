"use client";
import Link from "next/link";
import { useState, useEffect } from "react";
import { Modal } from "./AdminControls";
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
  team: "Team access",
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
};
function NavIcon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></>,
    bookings: <><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M8 3v4m8-4v4M4 11h16m-11 5h6" /></>,
    schedule: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  };
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.menu}</svg>;
}

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [theme, setTheme] = useState("light");
  useEffect(() => {
    try { setTheme(localStorage.getItem("wl-admin-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")); } catch { /* Storage may be disabled. */ }
  }, []);
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem("wl-admin-theme", next); } catch { /* Keep this session's choice. */ }
  }
  const roleLabel = user.role === "staff" ? "Detailer" : user.role[0].toUpperCase() + user.role.slice(1);
  const canSearchBookings = sections.includes("bookings");
  const workspaces = adminNavigation(sections).map((workspace) => ({ ...workspace, label: user.role === "staff" && workspace.target === "bookings" ? "My jobs" : workspace.label }));
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
  const mobileLinks = [
    { target: home, label: home === "my_schedule" ? "My day" : "Overview", icon: "home", active: currentSection === home },
    ...(home !== "bookings" && sections.includes("bookings") ? [{ target: "bookings", label: user.role === "staff" ? "My jobs" : "Bookings", icon: "bookings", active: ["bookings", "calendar", "services"].includes(currentSection) }] : []),
    ...(sections.includes("schedule") ? [{ target: "schedule", label: "Schedule", icon: "schedule", active: ["schedule", "employees", "hours", "payroll", "performance"].includes(currentSection) }] : []),
  ];
  const menuActive = !mobileLinks.some((link) => link.active);
  return (
    <div className="admin-shell" data-theme={theme}>
      <header className="app-global-bar">
        <Link className="app-brand" href={`/admin/${home}`} aria-label={`${BRAND_NAME} home`}><Wordmark /></Link>
        <span className="app-business-name">{BRAND_NAME.toUpperCase()} <small>Business workspace</small></span>
        <div className="app-global-actions">
          <button className="admin-theme-toggle" onClick={toggleTheme} aria-label={theme === "dark" ? "Use light mode" : "Use dark mode"} title={theme === "dark" ? "Use light mode" : "Use dark mode"}>{theme === "dark" ? "☀" : "☾"}</button>
          {canSearchBookings && <button className="admin-mobile-search-toggle" aria-label={searchOpen ? "Close search" : "Search bookings"} aria-expanded={searchOpen} aria-controls="admin-mobile-search" onClick={() => setSearchOpen(!searchOpen)}><NavIcon name="search" /></button>}
          {canSearchBookings && <form action="/admin/bookings" className="admin-global-search"><input name="search" aria-label="Search bookings" placeholder="Search" /><button>Search</button></form>}
          {quickLinks.length > 0 && <details className="admin-quick-menu"><summary aria-label="Quick actions">+</summary><div>{quickLinks.map((item) => <Link key={item.section} href={item.href}>{item.label}</Link>)}</div></details>}
          <details className="app-profile"><summary aria-label="Your account">{user.name.slice(0, 1).toUpperCase()}</summary><div><strong>{user.name}</strong><small>{roleLabel} · {user.email}</small><button onClick={async () => { await fetch("/api/admin/logout", { method: "POST" }); location.assign("/admin/login"); }}>Sign out</button></div></details>
        </div>
      </header>
      {searchOpen && canSearchBookings && <form id="admin-mobile-search" className="admin-mobile-search" action="/admin/bookings"><input type="search" name="search" aria-label="Search appointments" placeholder="Name or booking reference" autoFocus /><button type="submit">Search</button></form>}
      <div className="app-body">
        <aside className="admin-sidebar"><nav aria-label="Business workspaces">{workspaces.map((workspace) => <Link key={workspace.target} href={`/admin/${workspace.target}`} className={activeWorkspace?.target === workspace.target ? "active" : ""}>{workspace.label}</Link>)}</nav></aside>
        <main id="main" className="admin-main"><div className="admin-topbar"><span>WORKSPACE</span><strong>{activeWorkspace?.label || "Dashboard"}{currentSection !== activeWorkspace?.target ? ` / ${sectionLabels[currentSection] || currentSection}` : ""}</strong></div>{children}</main>
      </div>
      <nav className="admin-mobile-nav" aria-label="Mobile workspaces">
        {mobileLinks.map((link) => <Link href={`/admin/${link.target}`} key={link.target} className={link.active ? "active" : ""} aria-current={link.active ? "page" : undefined} onClick={() => { setMenuOpen(false); setSearchOpen(false); }}><NavIcon name={link.icon} /><span>{link.label}</span></Link>)}
        <button className={menuActive || menuOpen ? "active" : ""} aria-expanded={menuOpen} aria-haspopup="dialog" onClick={() => setMenuOpen(true)}><NavIcon name="menu" /><span>More</span></button>
      </nav>
      {menuOpen && <Modal title="Your workspace" onClose={() => setMenuOpen(false)}>
        <div className="admin-mobile-menu">
          <p className="admin-menu-intro">Everything you need to run the day.</p>
          <nav aria-label="All workspaces">{workspaces.map((workspace) => <Link key={workspace.target} href={`/admin/${workspace.target}`} className={activeWorkspace?.target === workspace.target ? "active" : ""} onClick={() => setMenuOpen(false)}>{workspace.label}<span>{workspace.sections.map((section) => sectionLabels[section]).join(" · ")}</span></Link>)}</nav>
          <div className="admin-menu-user"><strong>{user.name}</strong><span>{roleLabel} · {user.email}</span></div>
        </div>
      </Modal>}
    </div>
  );
}
