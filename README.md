# Kanna

Kanna is a local-only project chat UI for Claude-powered coding workflows.

It keeps the part that matters here: the project/chat experience itself. You point it at a folder, open the app locally, and work in multiple persistent chats tied to that project.

## What Kanna Includes

- a project-first sidebar
- multiple chats per project
- a local projects page
- transcript rendering
- plan mode / full access mode
- persistent local history
- refresh-safe chat routes

No auth. No cloud sync. No hosted database. Just a local app for talking to Claude about code in a real working directory.

## Scope

Kanna is intentionally focused.

It prioritizes:

- a strong local UI
- simple setup
- local persistence
- fast iteration

Out of scope:

- auth
- cloud sync
- settings
- automations
- charts
- broader admin/product features

## How It Works

Kanna runs as a local Bun app that serves a React frontend and talks over WebSockets.

State is stored locally under:

- `~/.kanna/data/projects.jsonl`
- `~/.kanna/data/chats.jsonl`
- `~/.kanna/data/messages.jsonl`
- `~/.kanna/data/turns.jsonl`
- `~/.kanna/data/snapshot.json`

Claude turns run locally against your actual project directory.

Kanna also scans:

- `~/.claude/projects`

to populate the Local Projects page from existing Claude-discovered projects, combined with projects you have already opened in Kanna.

## Project Structure

- `src/client/`
  React UI for the local project/chat experience
- `src/server/`
  Bun server, WebSocket routing, local persistence, Claude project discovery
- `src/shared/`
  Shared protocol and view-model types

## Requirements

- [Bun](https://bun.sh)
- a working local Claude Code / Claude Agent SDK environment

## Install

From the repo root:

```bash
cd /Users/jake/Projects/lever-next/workbench
bun install
```

## Run Production

From this folder:

```bash
cd /Users/jake/Projects/lever-next/workbench
bun run build
bun run start
```

If you install the package as a CLI, the command is:

```bash
kanna
```

Example:

```bash
cd /Users/jake/Projects/lever-next/workbench
bun run build
bun run start
```

Useful flags:

```bash
bun run start -- --no-open
bun run start -- --port 4000
```

Default production URL:

```text
http://localhost:3210
```

## Run Development

Run client and server together:

```bash
cd /Users/jake/Projects/lever-next/workbench
bun run dev
```

Or run them separately:

```bash
cd /Users/jake/Projects/lever-next/workbench
bun run dev:client
bun run dev:server
```

Default dev URLs:

- client: `http://localhost:5174`
- server: `http://localhost:3211`

## Scripts

- `bun run build`
- `bun run check`
- `bun run dev`
- `bun run dev:client`
- `bun run dev:server`
- `bun run start`

## Notes

- Kanna is intentionally local-only.
- The local server is the source of truth.
- Browser refreshes reconnect and rehydrate from the local server.
- Data lives in `~/.kanna/data`, not inside this repo.
# kanna
