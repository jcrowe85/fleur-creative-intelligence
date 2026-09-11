import Anthropic from "@anthropic-ai/sdk";
import { apiRequireCreator } from "@/lib/dal";
import { buildChatSystem, sanitizeMessages } from "@/lib/reference/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "claude-sonnet-4-6";

/** Streaming brainstorm chat about a saved video. Body: { assetId, messages }. */
export async function POST(req: Request) {
  const auth = await apiRequireCreator();
  if ("error" in auth) return auth.error;

  const { assetId, messages } = (await req.json().catch(() => ({}))) as {
    assetId?: string;
    messages?: unknown;
  };
  if (!assetId) return Response.json({ error: "assetId required" }, { status: 400 });

  const turns = sanitizeMessages(messages);
  if (turns.length === 0) return Response.json({ error: "no messages" }, { status: 400 });

  let system: string;
  try {
    system = await buildChatSystem(assetId);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 404 });
  }

  const client = new Anthropic();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const s = client.messages.stream({ model: MODEL, max_tokens: 1200, system, messages: turns });
        for await (const ev of s) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(ev.delta.text));
          }
        }
      } catch {
        controller.enqueue(encoder.encode("\n\n(Sorry — I hit an error. Try again.)"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
