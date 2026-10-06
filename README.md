# HP Monopoly Deal

A Harry Potter themed Monopoly Deal card game for 2 to 5 players, played in the browser.

It runs on Cloudflare Workers. Each room is a Durable Object (`worker/gameRoom.ts`) that keeps its game in storage, so games survive restarts and deploys. The React client and card images are served as static assets.

## Run locally

```sh
npm install
npm run dev        # http://localhost:5173, Worker and Durable Objects included
npm run check      # typecheck client and worker
```

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
