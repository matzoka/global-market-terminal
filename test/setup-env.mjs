// Test bootstrap: set environment variables BEFORE any server module is imported.
// market-service.mjs evaluates config (incl. METALS_DEV_API_KEY) once at module
// load, so the key must be present before the first import in any test file.
if (!process.env.METALS_DEV_API_KEY) process.env.METALS_DEV_API_KEY = 'test-key-for-tests';
if (!process.env.MARKET_DATA_PROVIDER) process.env.MARKET_DATA_PROVIDER = 'none';
