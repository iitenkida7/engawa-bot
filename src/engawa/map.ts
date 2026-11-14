// Room names from engawa's map (GET /api/map), so a meeting can be labelled
// "Meeting room A" rather than by its zone id. Only the fields used are typed.

type Named = { id: string; name?: { ja?: string; en?: string } };

export type MapInfo = { rooms?: Named[]; lounges?: Named[]; teamAreas?: Named[] };

// Display name for a zone id, falling back to the id itself.
export function zoneName(
  map: MapInfo | null,
  zoneId: string | null,
  lang: 'ja' | 'en',
): string | null {
  if (!zoneId) return null;
  const all = [...(map?.rooms ?? []), ...(map?.lounges ?? []), ...(map?.teamAreas ?? [])];
  const z = all.find((x) => x.id === zoneId);
  return z?.name?.[lang] ?? z?.name?.ja ?? z?.name?.en ?? zoneId;
}
