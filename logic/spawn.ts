import { createRng, shuffle, type Rng } from "./engine/rng";

/**
 * Place one capital per player, each in its own region of the map.
 *
 * The map is cut into a k×k grid of regions (k = ceil(sqrt(players))), the
 * players get distinct regions in random order, and each capital lands at a
 * random spot inside its region, kept away from the region edges so that
 * neighbouring capitals never touch.
 */
export function spawnCapitals({
  players,
  mapSize,
  rng = createRng(Math.floor(Math.random() * 2 ** 32)),
}: {
  players: number;
  mapSize: number;
  rng?: Rng;
}): { x: number; y: number }[] {
  const regions = Math.ceil(Math.sqrt(players));
  const regionSize = Math.floor(mapSize / regions);
  // keep a 2-tile margin inside each region when there is room for it
  const pad = regionSize >= 5 ? 2 : regionSize >= 3 ? 1 : 0;

  const cells = shuffle(
    rng,
    Array.from({ length: regions * regions }, (_, i) => i),
  ).slice(0, players);

  return cells.map((cell) => {
    const row = Math.floor(cell / regions);
    const col = cell % regions;
    const minX = col * regionSize + pad;
    const maxX = (col + 1) * regionSize - 1 - pad;
    const minY = row * regionSize + pad;
    const maxY = (row + 1) * regionSize - 1 - pad;
    return { x: rng.int(minX, maxX), y: rng.int(minY, maxY) };
  });
}
