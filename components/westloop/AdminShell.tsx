"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "./PublicShell";
import type { Session } from "@/lib/platform/types";
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
          {sections
            .filter((s) => s !== "team")
            .map((s, i) => (
              <Link
                key={s}
                href={"/admin/" + s}
                className={path === "/admin/" + s ? "active" : ""}
              >
                <span>{s[0].toUpperCase() + s.slice(1)}</span>
                <span>{String(i + 1).padStart(2, "0")}</span>
              </Link>
            ))}
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
