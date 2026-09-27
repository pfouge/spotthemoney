// Tiny env helpers shared across packages.

/** Read a required env var or throw a clear error. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

/** Read an optional env var. */
export function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}
