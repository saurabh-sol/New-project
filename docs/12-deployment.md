# 12. Deployment

[Back to the index](README.md)

## How the site is hosted

| | |
| --- | --- |
| Host | [Render](https://render.com), a Node web service on the free plan |
| Address | <https://the-council-zvys.onrender.com> |
| Code | `github.com/saurabh-sol/New-project`, branch `main` |
| Deploys | Automatically, on every push to `main`. A deploy takes about three minutes |
| Build | `npm ci && npm run build` |
| Start | `npm run start` |
| Health check | `/api/health` |
| Node | 22 |
| Database | Postgres on Neon |
| Network | Robinhood Chain testnet |

`render.yaml` describes the service. It names every setting the service needs. The secret ones are marked `sync: false`: their values are set in Render's dashboard and are never in the file.

## Deploying a change

1. Commit the change and push it to `main`.
2. Render builds and starts the new version. The old one keeps serving until the new one answers its health check.
3. An admin display that is open loads the new version by itself, between sessions.

Build minutes on the free plan are limited. Push finished work, not every small step.

## Settings on the host

Set in the service's **Environment** page on Render:

| Group | Settings |
| --- | --- |
| Agents | `AI_GATEWAY_API_KEY` |
| Database | `DATABASE_URL` |
| Chain | `ROBINHOOD_NETWORK`, `NEXT_PUBLIC_ROBINHOOD_NETWORK`, `TREASURY_PRIVATE_KEY`, `USDG_ADDRESS` |
| Contracts | `DESK_QUANT`, `DESK_DEGEN`, `DESK_GUARDIAN`, `DESK_ORACLE`, `DESK_SHARES`, `DESK_FROM_BLOCK` |
| Funding and rewards | `CLAIM_SECRET`, `FAUCET_ENABLED`, `BONUS_LOCK_HOURS` |
| Admin | `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET` |

[Configuration](03-configuration.md) explains each. Anything not set takes its default, the agents' models included.

Three things to know:

- **Values that start with `NEXT_PUBLIC_` are fixed when the site is built.** Change one, and the service must be deployed again.
- **Changing a setting does not deploy by itself.** Deploy from the dashboard afterwards, or push a commit.
- **Run one server per treasury.** Two servers paying from the same wallet at once can take each other's place in its queue of transactions.

## The free plan sleeps

On Render's free plan the service sleeps after about a quarter of an hour without visitors. The first visit after that takes about a minute. While it sleeps, no session runs and no stop is checked.

| To keep the desk running | What it takes |
| --- | --- |
| Leave a display open | A Raspberry Pi on `/admin` or `/kiosk` keeps the server awake and the sessions running |
| A paid plan | The server stays awake, but sessions still need an open page to start them |

Either way, a desk that runs around the clock makes model calls around the clock. See [What it costs](13-operations.md#what-it-costs).

## The Raspberry Pi

A Pi 4 or 5 with a 1080p screen is the target.

1. Install Raspberry Pi OS with a desktop.
2. Turn off screen blanking in `raspi-config`, so the display stays on.
3. For the admin's display, open the site in Chromium, sign in once with a keyboard, and close the browser.
4. Start the browser full screen when the Pi starts. Put this in the desktop's autostart:

   ```bash
   chromium-browser --kiosk --noerrdialogs --disable-infobars --app=https://the-council-zvys.onrender.com/admin
   ```

   Use `/kiosk` instead of `/admin` for the public display, which needs no sign-in.

Do not start Chromium with `--incognito` for the admin's display. It has to keep its cookie between restarts.

The page fits one screen at 1280 by 720 and larger. On a narrower screen, such as the 7-inch Pi display, it scrolls.

## Another host

The app is a plain Next.js server. Any host that runs Node 20.9 or newer and keeps a process running will do. Two things to check:

- **The per-IP limits trust the `x-forwarded-for` header.** The server must sit behind a proxy you control, which sets it.
- **A session can take a minute.** A host that cuts requests off sooner will cut sessions short. The session route asks for up to five minutes.

## Moving to mainnet

The site runs on the testnet. The mainnet contracts are deployed and hold nothing. Pointing the site at them is a decision, not a switch, because with real USDG an agent's gain is the treasury's loss.

What it would take:

| Step | What to do |
| --- | --- |
| 1. Capital | The treasury needs USDG for the agents' capital: $100 for each agent, so $400, plus a reserve for their gains |
| 2. Gas | The treasury needs ETH on mainnet for the network fees |
| 3. Allowance | Run `scripts/deploy-desks.mjs` once more against the mainnet env file, without `--no-approve`, to let the contracts draw USDG from the treasury |
| 4. Books | Decide whether the desk starts with fresh books. The present books were made on the testnet |
| 5. Settings | On the host, set `ROBINHOOD_NETWORK` and `NEXT_PUBLIC_ROBINHOOD_NETWORK` to `mainnet`, the mainnet treasury key and the mainnet `DESK_` addresses, and deploy |
| 6. Funding | Leave `ALLOW_MAINNET_FUNDING` off unless you mean to hold users' money. See [Security and limits](14-security-and-limits.md) |
| 7. Ownership | Hand the contracts to a key that was never shared, with `setOwner` and `setOperator` |

Do not do this before reading [Security and limits](14-security-and-limits.md).
