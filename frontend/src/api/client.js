/* The HTTP client for /api/v1 (section 16). Only the health endpoint exists so far; the game
   itself runs from localGame.js until M2 and M5 move its rules to the server. */
const BASE = '/api/v1';

export async function getHealth() {
  const res = await fetch(`${BASE}/health/`);
  if (!res.ok) throw new Error(`health check failed: ${res.status}`);
  return res.json();
}
