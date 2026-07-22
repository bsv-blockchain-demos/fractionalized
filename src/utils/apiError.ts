import { NextResponse } from "next/server";
import { ValidationError } from "./validation";

export function handleRouteError(e: unknown, fallbackMessage: string): NextResponse {
  if (e instanceof ValidationError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error(e);
  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}
