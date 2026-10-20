export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkEnv } = await import("@/lib/env");
  const report = checkEnv();
  for (const w of report.warnings) console.warn(`[config] ${w}`);
  if (!report.ok) {
    for (const e of report.errors) console.error(`[config] ${e}`);
    throw new Error(`Grandview OS refused to start: ${report.errors.length} configuration error(s). See logs above.`);
  }
}

export async function onRequestError(error: unknown, request: { path: string; method: string }) {
  // Keep a server-side record; users only ever see a generic message.
  console.error(`[request-error] ${request.method} ${request.path}`, error);
}
