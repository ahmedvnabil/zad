import { getSetting } from '../db/index.js';
import { applyOptimization } from '../routes/fallback.js';

// How often to re-apply the optimal fallback order while auto-optimize is on.
// Budgets drain over hours/days, so a few times a day is plenty.
const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const INITIAL_DELAY_MS = 30 * 1000;     // first run shortly after boot

function tick() {
  try {
    if (getSetting('auto_optimize') !== 'true') return;
    const count = applyOptimization();
    console.log(`[auto-optimize] re-ranked ${count} models by credit + capability`);
  } catch (err) {
    console.error('[auto-optimize] failed:', err);
  }
}

/**
 * Start the background auto-optimizer. It only does anything when the
 * `auto_optimize` setting is on (toggled from the Fallback page), so it's safe
 * to always start. Opt-in by design — it reorders the chain, never disables.
 */
export function startAutoOptimizer() {
  setTimeout(tick, INITIAL_DELAY_MS);
  setInterval(tick, INTERVAL_MS);
}
