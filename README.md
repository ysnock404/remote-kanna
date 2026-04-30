# Remote Kanna

Remote Kanna is a local-first remote coding UI focused on a central setup for multiple machines.

The target workflow is:

```text
browser -> Remote Kanna server -> SSH/Tailscale IP -> remote machine -> Codex / terminal
```

## Upstream Base

- Upstream Kanna links, hosted share, analytics, and self-update checks are intentionally disabled in this fork.
- Upstream base commit: `17ccafca8af2436067b08630bacfcf915ec83a8b`

Keep this commit around when rebasing or pulling newer Kanna changes into this fork.

## Current Focus

- Index projects from configured SSH machines
- Support direct Tailscale IP targets such as `dev@100.64.0.10`
- Open remote terminal sessions from the central Kanna UI
- Run remote Codex through `codex app-server` on the selected machine
- Preserve normal local Kanna behavior as the default path

## Current Limits

- Remote Claude is not wired yet. The current Claude SDK runtime runs local to the Kanna server process.
- Remote uploads, file previews, and git diff actions are still local-only.
- SSH auth must be non-interactive. Use SSH keys or Tailscale SSH; password prompts are blocked.

## Requirements

Central machine:

- Bun `1.3.5+`
- SSH access to remote machines

Each remote machine:

- SSH reachable from the central machine
- `codex` installed and authenticated
- `git`
- project directories present on disk
- `codex app-server` working from a project directory

## Install From Source

```bash
git clone https://github.com/ysnock404/remote-kanna.git
cd remote-kanna
bun install
bun run build
bun install -g .
```

Run:

```bash
kanna --no-open
```

Default URL:

```text
http://localhost:3210
```

## Remote Hosts

Configure remote hosts in the active settings file, normally:

```text
~/.kanna/data/settings.json
```

Example:

```json
{
  "remoteHosts": [
    {
      "id": "lab",
      "label": "Lab Workstation",
      "sshTarget": "dev@100.64.0.10",
      "enabled": true,
      "projectRoots": ["~/Projects", "~/work"],
      "codexEnabled": true,
      "claudeEnabled": false
    }
  ]
}
```

More detail: [docs/remote-hosts.md](docs/remote-hosts.md)

## Development

```bash
bun install
bun run dev
```

Useful checks:

```bash
bun run tsc --noEmit
bun test
bun run build
```

## Public Repo Safety

Do not commit real hostnames, usernames, Tailscale IPs, API keys, tokens, passwords, or private project paths. Keep machine-specific configuration in local settings only.

## License

[MIT](LICENSE)
