import './env.js';
import { createApp } from './app.js';
import { initDb, getDb } from './db/index.js';
import { loadCustomProviders } from './providers/index.js';
import { startHealthChecker } from './services/health.js';
import { startAutoOptimizer } from './services/autoOptimize.js';
import { startBudgetGuard } from './services/budgetGuard.js';
import { startNotificationJobs } from './services/notifications.js';
import { loadFromCache, refreshRates } from './lib/litellm-pricing.js';

const PORT = process.env.PORT ?? 3001;

async function main() {
  initDb();
  loadFromCache(); // populate equivalent-paid pricing from disk before serving
  const customCount = loadCustomProviders(getDb()); // register dynamically-added providers
  if (customCount) console.log(`Registered ${customCount} custom provider(s)`);
  const app = createApp();

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log(`Proxy endpoint: http://0.0.0.0:${PORT}/v1/chat/completions`);
    startHealthChecker();
    startAutoOptimizer();
    startBudgetGuard();
    startNotificationJobs();
    // Non-blocking: refresh the LiteLLM pricing table in the background.
    refreshRates()
      .then(r => r.error
        ? console.warn(`LiteLLM pricing refresh skipped: ${r.error}`)
        : console.log(`LiteLLM pricing: ${r.entries} models priced`))
      .catch(() => {});
  });
}

main().catch(console.error);
