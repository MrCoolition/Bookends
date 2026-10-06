/** Local setup edits browser-owned configuration and never grants server access. */
export function localAdministrationEnabled(env: Readonly<Record<string, string | undefined>> = process.env) {
  return env.BOOKENDS_MODE !== "production" && env.BOOKENDS_ADMIN_MODE === "local";
}
