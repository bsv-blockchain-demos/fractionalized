import { ObjectId } from "mongodb";

export class ValidationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ValidationError("Invalid JSON body");
  }
}

export function asString(v: unknown, field: string, opts?: { maxLength?: number }): string {
  if (typeof v !== "string") throw new ValidationError(`${field} must be a string`);
  if (opts?.maxLength != null && v.length > opts.maxLength) throw new ValidationError(`${field} is too long`);
  return v;
}

export function asNumberInRange(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new ValidationError(`${field} must be a number`);
  if (v < min || v > max) throw new ValidationError(`${field} is out of range`);
  return v;
}

export function asObjectId(v: unknown, field: string): ObjectId {
  if (typeof v !== "string" || !ObjectId.isValid(v)) throw new ValidationError(`${field} must be a valid id`);
  return new ObjectId(v);
}

export function asEnum<T extends string>(v: unknown, field: string, allowed: readonly T[]): T {
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    throw new ValidationError(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return v as T;
}

export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function requireFields(obj: Record<string, unknown>, fields: string[]): void {
  const missing = fields.filter((f) => obj[f] == null);
  if (missing.length) throw new ValidationError(`Missing required fields: ${missing.join(", ")}`);
}
