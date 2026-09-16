// Rebuild creator attribution, then report what it covers.
//
//   npm run backfill:creators
//
// Read-only against Meta; writes only Creator rows and the three creator columns
// on CreativeAsset.

import { attributeCreators } from "@/lib/creative/creator";
import { db } from "@/lib/db";

const run = await attributeCreators();
console.log(
  `creators ${run.creators} · assets from code ${run.fromCode} · recovered via family ${run.fromFamily}` +
    ` · codes without a name ${run.unnamedCodes} · codes claimed by two names ${run.conflicts}`,
);

// Coverage, in spend. Quoted against the account total and against creator
// spend, because those two numbers tell very different stories.
const assets = await db.creativeAsset.findMany({
  select: { adIds: true, creatorId: true, creatorSource: true, creator: { select: { name: true } } },
});
const spend = await db.metaInsightDaily.groupBy({
  by: ["entityId"],
  where: { level: "ad" },
  _sum: { spend: true },
});
const spendById = new Map(spend.map((s) => [s.entityId, Number(s._sum.spend ?? 0)]));
const total = [...spendById.values()].reduce((a, b) => a + b, 0);
const sum = (ids: string[]) => ids.reduce((a, id) => a + (spendById.get(id) ?? 0), 0);

let coded = 0;
let family = 0;
const perCreator = new Map<string, number>();
for (const a of assets) {
  const s = sum(a.adIds);
  if (a.creatorSource === "code") coded += s;
  else if (a.creatorSource === "family") family += s;
  if (a.creator) perCreator.set(a.creator.name, (perCreator.get(a.creator.name) ?? 0) + s);
}
const attributed = coded + family;
const money = (v: number) => `$${Math.round(v).toLocaleString()}`;

console.log(`\nattributed ${money(attributed)} of ${money(total)} account spend (${((attributed / total) * 100).toFixed(0)}%)`);
console.log(`  from a code    ${money(coded)}`);
console.log(`  via family     ${money(family)}`);
console.log(`  the remaining ${money(total - attributed)} is TrendTrack, animator and internal creative — not creator work`);

console.log(`\ntop creators by spend (share of creator spend, not of the account):`);
console.log(
  [...perCreator.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([n, s]) => `  ${n.padEnd(22)} ${money(s).padStart(9)}  ${((s / attributed) * 100).toFixed(1)}%`)
    .join("\n"),
);

await db.$disconnect();
