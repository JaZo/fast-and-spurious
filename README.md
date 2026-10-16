# 🏎️ Fast & Spurious

*Underground street racing. Overground stupidity.*

A browser street racer in the spirit of Need for Speed Underground: night-time city sprints, neon underglow, wet asphalt, a garage full of body kits and turbos, and an original soundtrack that sounds suspiciously like 2003. Multiplayer is peer-to-peer, so the whole game is a static site you can host on GitHub Pages.

## Play

- **Create a room**, then send your friends the invite link (`?room=ABCD`) from the lobby panel.
- Everyone presses **READY**, and the race starts once all of them have. The race is a single 3.5 km sprint through Spurious City, from the START gantry to the FINISH gantry, with no laps.
- Join a race that's already running and you drive as a ghost until the next one.
- Tune your car in the **GARAGE** (from the menu, or from the lobby between races).

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Throttle / brake & reverse | `W` `S` or `↑` `↓` | RT / LT |
| Steer | `A` `D` or `←` `→` | Left stick |
| Handbrake drift (refills nitro) | `Space` | A |
| Nitro | `Shift` | B |
| 💨 NOS purge | `Q` | LB |
| 🔦 High beams | `F` | RB |
| 📞 Spam call | `G` | D-pad up |
| Honk | `H` | Y |
| Reset to road | `R` | X |
| Camera (chase / bumper) | `C` | Back |
| Ready (lobby) | `Enter` | Start |
| Next song / mute music | `N` / `M` | |

## Spurious actions

These are mild ways to annoy the competition: they distract other drivers but never wreck them.

- **NOS Purge:** costs 15% nitrous and blasts a cold cloud out of your front bumper. Drivers who go through it get a fogged-up windscreen for a couple of seconds.
- **High Beams:** dazzles whoever is in front of you, within about 80 m, for a second or so.
- **Spam Call:** the driver directly ahead of you gets a call about their car's extended warranty. The phone covers their minimap and their music cuts out for 3.5 s.

Each action has a cooldown (10–25 s), and after an effect hits you you're immune to that same effect for 8 s.

## Garage

- **Performance:** six parts (Engine, Turbo, Transmission, Nitrous, Tires, Suspension), each with Stock, Street, Pro and Extreme levels. You get **10 Street Cred** to spend, while maxing everything would cost 18, so you have to pick a build.
- **Fine tuning:** sliders for gear ratio (acceleration vs top speed), downforce (top speed vs grip) and handling (drift vs grip).
- **Visual:** paint and finish (gloss, metallic, matte, pearl), body kits, spoilers (including *Absurd*), hoods, rims and rim colour, vinyls, neon underglow, window tint, headlights, exhausts, and the roof accessory everyone needs (traffic cone, rubber duck, crown).

Your build is saved in your browser. Other players see your looks; your performance parts only change how your own car drives.

## Music

The real NFSU soundtrack is licensed, so there's an original procedural one instead. Every note is synthesised live with WebAudio: crunk, drop-D nu-metal, big beat and a chilled garage track. An "EA TRAX"-style popup tells you who's playing:

- *Lil Jog & The East Side Boyz*: **Get Slow (To The Windooow)**
- *Static-X-haust*: **The Only Lane**
- *The Crystal Methods of Transport*: **Born Too Spurious**
- *Mudvayne Rover*: **Garage Days (Tint My Windows)**

## Run locally

It's a static site with no build step and no install. Serve the `public/` folder with any web server:

```bash
python3 -m http.server 8080 -d public
```

Then open <http://localhost:8080>. To test multiplayer on your own, open a second browser window and join the room code.

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. In the repo, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Every push to `main` deploys `public/` via [.github/workflows/pages.yml](.github/workflows/pages.yml).

## How multiplayer works

- The browser that **creates** a room becomes the **host**. It claims the PeerJS id `fast-and-spurious-v2-<CODE>` and runs the room logic ([public/js/room.js](public/js/room.js)): lobby, countdown, checkpoints, finish order and results.
- Other players connect straight to the host over a WebRTC data channel. The free public PeerJS server is only used to introduce the browsers to each other. If a direct connection isn't possible, PeerJS falls back to its public TURN relay.
- Each browser simulates its own car at 120 Hz and sends its state 20 times a second. The host batches everyone's state into snapshots, and other cars are drawn about 110 ms in the past and interpolated, so motion stays smooth.
- **If the host closes their tab, the room closes.** The host's room keeps ticking in a Web Worker, so alt-tabbing is fine.
- The host is trusted. Checkpoints only count in order, so nobody can skip the route, but someone determined could fake their speed. It's a game for friends.

```
public/
  index.html, css/style.css
  js/main.js       game loop, race flow, camera
  js/net.js        PeerJS host/client transport
  js/room.js       room state machine (runs on the host)
  js/track.js      the sprint: spline, road, sidewalks, barriers, gantries
  js/city.js       night city: sky, streetlights, buildings, neon, tunnel, overpasses
  js/car.js        arcade physics + tunable car model
  js/tuning.js     parts, sliders, visual options, build -> physics numbers
  js/garage.js     showroom + tuning menu
  js/spurious.js   purge / high beams / spam call
  js/music.js      procedural soundtrack
  js/audio.js      engine, turbo, blow-off valve, horns and other SFX
  js/hud.js        menu, lobby, tacho, minimap, results
```

Third-party code loads from jsDelivr with pinned versions: [three.js](https://threejs.org) 0.185.1 and [PeerJS](https://peerjs.com) 1.5.5.
