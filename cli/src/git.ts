import { execFile } from "node:child_process";

export type GitResult = { ok: true } | { ok: false; message: string };

function git(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd }, (error, _stdout, stderr) => {
      if (!error) return resolve({ ok: true });
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return resolve({ ok: false, message: "git isn't installed or isn't on PATH" });
      }
      resolve({ ok: false, message: `git ${args.join(" ")}: ${stderr.trim() || error.message}` });
    });
  });
}

export async function setUpGit(root: string, remote: string | undefined): Promise<GitResult> {
  const initialised = await git(root, ["init", "--quiet"]);
  if (!initialised.ok || remote === undefined) return initialised;
  return git(root, ["remote", "add", "origin", remote]);
}
