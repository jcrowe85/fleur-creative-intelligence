import { NextResponse } from "next/server";
import { apiRequireUser } from "@/lib/dal";
import {
  productFacts,
  productFactsStatus,
  setProductFacts,
  shippedProductFacts,
} from "@/lib/reference/product-facts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read and edit the product facts every creator brief is written against.
 *
 * Team-only (apiRequireUser), not creator-facing (apiRequireCreator, which
 * accepts guests): this content decides what thousands of briefs may claim
 * about the product, so it sits behind the same gate as the dashboard.
 */
export async function GET() {
  const auth = await apiRequireUser();
  if ("error" in auth) return auth.error;

  const [markdown, status] = await Promise.all([productFacts(), productFactsStatus()]);
  return NextResponse.json({
    markdown,
    status,
    // Returned so an editor can show what changed against the build, and offer
    // a way back to it without anyone keeping a copy elsewhere.
    shipped: shippedProductFacts(),
  });
}

export async function PUT(req: Request) {
  const auth = await apiRequireUser();
  if ("error" in auth) return auth.error;

  let markdown: unknown;
  try {
    ({ markdown } = (await req.json()) as { markdown?: unknown });
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  if (typeof markdown !== "string") {
    return NextResponse.json({ error: "markdown must be a string" }, { status: 400 });
  }

  try {
    // setProductFacts refuses empty input: briefs would otherwise be generated
    // against nothing and invent the facts they need.
    await setProductFacts(markdown, auth.user.email);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  return NextResponse.json({
    markdown: await productFacts(),
    status: await productFactsStatus(),
  });
}
