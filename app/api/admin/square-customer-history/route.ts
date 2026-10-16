import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, assertOrigin, requireSession } from "@/lib/platform/auth";
import { apiError } from "@/lib/platform/http";
import { exportSquareCustomerHistory, importSquareCustomerHistory, requireSquareHistoryAccess, squareCustomerHistory } from "@/lib/platform/square-customer-history";

export const runtime = "nodejs";
async function importBody(request: Request) {
  const maximum = 1_100_000;
  const tooLarge = () => new AppError("Choose a Square customer CSV smaller than 1 MB.", 413);
  if (Number(request.headers.get("content-length") || 0) > maximum) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("The import request is empty.");
  const decoder = new TextDecoder();
  let length = 0, text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) { await reader.cancel(); throw tooLarge(); }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}
export async function GET(request: Request) {
  try {
    const user = await requireSession(request, "customers"), params = new URL(request.url).searchParams;
    requireSquareHistoryAccess(user);
    if (params.get("export") === "csv") return new NextResponse(await exportSquareCustomerHistory(user), { headers: {
      "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="west-loop-square-customer-history.csv"', "Cache-Control": "no-store",
    } });
    return NextResponse.json(await squareCustomerHistory(user, Number(params.get("page") || 1), params.get("search") || ""), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const user = await requireSession(request, "customers");
    requireSquareHistoryAccess(user);
    const text = await importBody(request);
    let input: unknown;
    try { input = JSON.parse(text); } catch { throw new AppError("Invalid import request."); }
    const data = z.object({ csv: z.string().max(1_000_000), filename: z.string().max(250), preview: z.boolean().default(true) }).parse(input);
    return NextResponse.json(await importSquareCustomerHistory(data.csv, data.filename, user, data.preview), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
