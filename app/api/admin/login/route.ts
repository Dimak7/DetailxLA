import { NextResponse } from "next/server";
import { getAdminAuthConfigStatus, setAdminSessionCookie, validateAdminCredentials } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const config = getAdminAuthConfigStatus();
    if (!config.configured) {
      console.error("Admin login route rejected missing configuration.", { missing: config.missing });
      return NextResponse.json(
        {
          ok: false,
          error: `Admin login is not configured. Missing: ${config.missing.join(", ")}.`,
        },
        { status: 503 }
      );
    }

    const contentType = request.headers.get("content-type") || "";
    let email = "";
    let password = "";

    if (contentType.includes("application/json")) {
      const payload = (await request.json()) as { email?: string; password?: string };
      email = String(payload.email || "");
      password = String(payload.password || "");
    } else {
      const formData = await request.formData();
      email = String(formData.get("email") || "");
      password = String(formData.get("password") || "");
    }

    if (!validateAdminCredentials(email, password)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid admin credentials.",
        },
        { status: 401 }
      );
    }

    const response = NextResponse.json(
      {
        ok: true,
        redirectTo: "/admin/dashboard",
      },
      { status: 200 }
    );
    setAdminSessionCookie(response, email);
    console.info("Admin login succeeded", { email: email.trim().toLowerCase() });
    return response;
  } catch (error) {
    console.error("Admin login failed safely.", { error });
    return NextResponse.json(
      {
        ok: false,
        error: "Admin login could not be completed. Please try again.",
      },
      { status: 500 }
    );
  }
}
