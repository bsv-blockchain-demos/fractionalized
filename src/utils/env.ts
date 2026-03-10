// Use static access so Next.js can inline public env values in client bundles
export const SERVER_PUBLIC_KEY: string = process.env.NEXT_PUBLIC_SERVER_PUBLIC_KEY as string;

export function assertEnv(): void {
  if (!SERVER_PUBLIC_KEY || String(SERVER_PUBLIC_KEY).trim() === "") {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_SERVER_PUBLIC_KEY");
  }
}
