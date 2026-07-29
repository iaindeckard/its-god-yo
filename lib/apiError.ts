import { NextResponse } from "next/server";
import { ForbiddenError, UnauthorizedError } from "./rbac";

/** Maps thrown errors to JSON responses: UnauthorizedError -> 401, ForbiddenError -> 403, else 500. */
export function apiError(e: unknown): NextResponse {
  if (e instanceof UnauthorizedError) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (e instanceof ForbiddenError) {
    return NextResponse.json({ error: e.message, permission: e.permissionKey }, { status: 403 });
  }
  const message = e instanceof Error ? e.message : "internal_error";
  return NextResponse.json({ error: message }, { status: 500 });
}
