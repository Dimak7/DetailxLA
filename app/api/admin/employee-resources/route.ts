import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, requireSession } from "@/lib/platform/auth";
import { apiError, readJson } from "@/lib/platform/http";
import { archiveEmployeeResource, createEmployeeAccessLink, employeeResourceData, saveEmployeeResource } from "@/lib/platform/employee-resources";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const user = await requireSession(request, "my_schedule");
    const data = await employeeResourceData(user, new URL(request.url).searchParams.get("manage") === "1");
    return NextResponse.json(data, { headers });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireSession(request, "my_schedule");
    const body = z.object({ action: z.enum(["save", "archive", "access_link"]), data: z.unknown() }).parse(await readJson(request));
    let result;
    if (body.action === "save") result = await saveEmployeeResource(body.data, user);
    else if (body.action === "archive") result = await archiveEmployeeResource(body.data, user);
    else if (body.action === "access_link") result = await createEmployeeAccessLink(body.data, user);
    else throw new AppError("Choose a valid employee resource action.");
    return NextResponse.json({ ok: true, result }, { headers });
  } catch (error) { return apiError(error); }
}
