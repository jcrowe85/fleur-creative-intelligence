import * as SecureStore from "expo-secure-store";
import { API_BASE } from "./config";
import type { FeedCard } from "./types";

// The guest session token, stored on-device, sent as `Authorization: Bearer`.
const TOKEN_KEY = "fleur_creator_token";
let cachedToken: string | null = null;

async function mintToken(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/auth/guest/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ src: "ios-app" }),
  });
  if (!res.ok) throw new Error(`guest token ${res.status}`);
  const data = (await res.json()) as { token: string };
  return data.token;
}

export async function getToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  let t: string | null = null;
  try {
    t = await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    // secure store unavailable — fall through to mint (kept only in memory)
  }
  if (!t) {
    t = await mintToken();
    try {
      await SecureStore.setItemAsync(TOKEN_KEY, t);
    } catch {
      /* ignore */
    }
  }
  cachedToken = t;
  return t;
}

/**
 * Forget who we are. The next call mints a fresh guest, so the app comes back
 * as a brand-new creator — no saves, no content types, straight to onboarding.
 * Nothing is deleted server-side; the old guest is simply abandoned.
 */
export async function resetIdentity(): Promise<void> {
  cachedToken = null;
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Nothing stored (or store unavailable) — the in-memory clear is enough.
  }
}

async function authed(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });
}

export async function fetchFeed(): Promise<FeedCard[]> {
  const res = await authed("/api/reference/feed");
  if (!res.ok) throw new Error(`feed ${res.status}`);
  const data = (await res.json()) as { cards?: FeedCard[] };
  return data.cards ?? [];
}

export async function fetchSaved(): Promise<FeedCard[]> {
  const res = await authed("/api/reference/saved");
  if (!res.ok) throw new Error(`saved ${res.status}`);
  const data = (await res.json()) as { cards?: FeedCard[] };
  return data.cards ?? [];
}

export function postSave(assetId: string, status: "saved" | "dismissed"): Promise<Response> {
  return authed("/api/reference/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assetId, status }),
  });
}

export interface Beat {
  time: string;
  job: string;
  detail: string;
}
export interface Framework {
  whyItWorks: string;
  beats: Beat[];
  hookOptions: string[];
  fleurAngle: string;
  yourCanvas: string;
  compliance: string[];
}

export interface ContentTypeExample {
  key: string;
  label: string;
  description: string;
  card: FeedCard | null;
}

export async function fetchExamples(): Promise<ContentTypeExample[]> {
  const res = await authed("/api/reference/examples");
  if (!res.ok) throw new Error(`examples ${res.status}`);
  const data = (await res.json()) as { types?: ContentTypeExample[] };
  return data.types ?? [];
}

export async function fetchContentTypes(): Promise<string[]> {
  const res = await authed("/api/reference/profile");
  if (!res.ok) throw new Error(`profile ${res.status}`);
  const data = (await res.json()) as { contentTypes?: string[] };
  return data.contentTypes ?? [];
}

export async function saveContentTypes(contentTypes: string[]): Promise<string[]> {
  const res = await authed("/api/reference/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentTypes }),
  });
  if (!res.ok) throw new Error(`save profile ${res.status}`);
  const data = (await res.json()) as { contentTypes?: string[] };
  return data.contentTypes ?? [];
}

export type ChatMsg = { role: "user" | "assistant"; content: string };

/**
 * Brainstorm chat about one saved video. The route streams plain text, and
 * React Native's built-in fetch can't read a streaming body — expo/fetch can,
 * so the reply lands word by word instead of in one lump at the end.
 */
export async function streamChat(
  assetId: string,
  messages: ChatMsg[],
  onDelta: (chunk: string) => void,
): Promise<void> {
  const token = await getToken();
  const url = `${API_BASE}/api/reference/chat`;
  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ assetId, messages }),
  };

  // expo/fetch can read a streaming body, but its native module isn't in Expo
  // Go — importing it at module scope took the whole app down. Try it lazily,
  // and fall back to one-shot fetch (reply arrives whole) when it isn't there.
  let emitted = false;
  try {
    const { fetch: streamingFetch } = require("expo/fetch") as { fetch: typeof globalThis.fetch };
    const res = await streamingFetch(url, init);
    if (!res.ok) throw new Error(`chat ${res.status}`);
    if (res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        emitted = true;
        onDelta(decoder.decode(value, { stream: true }));
      }
    }
  } catch (e) {
    // Half a reply already on screen means this was a real failure, not a
    // missing module — don't run the request a second time.
    if (emitted) throw e;
  }

  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`chat ${res.status}`);
  onDelta(await res.text());
}

export async function fetchFramework(assetId: string): Promise<Framework> {
  const res = await authed(`/api/reference/framework?assetId=${encodeURIComponent(assetId)}`);
  if (!res.ok) throw new Error(`framework ${res.status}`);
  const data = (await res.json()) as { framework: Framework };
  return data.framework;
}
