# Discord bridge — Phase 1

Site → Discord is implemented. Discord → site, Discord AI commands and weekly
summaries are not enabled in this phase. No new browser polling or Cron Trigger
is added. Existing site chat, AI, leaderboard and Random Spin keep their flow.

## Channel and secret

- Server: `1383694439461158962`
- Channel: `1383694440023064758` (`#general`)
- Create a webhook in that channel: Edit Channel → Integrations → Webhooks.
  Creating it requires Manage Webhooks. A Discord bot/token is not needed yet.
- Store its URL as a **Secret** named `DISCORD_WEBHOOK_URL` on the `world` Worker
  in Cloudflare Settings → Variables and Secrets. Do not use a plaintext var.
  Alternatively run `npx wrangler secret put DISCORD_WEBHOOK_URL` and paste it
  at the prompt. Never put the URL in git, frontend code, chat or command history.
- Deploy the code with `npx wrangler deploy`, or the existing connected Git build.
  Saving the secret alone does not deploy the bridge code. Keep existing bindings
  and secrets. The webhook's configured channel determines delivery; the IDs above
  are documentation, not a way to redirect an existing webhook.

## Behavior and limits

Accepted text messages from both chat send endpoints and AI replies are posted
after saving. Photo and voice messages send their caption plus an attachment
notice; files themselves are not copied. Names and tiny symbols become webhook
usernames; accents become embed colors. Mentions never ping Discord users/roles.
New messages only: no history backfill, edit sync or deletion sync. The chat
notice explains that deleting on site leaves the Discord copy.

Delivery runs in `waitUntil`, with a five-second timeout per call. An explicit
429 with retry_after ≤ two seconds gets one retry. Other errors are skipped
without failing site chat. This is best effort, not guaranteed delivery; network
failures are not retried because Discord may already have received the message.
No delivery queue, per-message database writes or idle polling are added. Normally
one outgoing Discord request per new message; the one bounded 429 retry can add
another. Existing spam limits still run before message creation. Logs contain
only generic delivery state/status codes, never URLs, tokens or message bodies.

## Verify after deployment

1. Send a normal message in the Common Room. Confirm one copy in #general.
2. Change the saved listener symbol/accent, send again, and check username/color.
3. Send `@everyone`: confirm it does not notify the Discord server.
4. Send a photo/voice note and mention @deepAi; confirm notices and AI reply.
5. Remove the secret to disable the bridge. Site chat must continue working.

Local checks: `node --test tests/discord.test.mjs tests/chat-regressions.test.mjs
tests/deep-ai.test.mjs`. Live delivery requires the deployed Worker secret and
access to the destination Discord channel; local mocks do not prove live setup.

## Next phase prerequisites

Two-way chat needs a Discord application/bot, a server-side DISCORD_BOT_TOKEN
secret and channel configuration. Use View Channel and Read Message History;
Send Messages only if bot replies are enabled. Message Content access must be
configured for reading ordinary message text. Do not grant Administrator.
Plan one shared poller/cache, webhook/bot loop filtering and Discord-ID
deduplication before enabling inbound messages. Never fetch Discord separately
for every visitor. Weekly summaries and Discord AI commands follow separately.
