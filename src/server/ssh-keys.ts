import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import type { SshPublicKeySnapshot } from "../shared/types"

const SSH_KEYGEN_TIMEOUT_MS = 10_000

export function getServerSshPrivateKeyPath(homeDir = homedir()) {
  return path.join(homeDir, ".ssh", "id_ed25519")
}

export function getServerSshPublicKeyPath(homeDir = homedir()) {
  return `${getServerSshPrivateKeyPath(homeDir)}.pub`
}

export function getLegacyServerSshPrivateKeyPath(homeDir = homedir()) {
  return path.join(homeDir, ".ssh", "remote_kanna_ed25519")
}

async function exists(filePath: string) {
  return Boolean(await stat(filePath).catch(() => null))
}

async function runSshKeygen(args: string[], fallbackError: string) {
  const child = Bun.spawn(["ssh-keygen", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const timeout = setTimeout(() => child.kill("SIGKILL"), SSH_KEYGEN_TIMEOUT_MS)
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (exitCode !== 0) {
      throw new Error(stderr.trim() || fallbackError)
    }
    return stdout
  } finally {
    clearTimeout(timeout)
  }
}

async function readFingerprint(publicKeyPath: string) {
  try {
    const output = await runSshKeygen(["-lf", publicKeyPath], "Unable to read SSH key fingerprint")
    return output.trim()
  } catch {
    return null
  }
}

export async function ensureServerSshPublicKey(homeDir = homedir()): Promise<SshPublicKeySnapshot> {
  const sshDir = path.join(homeDir, ".ssh")
  const privateKeyPath = getServerSshPrivateKeyPath(homeDir)
  const publicKeyPath = getServerSshPublicKeyPath(homeDir)

  await mkdir(sshDir, { recursive: true })
  await chmod(sshDir, 0o700).catch(() => undefined)

  let generated = false
  const hasPrivateKey = await exists(privateKeyPath)
  const hasPublicKey = await exists(publicKeyPath)

  if (!hasPrivateKey && !hasPublicKey) {
    await runSshKeygen([
      "-t",
      "ed25519",
      "-N",
      "",
      "-C",
      "kanna-server",
      "-f",
      privateKeyPath,
    ], "Unable to generate SSH key")
    generated = true
  } else if (hasPrivateKey && !hasPublicKey) {
    const publicKey = await runSshKeygen(["-y", "-f", privateKeyPath], "Unable to derive SSH public key")
    await writeFile(publicKeyPath, `${publicKey.trim()}\n`, "utf8")
  } else if (!hasPrivateKey && hasPublicKey) {
    throw new Error(`SSH public key exists but private key is missing: ${privateKeyPath}`)
  }

  await chmod(privateKeyPath, 0o600).catch(() => undefined)
  await chmod(publicKeyPath, 0o644).catch(() => undefined)

  return {
    publicKey: (await readFile(publicKeyPath, "utf8")).trim(),
    publicKeyPath,
    privateKeyPath,
    generated,
    fingerprint: await readFingerprint(publicKeyPath),
  }
}
