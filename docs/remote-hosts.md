# Remote Hosts

Kanna can index SSH hosts from the central server by adding `remoteHosts`
to the active settings file (`~/.kanna/data/settings.json` in production).

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
      "claudeEnabled": false,
      "terminalShell": "auto"
    }
  ]
}
```

`sshTarget` can be a Tailscale IP, for example `dev@100.64.0.10`. Remote project
discovery scans each configured root for git repositories up to two levels deep.
Remote terminals are launched through `ssh`, and remote Codex uses
`ssh <target> 'cd <project> && codex app-server'`.
Set `terminalShell` to `cmd` for Windows OpenSSH hosts that should open embedded
terminals in `cmd.exe` with a real TTY, including Tab completion and Ctrl+C.

Current limits:

- Remote Claude is not wired yet because the existing Claude SDK runtime is local
  to the Kanna server process. Run Kanna on the remote machine for Claude, or add
  a dedicated remote agent protocol before enabling `claudeEnabled`.
- Remote uploads, file preview content, and git diff actions are still local-only.
- SSH auth must be non-interactive. Use SSH keys or Tailscale SSH; password prompts are
  blocked by `BatchMode=yes`.
