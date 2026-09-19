import { requireUser } from "@/lib/dal";
import FactsClient from "./FactsClient";

// Its own route rather than a tab: this is the source of truth every creator
// brief is written against, edited rarely and deliberately, and it wants a URL
// someone can be sent to.
export const dynamic = "force-dynamic";

export default async function Page() {
  await requireUser();
  // The facts themselves are fetched client-side from /api/product-facts, so
  // the editor has one loading path whether it is opening or reloading after a
  // save — and the page never renders stale text it then has to reconcile.
  return <FactsClient />;
}
