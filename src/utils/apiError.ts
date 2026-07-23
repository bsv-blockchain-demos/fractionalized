import { NextResponse } from "next/server";
import { ValidationError } from "./validation";
import { logger } from "./logger";

export function handleRouteError(e: unknown, fallbackMessage: string): NextResponse {
  if (e instanceof ValidationError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  logger.error(e);
  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}
