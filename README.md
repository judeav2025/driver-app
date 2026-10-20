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

1. Players scan the QR on `/screen` and tap **Start your engine**. In the lobby they can steer around an empty road.
2. The host presses **Start race** on `/screen`. Everyone gets a 3-second countdown, then a 60-second course that scrolls by itself and slowly speeds up.
3. Hitting a box spins your car out for a moment (no steering) and costs 50 points. You earn 10 points per second you're in the race.
4. At the end, `/screen` shows the leaderboard and each phone shows its own place. **Race again** starts a new course.

People can join mid-race; they score from when they joined.

## How it works

- `server.js`: Express + Socket.IO. Serves `public/`, `/screen`, `/health` and `/qr.svg?u=<url>`. Relays car positions and broadcasts a `snapshot` about 15 times a second when anything changed. Starts races and ends them on a timer.
- `lib/game.js`: in-memory player list (name, colour, x in -1..1, row, crashes) and the race clock: lobby → countdown → racing → results. Keeps score.
- `public/js/course.js`: shared by phones, screen, server and tests. Seeded PRNG (mulberry32), course built from the seed (rows of boxes, each with a guaranteed reachable gap), speed curve, box collisions, scoring.
- `public/js/phone.js`: join, tilt (`deviceorientation` gamma, calibrated on Start, small deadzone), hold-to-steer buttons if tilt is unavailable, Screen Wake Lock. During a race it simulates its own car, detects box hits locally, spins out, and shows time, score and results. Other cars are ghosts.
- `public/js/screen.js`: QR, player count, Start button, countdown, timer, leaderboard. Lobby shows one row per player; during a race every car sits on the same line over the shared course.
- `public/js/steer.js`, `public/js/road.js`: shared steering math and canvas drawing.

Messages:

- Phone → server: `join {name?, color?}`, `state {x}`, `crash` (once per box hit).
- Screen → server: `start`. Ignored from sockets that joined as players, or while a race is running.
- Server → phone: `welcome {id, name, color, x}`.
- Server → everyone: `snapshot {players: [{id, name, color, x, row, crashes}]}`, `start {seed, startsInMs, durationMs}`, `end {leaderboard: [{id, name, color, score, crashes}]}`.

`startsInMs` is relative, so no clock sync is needed. It's negative for anyone who connects mid-race. Every device builds the same course from `seed`.

## Hosting

Served through a Cloudflare Tunnel to a single `npm start`. Game state is held in server memory, so run exactly **one** instance. Two would split the room.
