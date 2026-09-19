// Skip the login when running against a local copy.
//
// Two conditions, both required, because this removes the only thing standing
// between the dashboard and the open internet:
//
//   1. DEV_NO_AUTH=1 must be set explicitly. Nothing sets it by default.
//   2. DATABASE_URL must point at localhost.
//
// The second is the one that actually protects production. An env var can be
// set on a hosting provider by accident, or copied across when someone clones a
// project's settings — but production points at Supabase, so the bypass simply
// cannot engage there even if the flag leaks. A single-condition check would
// rely on nobody ever making that mistake.

export function authBypassed(): boolean {
  if (process.env.DEV_NO_AUTH !== "1") return false;
  const url = process.env.DATABASE_URL ?? "";
  return url.includes("@localhost") || url.includes("@127.0.0.1");
}
