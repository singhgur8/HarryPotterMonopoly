# HP Monopoly Deal

A Harry Potter themed Monopoly Deal card game for 2 to 5 players, played in the browser.

It runs on Cloudflare Workers. Each room is a Durable Object (`worker/gameRoom.ts`) that keeps its game in storage, so games survive restarts and deploys. The React client is served as static assets from Cloudflare's CDN.

## Run locally

```sh
npm install
npm run dev        # http://localhost:5173, Worker and Durable Objects included
npm run check      # typecheck client and worker
npm run test:engine  # play bot games and check the tricky rules
```

To play-test on your own, create a room, take a seat, and press **Add a bot** for each opponent you want. Bots draw, play properties, bank money, charge rent, throw Yule Balls, send Goblins and use Protego. They never steal or destroy cards. To play as two people, open the room in a normal window and a private window.

## Deploy

One-time setup with a free Cloudflare account:

```sh
npx wrangler login
npm run deploy
```

The game is then live at `https://hp-monopoly-deal.<your-subdomain>.workers.dev`.

To deploy on every push after that, open the Worker in the Cloudflare dashboard, go to Settings > Builds > Connect, pick this repo, and set the build command to `npm run build` and the deploy command to `npx wrangler deploy --config dist/hp_monopoly_deal/wrangler.json`.

## Layout

- `client/` React app (Vite, Tailwind, shadcn)
- `shared/` card definitions and game types used by both sides
- `worker/index.ts` room API and WebSocket routing
- `worker/gameRoom.ts` one room: lobby, seats, turn timer, persistence
- `worker/gameEngine.ts` the game rules
