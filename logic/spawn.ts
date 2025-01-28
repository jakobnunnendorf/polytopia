export function spawnCapitals({
  players,
  mapSize,
}: {
  players: number;
  mapSize: number;
}): { x: number; y: number }[] {
  const center = Math.floor(mapSize / 2);
  const positions: { x: number; y: number }[] = [];

  // Polytopia-style quadrant division
  const regions = Math.sqrt(players);
  const regionSize = Math.floor(mapSize / regions);

  for (let i = 0; i < players; i++) {
    // Determine quadrant
    const row = Math.floor(i / regions);
    const col = i % regions;

    // Generate position within quadrant with padding
    const minX = col * regionSize + 2;
    const maxX = (col + 1) * regionSize - 2;
    const minY = row * regionSize + 2;
    const maxY = (row + 1) * regionSize - 2;

    // Random position within safe zone
    const x = Math.floor(Math.random() * (maxX - minX + 1)) + minX;
    const y = Math.floor(Math.random() * (maxY - minY + 1)) + minY;

    positions.push({ x, y });
  }

  return positions;
}
