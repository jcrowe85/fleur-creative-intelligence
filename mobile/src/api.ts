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

export async function fetchFramework(assetId: string): Promise<Framework> {
  const res = await authed(`/api/reference/framework?assetId=${encodeURIComponent(assetId)}`);
  if (!res.ok) throw new Error(`framework ${res.status}`);
  const data = (await res.json()) as { framework: Framework };
  return data.framework;
}
