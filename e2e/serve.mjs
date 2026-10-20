// Test server for Playwright: the real app with a short race so a full run takes seconds.
import { createDriverServer } from '../server.js';

const port = Number(process.env.PORT) || 3199;
const { httpServer } = createDriverServer({ countdownMs: 1_000, raceMs: 4_000 });
httpServer.listen(port, () => console.log(`e2e server on http://localhost:${port}`));
