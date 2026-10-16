# 🏎️ Fast & Spurious

*The Need for Speed knockoff your lawyer warned you about.*

A browser-based arcade racer with online multiplayer. Up to 8 drivers per room, 3 laps, nitro, handbrake drifts, synthesised horns (one of them is a goat), and a giant rubber duck in the infield. Everything runs in the browser with Three.js. A small Node server handles the rooms over WebSockets.

## Run it

With Docker (no Node needed):

```bash
docker compose up --build
```

Or with Node 20+:

```bash
npm install
npm start
```

Then open <http://localhost:3000>, pick a name and hit **FLOOR IT**. To race friends, send them the invite link from the lobby panel (`/?room=ABCD`). Everyone in a room presses **READY**, and the race starts once all of them have.

To play on your LAN, others can open `http://<your-ip>:3000`.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Throttle / brake & reverse | `W` `S` or `↑` `↓` | RT / LT |
| Steer | `A` `D` or `←` `→` | Left stick |
| Handbrake drift (refills nitro) | `Space` | A |
| Nitro | `Shift` | B |
| Honk | `H` | Y |
| Reset to track | `R` | X |
| Camera (chase / hood) | `C` | Back |
| Toggle ready (lobby) | `Enter` | Start |

## How it works

```
public/            browser client (ES modules, no build step)
  js/main.js       game loop, race flow, camera, networking glue
  js/track.js      spline track, road meshes, scenery, track queries
  js/car.js        arcade car physics + car model
  js/remote.js     other players' cars, interpolated between snapshots
  js/hud.js        menu, lobby, HUD, minimap, results
  js/audio.js      WebAudio engine/skid/horn synthesis
  js/fun.js        names, quips and other nonsense
shared/config.js   constants used by both server and client (laps, track points…)
server/index.js    static file server + WebSocket endpoint at /ws
server/rooms.js    rooms, lobby → countdown → racing → results state machine
```

- **Netcode.** Each client simulates its own car at 120 Hz and sends its state 20×/s. The server batches every player's latest state into a 20 Hz snapshot. Clients draw other cars about 110 ms in the past and interpolate between snapshots, so motion stays smooth.
- **Race authority.** The server owns phases, laps and finish order. Clients report checkpoints as they pass them, and the server only accepts them in order, so you can't skip half the lap.
- **Ghosts.** If you join mid-race, or after you finish, you drive as a see-through ghost that can't collide with anyone still racing.

## Deploying

Any host that runs Node or a Docker container and supports WebSockets will work, e.g. Fly.io, Railway, Render or a VPS. The server listens on `$PORT` (default `3000`). Behind a reverse proxy, forward the `Upgrade`/`Connection` headers for `/ws`.

## Ideas for later

AI bots for solo play, more tracks, touch controls, skid marks, server-side sanity checks on speed, lap records.
