# Discord bot

Drive Zenith Panel from your Discord server: a **linked panel owner/admin** can create Minecraft
servers; everyone with access can use the permitted control actions and read port allocations without
opening the web panel.

The bot is built into the panel — a dependency-free Discord **gateway** client on top of `ws`,
which the panel already uses for the console socket. There is nothing extra to install, no
`discord.js`, and no second process to supervise.

---

## 1. Create the bot application

1. Open <https://discord.com/developers/applications> → **New Application** → give it a name.
2. **Bot** tab → **Add Bot** → **Reset Token** → copy the token (you will paste it in the panel).
3. Still on the **Bot** tab, enable these **Privileged Gateway Intents**:
   * **Message Content Intent** — *required*, otherwise the bot receives empty message text.
   * **Server Members Intent** — optional. Without it the panel cannot read a member's roles, so
     role-based admin access silently falls back to "linked account / guild owner only".
4. **OAuth2 → URL Generator**: scopes `bot`, `applications.commands` (optional) and permissions
   **Send Messages**, **Read Message History**, **Embed Links**. Open the generated URL and invite
   the bot to your server.
5. Copy the **Server (guild) id**: in Discord enable *Settings → Advanced → Developer Mode*, then
   right-click your server → **Copy Server ID**. Do the same for the channel you want notifications
   in (**Copy Channel ID**).

## 2. Configure it in the panel

**Admin → Settings → Subdomains & Discord** (admins/owners only):

| Field | Meaning |
| --- | --- |
| Bot token | from step 1. Stored in `data/db.json`, never returned to the browser (the UI only shows "saved"). |
| Server (guild) id | the bot ignores messages from every other guild. Strongly recommended. |
| Command prefix | default `!`. |
| Admin role name | members with this Discord role get admin rights in the bot (e.g. `owner`). |
| Notify channel id | server started / stopped / crashed events are posted here as embeds. |
| Default software / memory | values used by `!newserver` when you do not pass them. |
| Allow new registrations | when on, a linked panel owner/admin using `!newserver` can create a panel account for a brand-new owner username. |

Press **Save**, then **Start**. The badge turns green (`online`) and the log shows
`gateway socket open → identified as <bot>`. **Test message** posts a hello embed into the notify
channel. **Stop** disconnects; the panel auto-starts the bot again on the next boot if it was
enabled.

> Changing the token or guild id restarts the connection automatically.

## 3. Link Discord accounts to panel accounts

The bot never trusts Discord alone for permissions. Map a Discord user to a panel user once:

```
!link <panelUsername> <password>
```

The password is verified with the same bcrypt hash the web panel uses (rate-limited by the panel's
login limiter) and the link is stored on the panel user record. `!whoami` shows what the bot thinks
you are.

Access rules, in order:

1. **Guild owner** of the configured guild → admin in the bot.
2. Member of the configured **admin role** → admin in the bot.
3. **Linked panel account** with role `owner`/`admin` → admin in the bot.
4. Linked panel account with role `user` → may only touch servers they own or are a subuser of.

Everything else is refused with the reason (`no linked panel account`). Panel permissions per server
(`console`, `files`, …) are still enforced for the actions the bot performs.

## 4. Commands

| Command | Who | What it does |
| --- | --- | --- |
| `!help` | everyone | list the commands you are allowed to use |
| `!whoami` | everyone | which panel account your Discord user maps to |
| `!link <user> <pass>` | everyone | bind this Discord account to a panel account |
| `!servers` | everyone | your servers (admins see all), with status and address |
| `!status <id\|name>` | owner of the server | status, RAM, CPU, uptime, players |
| `!players <id\|name>` | owner of the server | who is online right now |
| `!start` `!stop` `!restart` `!kill` `<id\|name>` | owner of the server | power actions |
| `!cmd <id\|name> <command…>` | owner of the server | run a console command |
| `!op` `!deop` `!heal` `!feed` `<id\|name> <player>` | owner of the server | one-click player actions |
| `!give <id\|name> <player> <item> [count]` | owner of the server | hand out items |
| `!allocations [node]` | everyone | free/used ports per node |
| `!newserver <name> [type] [version] [memory] [node]` | linked panel owner/admin | create + install a server |
| `!log <id\|name>` | owner of the server | last console lines |

Servers can be named with spaces (`!status Survival SMP`) — the bot matches by id, exact name or a
unique prefix.

### Linked panel administrator `!newserver` walkthrough

```
!newserver My Cool SMP PAPER 1.21.4 2048 LocalNode
  → bot: "Which panel username should own this server? Reply here within 2 minutes (or `cancel`)."
  → you: discorduser
  → bot: "Created the panel account discorduser with password `x8Jd2ZqP1fLo` - change it in Account → Profile"
  → bot: "Creating My Cool SMP (PAPER 1.21.4, 2048 MB) on node Local node, port 25566 - installing now."
```

* A linked panel administrator owns the server by default; an administrator can choose an existing panel user as the owner.
* A Discord guild owner or configured Discord role without a linked panel owner/admin account cannot use `!newserver`; they must link that account or ask a panel administrator to provision and assign the server.
* Tokens are recognised by shape, so the name may contain spaces: `!newserver My Server PAPER 1.21.4 1024`.
* With registrations disabled (panel setting), only existing panel users can own new servers.

## 5. Notifications

When a notification channel is set, the bot posts an embed for:

* **server online** — the process reported ready,
* **server stopped** — clean shutdown, including panel/CLI restarts,
* **server crashed** — non-zero exit, with the last error when known.

## 6. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Bot stays `error`, log says *Discord rejected the bot token (401)* | token is wrong, revoked, or has whitespace. Paste it again. |
| Commands arrive but nothing happens | **Message Content Intent** is off — the message content is empty. Enable it and restart the bot. |
| `!commands` say "no linked panel account" | run `!link <panelUsername> <password>`, or set the right admin role name. |
| Bot answers in the wrong server | set the **Server (guild) id**; without it the bot listens everywhere it is invited. |
| Role checks never match | **Server Members Intent** is disabled, so roles cannot be read. |
| Nothing in the notify channel | the "Notify channel id" is missing (or the bot lacks *Send Messages* there). |
| `!newserver` replies "Unknown server type" | the type must be one of the panel's catalogue (`PAPER`, `PURPUR`, `VANILLA`, `FABRIC`, `QUILT`, `FORGE`, `NEOFORGE`, `SPIGOT`, `BUNGEECORD`, `VELOCITY`, `CUSTOM`). |

The bot's command surface can be tested without a token: the panel exposes an injectable transport,
so the command pipeline runs against a stub (`zenith.transport`), which is how the repository's own
tests exercise it offline.
