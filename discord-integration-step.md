# Discord Bot Integration Steps

## Step 1 — Create a Discord Application

1. Open https://discord.com/developers/applications
2. Click **New Application** (top-right)
3. Enter a name (e.g. `yagent`) → click **Create**

---

## Step 2 — Create the Bot

1. Left sidebar → **Bot**
2. Click **Add Bot** → **Yes, do it!**

---

## Step 3 — Enable Message Content Intent (required)

Still on the **Bot** page, scroll down to **Privileged Gateway Intents**:

- ✅ **MESSAGE CONTENT INTENT** — toggle ON

> Without this, the bot can receive events but cannot read what users type.

---

## Step 4 — Get the Bot Token

1. Still on **Bot** page → click **Reset Token** → **Yes, do it!**
2. Copy the token
3. Open your `.env` file and paste it:

```
DISCORD_TOKEN=your-token-here
```

> Keep the token secret — anyone with it can control your bot.

---

## Step 5 — Invite the Bot to Your Server

1. Left sidebar → **OAuth2** → **URL Generator**
2. Under **Scopes**, check: `bot`
3. Under **Bot Permissions**, check:
   - `View Channels`
   - `Send Messages`
   - `Read Message History`
4. Copy the generated URL at the bottom
5. Open that URL in your browser → select your server → click **Authorize**

---

## Step 6 — Run the Bot

Stop the current app if running, then:

```bash
npm run dev
```

You should see in the terminal:
```
[discord] logged in as yagent#1234
[gateway] channel started: discord
```

---

## Step 7 — Test It

Go to any channel the bot can see in your server and type a message.

You should see:
- A **typing...** indicator while the agent thinks
- The bot **replies** to your message when done

For **DMs**: you must share a server with the bot first (Discord requirement), then DM it directly.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Bot logs in but doesn't respond | Message Content Intent not enabled (Step 3) |
| `[discord] handler error: DiscordAPIError` | Bot missing Send Messages permission in that channel |
| `Error: Used disallowed intents` | Message Content Intent not toggled ON in Developer Portal |
| Bot responds in server but not DMs | You don't share a server with the bot yet |
