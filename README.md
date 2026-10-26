# Subscription usage

A drop-in extension for [Pi Pocket](https://github.com/TannerMidd/pi-pocket). It adds a page to the rail. The page shows how much of your Claude, ChatGPT (Codex), OpenCode Go, Grok, Z.ai, and MiniMax plans you used, and when each limit resets. When Pi has a DeepSeek key, it also shows the DeepSeek balance, in money left rather than a percentage.

## Install

In Pi Pocket 0.14 or newer, open **Menu → Extensions → Find extensions**, and find **Subscription usage**. The gallery installs it turned off. Read its source, or ask Pi to review it. Then turn it on in **Menu → Extensions**.

You can also copy these files into the extensions folder of Pi Pocket (`~/.pi-pocket/extensions/`), with the same names:

- `subscription-usage.ts`
- `subscription-usage/index.js`
- `subscription-usage/look.css`

## What it does

- **On the server:** it adds one route, `GET usage`, for the owner only. The route asks each service for your usage:
    - Claude and OpenCode Go: with the sign-ins that Pi already has on this computer. The Claude sign-in selector also offers **Claude Bridge (Claude Code)**. That option reads `claudeAiOauth.accessToken` from `$CLAUDE_CONFIG_DIR/.credentials.json`, or `~/.claude/.credentials.json` by default, and sends it only to the fixed Anthropic usage endpoint. It does not use Pi's `claude-bridge` placeholder auth entry, run login or credential commands, refresh a token, or fall back to another sign-in. Known-expired or malformed credentials show an error. File credentials are supported; OS keychains are not.
    - ChatGPT (Codex): it starts the Codex CLI (`codex app-server`), which uses its own sign-in. The Codex CLI must be installed and signed in (`codex login`).
    - Grok: with Pi's xAI sign-in for SuperGrok or X Premium (Menu → Providers). It reads the shared weekly pool, as the Grok CLI does. An xAI API key has no plan, so the page leaves Grok out.
    - Z.ai: with Pi's Z.ai key, for a GLM Coding Plan. It reads the 5-hour (and, on bigger plans, weekly) token windows and the monthly count of web search, web reader, and Zread calls. Without a Z.ai key, the page leaves Z.ai out.
    - MiniMax: with Pi's MiniMax key, for a Coding Plan (`sk-cp-` keys). It reads text and each other lane (video, say), in its short window and its week. A standard key (`sk-api-`) pays as it goes and has no plan, so the page leaves MiniMax out, as it does without a key.
    - DeepSeek: with the API key that Pi has, it asks [`GET /user/balance`](https://api-docs.deepseek.com/api/get-user-balance) for the money left, whether the key can take calls, and what makes up the balance (granted and topped up). Its card shows only when Pi has a DeepSeek key, so an account that does not use DeepSeek sees no card.
- **In the browser:** it adds a page and a rail button, for the owner only. The page shows the usage, and the DeepSeek balance. No key or token goes to the browser.
- **In chat:** it adds the command `/usage-plans`, for the owner only. Type it in any session's message box to post the same usage as a card in that session: each plan, each limit with a gauge, how full it is, and how long until it resets. The card is plain text, sized for a phone. Everyone in the session can read it, and Pi never gets it.

```
Claude (Anthropic) ───────────────────
   5h session  ■■■□□□□□□□  27%     49m
▸  Week, all   ■■■□□□□□□□  32%  4d 18h
   Week, Fable □□□□□□□□□□   0%  4d 18h
OpenCode Go ──────────────────────────
   5h, rolling ■□□□□□□□□□   2%  3h 32m
   Week        ■■□□□□□□□□  17%      1d
──────────────────────────────────────
▸ in force · read Oct 24, 6:51 PM CDT
```

In the margin, `▸` marks the limit in force, `!` a warning, and `!!` a critical level. A Pi Pocket command needs a `-` in its name, so it is `/usage-plans`, not `/usage`; typing `/usage` suggests it.

Use `/usage-plans bridge` for Claude Code's sign-in, or `/usage-plans pi` for Pi's Anthropic sign-in. With no argument, the command keeps the original Pi sign-in behavior; it does not read the browser's selection. The page and command keep separate cached results for each sign-in. The browser remembers its selection on that device. Stopping a command stops its wait; a shared read can continue for the page until its existing timeout or module disposal.

It runs no tools and changes nothing in your sessions, other than the cards that you post.

## Offline checks

With Node 24 and a Pi Pocket checkout, link its existing dependencies and public types:

```sh
ln -s /path/to/pi-pocket/node_modules node_modules
ln -s /path/to/pi-pocket/types/pocket.d.ts _pocket.d.ts
npm run check
npm test
```

The tests use fake sign-ins and mocked requests. They do not read real credentials, run a login command, or contact providers.

## License

MIT. Original extension by Tanner Middleton; Claude Code sign-in support contributed by Pierre Marrec.
