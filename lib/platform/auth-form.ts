import { AppError } from "./auth";
import { readJson } from "./http";

export function isAuthForm(request: Request) {
  return request.headers.get("content-type")?.split(";")[0].trim() === "application/x-www-form-urlencoded";
}

/** Native POST keeps sign-in usable before hydration and credentials out of the URL. */
export async function readAuthInput(request: Request) {
  if (!isAuthForm(request)) return readJson(request);
  const text = await request.text();
  if (text.length > 65536) throw new AppError("Request is too large.", 413);
  return Object.fromEntries(new URLSearchParams(text));
}
