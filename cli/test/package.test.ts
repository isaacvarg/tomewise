import { execFile, spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { promisify } from "node:util";
import { describe, expect, it, onTestFinished } from "vitest";
import { copyExample, tempDir, writeFiles } from "../../core/test/helpers.ts";
import { buildPackage } from "../scripts/build-package.ts";

const exec = promisify(execFile);
const INDEX = "<!doctype html><title>Tomewise</title>";
const SESSION = "01KAJ0000000000000000000P1";

async function packed(): Promise<string> {
  const spa = await tempDir();
  await writeFiles(spa, { "index.html": INDEX });
  const out = join(await tempDir(), "tomewise");
  await buildPackage({ out, spa });
  const destination = await tempDir();
  await exec("npm", ["pack", "--silent", "--pack-destination", destination], { cwd: out });
  const [tarball] = await readdir(destination);
  return join(destination, tarball!);
}

describe("the tomewise npm package", () => {
  it("runs `npx tomewise serve` from a clean install", { timeout: 60_000 }, async () => {
    const tarball = await packed();
    const root = await copyExample("morse");
    const env = { ...process.env, HOME: await tempDir(), npm_config_cache: await tempDir(), npm_config_update_notifier: "false" };
    const child = spawn("npx", ["--yes", "--offline", "--package", tarball, "tomewise", "serve", "--port", "0"], { cwd: root, env, detached: true });
    const exited = new Promise<string>((resolve) => child.on("exit", (code, signal) => resolve(signal ? `killed by ${signal}` : `exited ${code}`)));
    onTestFinished(() => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {}
    });
    const stderr: string[] = [];
    child.stderr.on("data", (chunk) => stderr.push(String(chunk)));

    const [line] = (await Promise.race([
      once(createInterface({ input: child.stdout }), "line"),
      exited.then((how) => [`${how}: ${stderr.join("")}`]),
    ])) as [string];
    const url = /^Listening on (http:\/\/\S+)$/.exec(line)?.[1];
    expect(url, line).toBeDefined();

    const event = {
      id: SESSION,
      ts: "2026-11-21T18:00:00.000Z",
      subject: "morse-code",
      kind: "session.start",
      ref: "lesson:0001-k-and-m",
      sessionId: SESSION,
      schemaVersion: 2,
      data: {},
    };
    const posted = await fetch(`${url}/api/events`, { method: "POST", body: JSON.stringify(event) });
    expect(posted.status).toBe(201);
    const written = await readFile(join(root, "subjects/morse-code/events/2026-11.jsonl"), "utf8");
    expect(written.trimEnd().split("\n").at(-1)).toBe(JSON.stringify(event));

    const home = await fetch(`${url}/`);
    const homePage = await home.text();
    expect(homePage).toContain("<title>Tomewise</title>");
    expect(homePage).toContain(`@import url("/themes/paper/tokens.css") layer(theme);`);
    for (const file of ["/themes/paper/tokens.css", "/themes/paper/theme.json", "/widgets/v1/base.css", "/styleguide", "/styleguide/styleguide.js"]) {
      expect((await fetch(`${url}${file}`)).status, file).toBe(200);
    }

    const tome = await fetch(`${url}/widgets/v1/tome.js`);
    expect(tome.status).toBe(200);
    expect(tome.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(await tome.text()).toMatch(/export\s*\{/);

    process.kill(-child.pid!, "SIGTERM");
    await exited;
    await expect.poll(() => fetch(url!).then(() => "listening", () => "stopped"), { timeout: 5_000 }).toBe("stopped");
    expect(stderr.join("")).toBe("");
  });

  it("installs both the tomewise and tome commands, with no runtime dependencies", async () => {
    const out = join(await tempDir(), "tomewise");
    await buildPackage({ out });
    const manifest = JSON.parse(await readFile(join(out, "package.json"), "utf8"));

    expect(manifest.name).toBe("tomewise");
    expect(manifest.bin).toEqual({ tomewise: "lib/tome.js", tome: "lib/tome.js" });
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.repository.url).toBe("git+https://github.com/isaacvarg/tomewise.git");
    const { stdout } = await exec(process.execPath, [join(out, "lib/tome.js"), "validate"], {
      cwd: await copyExample("morse"),
    });
    expect(stdout).toMatch(/is valid\.$/m);
  });
});
