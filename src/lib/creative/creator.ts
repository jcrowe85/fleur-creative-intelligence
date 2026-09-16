// Creator attribution.
//
// Meta carries no creator field. The only markers Fleur leaves are the affiliate
// code in the destination URL (`&trybe=<code>`) and the same code echoed in some
// ad names. A code identifies a link, not a person, and one creator runs many
// links — Deej alone holds 23 — so codes are collected onto a Creator and named
// from the prefix of the ad names running alongside them.
//
// Expect this to cover about a sixth of account spend. That is the real answer,
// not a gap to close: the rest of the library is TrendTrack-sourced ads
// (`6.27.26-TT-1782584412140`), animator ads (`7.29.26-ANIM-park-bench`) and
// internal creative that no Trybe creator made. Reports should therefore quote a
// creator's share of *creator* spend; measuring against the account total would
// make every creator look negligible.

import { db } from "@/lib/db";

/** `...?variant=123&trybe=d398c226` — the affiliate link on the creative. */
const URL_CODE = /[?&]trybe=([A-Za-z0-9._-]{2,32})/i;
/** The same code, when whoever named the ad kept it. */
const NAME_CODE = /trybe[=_-]([A-Za-z0-9]{2,24})/i;
/** `Deej_0812_30s` → `Deej`. Also matches campaign labels, filtered below. */
const NAME_PREFIX = /^([A-Za-z][A-Za-z0-9.'-]{1,20})[_\s-]/;

export interface CreatorRun {
  creators: number;
  fromCode: number;
  fromFamily: number;
  unnamedCodes: number;
  conflicts: number;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Rebuild creator attribution from scratch.
 *
 * Safe to re-run: it clears what it wrote before recomputing, so a code that
 * moves to a different creator doesn't leave a stale row behind.
 */
export async function attributeCreators(): Promise<CreatorRun> {
  const assets = await db.creativeAsset.findMany({
    select: { id: true, adIds: true, familyId: true, destinationUrl: true },
  });
  const adRows = await db.metaEntity.findMany({
    where: { level: "ad" },
    select: { id: true, name: true },
  });
  const adName = new Map(adRows.map((a) => [a.id, a.name ?? ""]));

  // 1. The codes on each asset, from the link and from its ads' names.
  const codesByAsset = new Map<string, Set<string>>();
  for (const a of assets) {
    const codes = new Set<string>();
    const u = URL_CODE.exec(a.destinationUrl ?? "");
    if (u) codes.add(u[1].toLowerCase());
    for (const id of a.adIds) {
      const m = NAME_CODE.exec(adName.get(id) ?? "");
      if (m) codes.add(m[1].toLowerCase());
    }
    if (codes.size > 0) codesByAsset.set(a.id, codes);
  }

  const codedAds = new Set<string>();
  for (const a of assets) {
    if (!codesByAsset.has(a.id)) continue;
    for (const id of a.adIds) codedAds.add(id);
  }

  // 2. Separate people from campaign labels.
  //
  // `Deej_0812_30s` and `TT_0621_hook` are the same shape to the regex. What
  // separates them is how reliably the prefix's ads carry a code, and measured
  // across this account the two populations don't come close to overlapping:
  //
  //   creators  50–100% of their ads coded  (deej 112/116, britneyparada 10/20)
  //   labels      0–9%                      (lla 5/56, md2 2/25, tt 0/284)
  //
  // So the threshold goes in the empty gap between them, with room on both
  // sides — it doesn't need to be precise, it needs to not be brittle. The
  // first version of this rule disqualified any prefix with even one uncoded
  // ad, which dropped Deej ($20,137, the account's largest creator) over four
  // ads that spent nothing, and wrongly reported 74 codes as unnameable when
  // in fact every code has a name.
  //
  // A prefix with a single ad, that ad coded, is kept: a creator's first ad
  // shouldn't have to wait for a second one to count.
  const PREFIX_CODED_SHARE = 0.25;
  const prefixAds = new Map<string, { coded: number; total: number }>();
  for (const ad of adRows) {
    const p = NAME_PREFIX.exec(ad.name ?? "");
    if (!p) continue;
    const key = p[1].toLowerCase();
    const st = prefixAds.get(key) ?? { coded: 0, total: 0 };
    st.total++;
    if (codedAds.has(ad.id)) st.coded++;
    prefixAds.set(key, st);
  }
  const labels = new Set<string>();
  for (const [key, st] of prefixAds) {
    const share = st.coded / st.total;
    const uncoded = st.total - st.coded;
    if (share < PREFIX_CODED_SHARE || (st.coded < 2 && uncoded > 0)) labels.add(key);
  }

  // 3. Name each code by the prefix its ads use most.
  const votes = new Map<string, Map<string, number>>();
  const display = new Map<string, string>();
  for (const a of assets) {
    const codes = codesByAsset.get(a.id);
    if (!codes) continue;
    for (const id of a.adIds) {
      const p = NAME_PREFIX.exec(adName.get(id) ?? "");
      if (!p) continue;
      const key = p[1].toLowerCase();
      if (labels.has(key)) continue;
      if (!display.has(key)) display.set(key, p[1]);
      for (const code of codes) {
        const tally = votes.get(code) ?? new Map<string, number>();
        tally.set(key, (tally.get(key) ?? 0) + 1);
        votes.set(code, tally);
      }
    }
  }

  let conflicts = 0;
  const codeName = new Map<string, string>();
  for (const [code, tally] of votes) {
    if (tally.size > 1) conflicts++;
    const [winner] = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    codeName.set(code, winner);
  }

  const allCodes = new Set<string>();
  for (const codes of codesByAsset.values()) for (const c of codes) allCodes.add(c);
  const unnamedCodes = [...allCodes].filter((c) => !codeName.has(c)).length;

  // 4. One Creator per name, holding every code that resolved to it. A code we
  //    can't put a name to keeps its `creatorCode` and gets no Creator row —
  //    inventing a person for an unmatched link would put a fiction in the
  //    roster, and the code is enough to chase it down later.
  const byName = new Map<string, string[]>();
  for (const [code, name] of codeName) {
    const list = byName.get(name) ?? [];
    list.push(code);
    byName.set(name, list);
  }

  // Fold "<creator>static" into "<creator>": in an ad account that suffix means
  // the same person's statics, not a second person.
  //
  // The suffix list stays tight on purpose. Measured across this roster there is
  // exactly one pair where a slug extends another (deej + deejstatic) and no
  // pair whose suffix is anything else, so the rule cannot fuse two different
  // people here — but it is a rule about NAMES. Deej and DeejStatic share no
  // affiliate code at all (23 against 1), so nothing in the data corroborates
  // the merge beyond the naming convention. Widening this list without
  // re-measuring would be inventing relationships.
  const CONTENT_SUFFIX = new Set([
    "static", "statics", "ugc", "video", "vid", "photo", "img", "image", "reel", "reels",
  ]);
  const mergedInto = new Map<string, string>();
  for (const ext of byName.keys()) {
    for (const base of byName.keys()) {
      if (ext === base || !ext.startsWith(base)) continue;
      if (CONTENT_SUFFIX.has(ext.slice(base.length))) mergedInto.set(ext, base);
    }
  }
  for (const [ext, base] of mergedInto) {
    byName.set(base, [...(byName.get(base) ?? []), ...(byName.get(ext) ?? [])]);
    byName.delete(ext);
    // Re-point the codes too, or their assets would resolve to a creator row
    // that is about to be deleted as stale.
    for (const [code, name] of codeName) if (name === ext) codeName.set(code, base);
  }

  const creatorIdByName = new Map<string, string>();
  for (const [name, codes] of byName) {
    const slug = slugify(name);
    const row = await db.creator.upsert({
      where: { slug },
      create: { slug, name: display.get(name) ?? name, codes: codes.sort() },
      update: { name: display.get(name) ?? name, codes: codes.sort() },
      select: { id: true },
    });
    creatorIdByName.set(name, row.id);
  }

  // 5. Assign. Direct first, then recover the re-uploads that lost their code.
  interface Attribution { creatorId: string | null; code: string; source: "code" | "family" }
  const pick = new Map<string, Attribution>();
  for (const [assetId, codes] of codesByAsset) {
    const code = [...codes].sort()[0];
    const name = codeName.get(code);
    pick.set(assetId, {
      creatorId: name ? creatorIdByName.get(name) ?? null : null,
      code,
      source: "code",
    });
  }

  // A creative uploaded five times often carries the code on only one of them.
  // The fingerprint families already say those uploads are the same video, so
  // the attribution carries across — this is the whole reason families landed
  // before attribution did.
  const byFamily = new Map<string, string[]>();
  for (const a of assets) {
    if (!a.familyId) continue;
    const list = byFamily.get(a.familyId) ?? [];
    list.push(a.id);
    byFamily.set(a.familyId, list);
  }
  let fromFamily = 0;
  for (const members of byFamily.values()) {
    const coded = members.map((id) => pick.get(id)).find((p) => p?.source === "code");
    if (!coded) continue;
    for (const id of members) {
      if (pick.has(id)) continue;
      pick.set(id, { creatorId: coded.creatorId, code: coded.code, source: "family" });
      fromFamily++;
    }
  }

  // 6. Write. Grouped, because one update per asset is ~1,500 sequential round
  //    trips over the pooler and that alone has blown the function limit here
  //    before.
  await db.creativeAsset.updateMany({
    where: { OR: [{ creatorId: { not: null } }, { creatorCode: { not: null } }] },
    data: { creatorId: null, creatorCode: null, creatorSource: null },
  });

  const groups = new Map<string, { attr: Attribution; ids: string[] }>();
  for (const [assetId, attr] of pick) {
    const key = `${attr.creatorId ?? ""}|${attr.code}|${attr.source}`;
    const g = groups.get(key) ?? { attr, ids: [] };
    g.ids.push(assetId);
    groups.set(key, g);
  }
  for (const { attr, ids } of groups.values()) {
    await db.creativeAsset.updateMany({
      where: { id: { in: ids } },
      data: { creatorId: attr.creatorId, creatorCode: attr.code, creatorSource: attr.source },
    });
  }

  // Creators whose codes all vanished shouldn't linger in the roster.
  await db.creator.deleteMany({
    where: { slug: { notIn: [...byName.keys()].map(slugify) } },
  });

  return {
    creators: byName.size,
    fromCode: codesByAsset.size,
    fromFamily,
    unnamedCodes,
    conflicts,
  };
}
