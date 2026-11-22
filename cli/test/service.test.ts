import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { copyExample } from "../../core/test/helpers.ts";
import { run } from "../src/main.ts";
import { systemdUnit, type Ran } from "../src/service.ts";

const PROGRAM = ["/usr/bin/node", "/opt/tomewise/lib/tome.js"];

interface Options {
  platform: NodeJS.Platform;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  answer?: (command: string[]) => Partial<Ran>;
}

async function service(args: string[], { platform, cwd, env = {}, answer = () => ({}) }: Options) {
  const home = await mkdtemp(join(tmpdir(), "tomewise-cli-home-"));
  const out: string[] = [];
  const err: string[] = [];
  const commands: string[][] = [];
  const code = await run(["service", ...args], {
    cwd: cwd ?? (await copyExample("morse")),
    env: { HOME: home, ...env },
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    service: {
      platform,
      program: PROGRAM,
      uid: 501,
      exec: async (command, rest) => {
        commands.push([command, ...rest]);
        return { code: 0, stdout: "", stderr: "", ...answer([command, ...rest]) };
      },
    },
  });
  return { code, home, commands, stdout: out.join("\n"), stderr: err.join("\n") };
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

describe("tome service on Linux", () => {
  const unit = (home: string) => join(home, ".config/systemd/user/tomewise.service");

  it("writes a systemd user unit running tome serve for the learning home, then enables and starts it", async () => {
    const root = await copyExample("morse");
    const result = await service(["install"], { platform: "linux", cwd: root });

    expect(result.code).toBe(0);
    expect(await readFile(unit(result.home), "utf8")).toBe(
      [
        "[Unit]",
        "Description=Tomewise learning app",
        "After=network.target",
        "",
        "[Service]",
        `ExecStart="/usr/bin/node" "/opt/tomewise/lib/tome.js" "serve" "--host" "127.0.0.1" "--port" "4777"`,
        `WorkingDirectory=${root}`,
        `Environment="TOMEWISE_HOME=${root}"`,
        "Restart=on-failure",
        "",
        "[Install]",
        "WantedBy=default.target",
        "",
      ].join("\n"),
    );
    expect(result.commands).toEqual([
      ["systemctl", "--user", "daemon-reload"],
      ["systemctl", "--user", "enable", "tomewise.service"],
      ["systemctl", "--user", "restart", "tomewise.service"],
    ]);
    expect(result.stdout).toContain("loginctl enable-linger");
  });

  it("passes --host and --port through to serve", async () => {
    const result = await service(["install", "--host", "0.0.0.0", "--port=8080"], { platform: "linux" });

    expect(await readFile(unit(result.home), "utf8")).toContain(
      `ExecStart="/usr/bin/node" "/opt/tomewise/lib/tome.js" "serve" "--host" "0.0.0.0" "--port" "8080"`,
    );
  });

  it("writes the unit under XDG_CONFIG_HOME when set", async () => {
    const config = await mkdtemp(join(tmpdir(), "tomewise-xdg-"));
    const result = await service(["install"], { platform: "linux", env: { XDG_CONFIG_HOME: config } });

    expect(result.code).toBe(0);
    expect(await exists(join(config, "systemd/user/tomewise.service"))).toBe(true);
  });

  it("escapes spaces, quotes, specifiers and variables in paths", () => {
    const file = systemdUnit(['/home/a b/node', '/x/"q"/100%$HOME'], { root: "/home/a b/50%$x", host: "::1", port: 1 });

    expect(file).toContain(`ExecStart="/home/a b/node" "/x/\\"q\\"/100%%$$HOME" "serve"`);
    expect(file).toContain("WorkingDirectory=/home/a b/50%%$x\n");
    expect(file).toContain(`Environment="TOMEWISE_HOME=/home/a b/50%%$x"\n`);
  });

  it("rejects a bad port without writing anything", async () => {
    const result = await service(["install", "--port", "nope"], { platform: "linux" });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--port must be a port number");
    expect(await exists(unit(result.home))).toBe(false);
    expect(result.commands).toEqual([]);
  });

  it("reports a failed systemctl and exits 1", async () => {
    const result = await service(["install"], {
      platform: "linux",
      answer: ([, , verb]) => (verb === "restart" ? { code: 1, stderr: "Failed to connect to bus" } : {}),
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Failed to connect to bus");
  });

  it("stops and removes the unit on uninstall", async () => {
    const root = await copyExample("morse");
    const installed = await service(["install"], { platform: "linux", cwd: root });
    const result = await run(["service", "uninstall"], {
      cwd: root,
      env: { HOME: installed.home },
      stdout: () => {},
      stderr: () => {},
      service: {
        platform: "linux",
        program: PROGRAM,
        uid: 501,
        exec: async (command, rest) => {
          installed.commands.push([command, ...rest]);
          return { code: 0, stdout: "", stderr: "" };
        },
      },
    });

    expect(result).toBe(0);
    expect(await exists(unit(installed.home))).toBe(false);
    expect(installed.commands.slice(3)).toEqual([
      ["systemctl", "--user", "disable", "--now", "tomewise.service"],
      ["systemctl", "--user", "daemon-reload"],
    ]);
  });

  it("does nothing on uninstall when no unit is installed", async () => {
    const result = await service(["uninstall"], { platform: "linux" });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("No service installed");
    expect(result.commands).toEqual([]);
  });

  it("reports not installed and not running", async () => {
    const result = await service(["status", "--json"], { platform: "linux", answer: () => ({ code: 3 }) });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      installed: false,
      running: false,
      file: unit(result.home),
    });
    expect(result.commands).toEqual([["systemctl", "--user", "is-active", "--quiet", "tomewise.service"]]);
  });

  it("reports running from systemctl is-active", async () => {
    const result = await service(["status"], { platform: "linux" });

    expect(result.stdout).toBe("Not installed.\nRunning.");
  });
});

describe("tome service on macOS", () => {
  const plist = (home: string) => join(home, "Library/LaunchAgents/tomewise.plist");

  it("writes a launchd agent running tome serve for the learning home, then loads it", async () => {
    const root = await copyExample("morse");
    const result = await service(["install", "--port", "5000"], { platform: "darwin", cwd: root });

    expect(result.code).toBe(0);
    const log = join(result.home, "Library/Logs/tomewise.log");
    expect(await readFile(plist(result.home), "utf8")).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        "<dict>",
        "  <key>Label</key>",
        "  <string>tomewise</string>",
        "  <key>ProgramArguments</key>",
        "  <array>",
        "    <string>/usr/bin/node</string>",
        "    <string>/opt/tomewise/lib/tome.js</string>",
        "    <string>serve</string>",
        "    <string>--host</string>",
        "    <string>127.0.0.1</string>",
        "    <string>--port</string>",
        "    <string>5000</string>",
        "  </array>",
        "  <key>WorkingDirectory</key>",
        `  <string>${root}</string>`,
        "  <key>EnvironmentVariables</key>",
        "  <dict>",
        "    <key>TOMEWISE_HOME</key>",
        `    <string>${root}</string>`,
        "  </dict>",
        "  <key>RunAtLoad</key>",
        "  <true/>",
        "  <key>KeepAlive</key>",
        "  <true/>",
        "  <key>StandardOutPath</key>",
        `  <string>${log}</string>`,
        "  <key>StandardErrorPath</key>",
        `  <string>${log}</string>`,
        "</dict>",
        "</plist>",
        "",
      ].join("\n"),
    );
    expect(result.commands).toEqual([["launchctl", "bootstrap", "gui/501", plist(result.home)]]);
  });

  it("reports running from launchctl print", async () => {
    const result = await service(["status", "--json"], {
      platform: "darwin",
      answer: () => ({ stdout: "gui/501/tomewise = {\n\tstate = running\n}\n" }),
    });

    expect(JSON.parse(result.stdout)).toMatchObject({ installed: false, running: true });
    expect(result.commands).toEqual([["launchctl", "print", "gui/501/tomewise"]]);
  });
});

describe("tome service on Windows", () => {
  it("prints instructions, installs nothing and exits 0", async () => {
    const result = await service(["install", "--port", "5000"], { platform: "win32" });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Task Scheduler");
    expect(result.stdout).toContain("tome serve --host 127.0.0.1 --port 5000");
    expect(result.commands).toEqual([]);
  });
});

describe("tome service usage", () => {
  it("rejects an unknown action", async () => {
    const result = await service(["restart"], { platform: "linux" });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("tome service install");
  });
});
