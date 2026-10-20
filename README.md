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

Open `/screen` in one tab and `/` in another. On a laptop, steer with the arrow keys (or A/D). Tilt needs HTTPS, so test real phones against the deployed URL.

## Play on real phones

Phones need HTTPS for tilt steering, so share your laptop through a free Cloudflare quick tunnel. No Cloudflare account is needed.

1. Install `cloudflared` once:
   - macOS: `brew install cloudflared`
   - Windows: `winget install --id Cloudflare.cloudflared`
2. Run `npm run share`. It starts the server and the tunnel, then prints a public `https://….trycloudflare.com` URL.
3. Open `<URL>/screen` on the laptop. Phones scan the QR code; cellular data works too.

The URL changes on every run and stops when you press Ctrl+C. Anyone with the URL can reach your server, so stop it when you are done. Set `PORT` if 3000 is busy: `PORT=3900 npm run share`.

## How it works

- `server.js`: Express + Socket.IO. Serves `public/`, `/screen`, `/health` and `/qr.svg?u=<url>`. Relays car positions and broadcasts a `snapshot` about 15 times a second when anything changed.
- `lib/game.js`: in-memory player list (name, colour, x in -1..1, row).
- `public/js/phone.js`: join, tilt (`deviceorientation` gamma, calibrated on Start, small deadzone), hold-to-steer buttons if tilt is unavailable, Screen Wake Lock, ghosted other cars.
- `public/js/screen.js`: QR, player count, one row per player, smoothed movement.
- `public/js/steer.js`, `public/js/road.js`: shared steering math and canvas drawing.

Messages: phone → server `join {name?, color?}`, `state {x}`. Server → phone `welcome {id, name, color, x}`. Server → everyone `snapshot {players}`.

## Hosting

Served through a Cloudflare Tunnel to a single `npm start`. Game state is held in server memory, so run exactly **one** instance. Two would split the room.
