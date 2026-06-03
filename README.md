# Pixel Critter Dash

Cute pixel-animal online party runner prototype.

Players create a room, share an invite link or room code, choose an animal, and race through a pastel fruit-festival obstacle course. This first version is intentionally lightweight: a static browser client plus a small Node.js WebSocket room server.

## Current features

- Room codes like `BUNNY-482`
- Invite links with `?room=` and `?server=` parameters
- Lobby with host controls
- 2–8 online party players
- Shared deterministic obstacle track per race seed
- Live rival positions, scores, alive/bonked state
- Cute pixel-style animals: bunny, raccoon, cat, fox, panda, frog
- Obstacles: picnic baskets, boba pearls, sleepy turtles, puddles, fruit crates, mushrooms
- Pickups: berry score fruit, mango shield, fruit magnet bonus
- Keyboard and swipe controls
- Solo practice mode when no server is available

## Run locally

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

Open the same URL in multiple browser tabs to test party multiplayer.

## Controls

- Left/right arrows or A/D: change lanes
- Up arrow, W, or Space: jump
- Down arrow or S: slide
- Phone/tablet: swipe left/right/up/down

## Deploy on Render

The simplest public deployment is to let Render run this whole app: the Node server serves both the browser game and the WebSocket multiplayer rooms.

1. Push this repo to GitHub.
2. Go to https://dashboard.render.com/blueprints/new
3. Connect the `pixel-critter-dash` GitHub repo.
4. Render will detect `render.yaml`.
5. Click Apply / Deploy.

Render settings from `render.yaml`:

```text
Build command: npm install
Start command: npm start
Health check: /health
```

After deploy, players can visit the Render URL directly, for example:

```text
https://pixel-critter-dash.onrender.com
```

The WebSocket URL is the same host with `wss://`:

```text
wss://pixel-critter-dash.onrender.com
```

If the frontend is later hosted separately on GitHub Pages, set the in-game Server URL field to the Render WebSocket URL. Invite links include both the room code and server URL:

```text
https://YOUR_USERNAME.github.io/pixel-critter-dash/?room=BUNNY-482&server=wss%3A%2F%2Fpixel-critter-dash.onrender.com
```

## Project structure

```text
client/
  index.html
  styles.css
  game.js
server/
  server.js
tests/
  smoke.js
package.json
```

## Quality checks

```bash
npm run check
npm test
```

`npm test` starts the server on a random port, checks the static client, opens two WebSocket clients, creates a room, joins it, starts a race, and verifies state sync.

## Next polish ideas

- Animal select screen with larger animated previews
- Sound effects and tiny chiptune music
- Emotes in lobby and race
- Better winner podium after everyone bonks or finishes
- Powerup balancing and host settings
- GitHub Pages workflow for client-only deploy
- Render/Fly/Railway config for WebSocket backend
