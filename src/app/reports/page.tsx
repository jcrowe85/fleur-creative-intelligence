import { buildReport } from "@/lib/creative/report";
import { requireUser } from "@/lib/dal";
import ReportClient from "./ReportClient";

// Its own route rather than a sixth tab on the dashboard: this reads from a
// different aggregate (performance, not coverage), wants its own URL so it can
// be linked to, and CreativeClient.tsx is long enough already.
export const dynamic = "force-dynamic";

export default async function Page() {
  await requireUser();
  const report = await buildReport();
  return <ReportClient report={report} />;
}
