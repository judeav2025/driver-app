# AvantiCon Driver

Phone-tilt driving game for the AvantiCon hackathon. Everyone scans a QR code, gets a car, and steers by tilting their phone while the big screen shows every car.

Plan and milestones: [Linear project](https://linear.app/avantiplus/project/avanticon-driver-24ced053ad42/overview). Team rules: [AGENTS.md](AGENTS.md).

## Run locally

Node 22+.

```
npm install
npm start          # http://localhost:3000, projector view at /screen
npm run dev        # same, restarting on changes
npm test
```

Open `/screen` in one tab and `/` in another. On a laptop, steer with the arrow keys (or A/D). Tilt needs HTTPS, so test real phones through a tunnel (below) or the deployed URL.

## Play on real phones

Phones need HTTPS for tilt steering, so share your laptop through a free Cloudflare quick tunnel. No Cloudflare account is needed.

1. Install `cloudflared` once:
   - macOS: `brew install cloudflared`
   - Windows: `winget install --id Cloudflare.cloudflared`
2. Run `npm run share`. It starts the server and the tunnel, then prints a public `https://….trycloudflare.com` URL.
3. Open `<URL>/screen` on the laptop. Phones scan the QR code; cellular data works too.

The URL changes on every run and stops when you press Ctrl+C. Anyone with the URL can reach your server, so stop it when you are done. Set `PORT` if 3000 is busy: `PORT=3900 npm run share`.

## Playing

1. Players scan the QR on `/screen`, type a name (or leave it empty for a random one) and tap **Start your engine**. In the lobby they can steer around an empty road.
2. The host presses **Start race** on `/screen`. Everyone gets a 3-second countdown, then a 60-second course that scrolls by itself and slowly speeds up.
3. Hitting a box spins your car out for a moment (no steering) and costs 50 points. You earn 10 points per second you're in the race.
4. The course gets weird as it goes:
   - Pedestrians (and ducks, cows, a dinosaur…) wander back and forth across the road, more of them and stranger ones later on. Driving into one is a crash for you; they just hop clear, unhurt, with dizzy stars.
   - Pickups float between the box rows. Drive over one to grab it:
     - 🪙 coin: +30 points.
     - ⭐ star: 5 s of invincibility; boxes and pedestrians don't stop you.
     - 🪞 mirror: steering is flipped for 6 s.
     - 🦑 squid ink: ink splats cover the road ahead on your phone for 4.5 s.
   - The big screen shows each car's current pickup next to it.
5. At the end, `/screen` shows the leaderboard and each phone shows its own place. **Race again** starts a new course.

People can join mid-race; they score from when they joined.

Names keep letters, numbers, spaces and `' - ( )`, up to 24 characters; emoji and other symbols are dropped. A second "Sam" becomes "Sam (2)". The phone remembers the last typed name, and a reconnecting phone keeps its name.

## How it works

- `server.js` (Node) and `worker/index.js` (Cloudflare): both run `lib/room.js` over plain WebSockets at `/ws`. Serve `public/`, `/screen`, `/health` and `/qr.svg?u=<url>`. Relays car positions and broadcasts a `snapshot` about 15 times a second when anything changed. Starts races and ends them on a timer.
- `lib/game.js`: in-memory player list (name, colour, x in -1..1, row, crashes) and the race clock: lobby → countdown → racing → results. Keeps score.
- `public/js/course.js`: shared by phones, screen, server and tests. Seeded PRNG (mulberry32), course built from the seed (rows of boxes, each with a guaranteed reachable gap; pedestrians and pickups halfway between rows, from a second PRNG stream so the boxes don't depend on them), speed curve, collisions, scoring. Pedestrian positions are a function of race time, so every device sees them in the same place.
- `public/js/phone.js`: join, tilt (`deviceorientation` gamma, calibrated on Start, small deadzone), hold-to-steer buttons if tilt is unavailable, Screen Wake Lock. During a race it simulates its own car, detects box hits locally, spins out, and shows time, score and results. Other cars are ghosts.
- `public/js/screen.js`: QR, player count, Start button, countdown, timer, leaderboard. Lobby shows one row per player; during a race every car sits on the same line over the shared course.
- `public/js/steer.js`, `public/js/road.js`: shared steering math and canvas drawing.

Messages:

- Phone → server: `join {name?, color?}`, `state {x}`, `crash` (once per box or pedestrian hit), `pickup {i}` (index into the course's pickups; each counts once per player per race).
- Screen → server: `start`. Ignored from sockets that joined as players, or while a race is running.
- Server → phone: `welcome {id, name, color, x}`.
- Server → everyone: `snapshot {players: [{id, name, color, x, row, crashes, coins, pickups, lastPickup}]}`, `start {seed, startsInMs, durationMs}`, `end {leaderboard: [{id, name, color, score, crashes, coins}]}`.

`startsInMs` is relative, so no clock sync is needed. It's negative for anyone who connects mid-race. Every device builds the same course from `seed`.

## Hosting

Cloudflare Workers (free plan). `wrangler.jsonc` defines the Worker, the static assets in `public/` and one `GameRoom` Durable Object that holds the game. A push to `main` deploys through the Cloudflare Git connection. `npm run cf:dev` runs the same setup locally; `npm start` still runs the plain Node server for tests and `npm run share`.

Game state is held in memory in one room, so there must be exactly **one** instance.
