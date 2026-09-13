import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "./auth";
export function apiError(error: unknown) {
  if (error instanceof ZodError)
    return NextResponse.json(
      { ok: false, error: error.issues[0]?.message || "Invalid input." },
      { status: 400 },
    );
  if (error instanceof AppError)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: error.status },
    );
  console.error(
    "West Loop request failed",
    error instanceof Error ? error.message : "Unknown error",
  );
  return NextResponse.json(
    {
      ok: false,
      error: "We could not complete the request. Please try again.",
    },
    { status: 503 },
  );
}
export async function readJson(request: Request) {
  const text = await request.text();
  if (text.length > 65536) throw new AppError("Request is too large.", 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("Invalid request data.");
  }
}
