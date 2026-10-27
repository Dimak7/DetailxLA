"use client";
import Link from "next/link";
import { useState, useEffect } from "react";
import { Modal } from "./AdminControls";
import { usePathname } from "next/navigation";
import { Wordmark } from "./PublicShell";
import { BRAND_NAME } from "@/lib/brand";
import { adminNavigation, adminSectionLabels } from "@/lib/platform/admin-navigation";
import type { Session } from "@/lib/platform/types";

function NavIcon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    home: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    bookings: <><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 11h16m-11 5h6"/></>,
    customers: <><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>,
    team: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v2"/></>,
    growth: <><path d="M4 20V4m0 16h16M7 15l5-5 4 3 5-8m-5 0h5v5"/></>,
    money: <><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 10h18m-13 5h3"/></>,
    inventory: <><path d="m12 3 9 5v9l-9 5-9-5V8l9-5Zm0 9 9-4M3 8l9 4v10M7 5.8l9 5"/></>,
    schedule: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/></>,
    moon: <path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z"/>,
    plus: <path d="M12 5v14M5 12h14"/>,
  };
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.menu}</svg>;
}

type AdminTheme = "light" | "dark";
function rememberTheme(theme: AdminTheme) {
  try { localStorage.setItem("wl-admin-theme", theme); } catch { /* The appearance cookie can still remember the choice. */ }
  try {
    document.cookie = `wl-admin-theme=${theme}; Path=/admin; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  } catch { /* The current session remains usable when persistence is unavailable. */ }
}

export function AdminShell({ user, sections, children, initialTheme }: { user: Session; sections: string[]; children: React.ReactNode; initialTheme?: AdminTheme }) {
  const path = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [theme, setTheme] = useState<AdminTheme>(initialTheme || "light");
  useEffect(() => {
    if (initialTheme) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem("wl-admin-theme"); } catch { /* Use the system preference when storage is unavailable. */ }
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
      rememberTheme(saved); // Migrate existing browser choices for the next server render.
    } else {
      setTheme(matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    }
  }, [initialTheme]);
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    rememberTheme(next);
  }
  const roleLabel = user.role === "staff" ? "Detailer" : user.role[0].toUpperCase() + user.role.slice(1);
  const workspaces = adminNavigation(sections);
  const home = sections.includes("dashboard") ? "dashboard" : sections.includes("my_schedule") ? "my_schedule" : workspaces[0]?.target || "bookings";
  const currentSection = path.split("/").filter(Boolean).at(-1) || home;
  const activeWorkspace = workspaces.find(workspace => workspace.sections.includes(currentSection));
  const canSearchBookings = sections.includes("bookings");
  const canCreateBooking = canSearchBookings && user.role !== "staff";
  const preview = process.env.NEXT_PUBLIC_ADMIN_PREVIEW === "true";
  const previewLabel = process.env.NEXT_PUBLIC_ADMIN_PREVIEW_HOSTED === "true" ? "Demo workspace" : "Local preview";
  const mobileLinks = [
    { target: home, label: home === "my_schedule" ? "My day" : "Overview", icon: "home", active: currentSection === home },
    ...(home !== "bookings" && canSearchBookings ? [{ target: "bookings", label: user.role === "staff" ? "My jobs" : "Bookings", icon: "bookings", active: ["bookings", "calendar", "services"].includes(currentSection) }] : []),
    ...(sections.includes("schedule") ? [{ target: "schedule", label: "Schedule", icon: "schedule", active: ["schedule", "employees", "hours", "payroll", "performance", "team"].includes(currentSection) }] : []),
  ];
  return <div className="admin-shell admin-redesign" data-theme={theme} data-section={currentSection}>
    <header className="app-global-bar">
      <Link className="app-brand" href={`/admin/${home}`} aria-label={`${BRAND_NAME} home`}><Wordmark/></Link>
      <div className="workspace-location"><span>{activeWorkspace?.label || "Workspace"}</span>{currentSection !== activeWorkspace?.target && <><i aria-hidden="true">/</i><strong>{adminSectionLabels[currentSection] || currentSection}</strong></>}</div>
      <div className="app-global-actions">{preview&&<span className="studio-preview-badge">{previewLabel}</span>}
        {canSearchBookings && <form action="/admin/bookings" className="admin-global-search"><NavIcon name="search"/><input name="search" aria-label="Search bookings" placeholder="Find a customer or booking"/><button type="submit">Search</button></form>}
        {canSearchBookings && <button className="admin-mobile-search-toggle" aria-label={searchOpen ? "Close search" : "Search bookings"} aria-expanded={searchOpen} aria-controls="admin-mobile-search" onClick={()=>setSearchOpen(!searchOpen)}><NavIcon name="search"/></button>}
        <button className="admin-theme-toggle" onClick={toggleTheme} aria-label={theme === "dark" ? "Use light mode" : "Use dark mode"}><NavIcon name={theme === "dark" ? "sun" : "moon"}/></button>
        <details className="app-profile"><summary aria-label="Your account">{user.name.slice(0,1).toUpperCase()}</summary><div><strong>{user.name}</strong><small>{roleLabel} · {user.email}</small><button onClick={async()=>{await fetch("/api/admin/logout",{method:"POST"});location.assign("/admin/login");}}>Sign out</button></div></details>
      </div>
    </header>
    {searchOpen && canSearchBookings && <form id="admin-mobile-search" className="admin-mobile-search" action="/admin/bookings"><input type="search" name="search" aria-label="Search appointments" placeholder="Customer or booking reference" autoFocus/><button type="submit">Search</button></form>}
    <div className="app-body">
      <aside className="admin-sidebar">
        <Link className="sidebar-brand" href={`/admin/${home}`} aria-label={`${BRAND_NAME} workspace`}><Wordmark/></Link>
        {canCreateBooking && <Link className="sidebar-create" href="/admin/bookings?new=booking"><NavIcon name="plus"/>New booking</Link>}
        <nav aria-label="Business workspaces">{["Workspace","Business"].map(group=>{
          const items=workspaces.filter(w=>w.group===group);
          return items.length ? <div className="sidebar-group" key={group}><p>{group}</p>{items.map(workspace=><Link key={workspace.target} href={`/admin/${workspace.target}`} className={activeWorkspace?.target===workspace.target?"active":""} aria-current={activeWorkspace?.target===workspace.target?"page":undefined}><NavIcon name={workspace.icon}/><span>{workspace.label}</span></Link>)}</div>:null;
        })}</nav>
        <div className="sidebar-footer"><span className="workspace-dot"/><div><strong>{preview?previewLabel:"West Loop studio"}</strong><small>{preview?"Sample data · safe to explore":`${roleLabel} workspace`}</small></div></div>
      </aside>
      <main id="main" className="admin-main">{preview&&<p className="studio-preview-note">Sample data · No real charges or messages</p>}{children}</main>
    </div>
    <nav className="admin-mobile-nav" aria-label="Mobile workspaces">{mobileLinks.map(link=><Link href={`/admin/${link.target}`} key={link.target} className={link.active?"active":""} aria-current={link.active?"page":undefined} onClick={()=>{setMenuOpen(false);setSearchOpen(false);}}><NavIcon name={link.icon}/><span>{link.label}</span></Link>)}<button className={menuOpen||!mobileLinks.some(link=>link.active)?"active":""} aria-expanded={menuOpen} aria-haspopup="dialog" onClick={()=>setMenuOpen(true)}><NavIcon name="menu"/><span>More</span></button></nav>
    {menuOpen && <Modal title="Your workspace" onClose={()=>setMenuOpen(false)}><div className="admin-mobile-menu"><nav aria-label="All workspaces">{workspaces.map(workspace=><Link key={workspace.target} href={`/admin/${workspace.target}`} className={activeWorkspace?.target===workspace.target?"active":""} onClick={()=>setMenuOpen(false)}><NavIcon name={workspace.icon}/><strong>{workspace.label}</strong><span>{workspace.description}</span></Link>)}</nav><div className="admin-menu-user"><div><strong>{user.name}</strong><span>{roleLabel}</span></div><button onClick={async()=>{await fetch("/api/admin/logout",{method:"POST"});location.assign("/admin/login");}}>Sign out</button></div></div></Modal>}
  </div>;
}
