import { spawn } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const SERVICE_NAME = "tomewise";
const SYSTEMD_UNIT = `${SERVICE_NAME}.service`;
const LAUNCHD_LABEL = SERVICE_NAME;

export interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ServiceHost {
  platform: NodeJS.Platform;
  program: string[];
  uid: number;
  exec: (command: string, args: string[]) => Promise<Ran>;
}

export interface ServiceIo {
  env: NodeJS.ProcessEnv;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  host: ServiceHost;
}

export interface ServeTarget {
  root: string;
  host: string;
  port: number;
}

function defaultServiceHost(): ServiceHost {
  return {
    platform: process.platform,
    program: [process.execPath, process.argv[1]!],
    uid: process.getuid?.() ?? 0,
    exec: (command, args) =>
      new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
        child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
      }),
  };
}

export function serviceHost(overrides: Partial<ServiceHost> = {}): ServiceHost {
  return { ...defaultServiceHost(), ...overrides };
}

function serveArgs(program: string[], target: ServeTarget): string[] {
  return [...program, "serve", "--host", target.host, "--port", String(target.port)];
}

function systemdQuote(arg: string): string {
  return `"${systemdValue(arg.replace(/[\\"]/g, "\\$&"))}"`;
}

function systemdExecArg(arg: string): string {
  return systemdQuote(arg).replace(/\$/g, "$$$$");
}

function systemdValue(value: string): string {
  return value.replace(/%/g, "%%");
}

export function systemdUnit(program: string[], target: ServeTarget): string {
  return [
    "[Unit]",
    "Description=Tomewise learning app",
    "After=network.target",
    "",
    "[Service]",
    `ExecStart=${serveArgs(program, target).map(systemdExecArg).join(" ")}`,
    `WorkingDirectory=${systemdValue(target.root)}`,
    `Environment=${systemdQuote(`TOMEWISE_HOME=${target.root}`)}`,
    "Restart=on-failure",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function launchdPlist(program: string[], target: ServeTarget, logFile: string): string {
  const strings = (values: string[]) => values.map((value) => `    <string>${xml(value)}</string>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${LAUNCHD_LABEL}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...strings(serveArgs(program, target)),
    "  </array>",
    "  <key>WorkingDirectory</key>",
    `  <string>${xml(target.root)}</string>`,
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    "    <key>TOMEWISE_HOME</key>",
    `    <string>${xml(target.root)}</string>`,
    "  </dict>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <true/>",
    "  <key>StandardOutPath</key>",
    `  <string>${xml(logFile)}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${xml(logFile)}</string>`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

interface Manager {
  file: string;
  contents: (target: ServeTarget) => string;
  install: string[][];
  uninstall: string[][];
  running: (io: ServiceIo) => Promise<boolean>;
  notes: string[];
}

function homeDir(env: NodeJS.ProcessEnv): string | undefined {
  return env.HOME || undefined;
}

function manager(io: ServiceIo, home: string): Manager | undefined {
  const { platform, program, uid } = io.host;
  if (platform === "linux") {
    const configHome = io.env.XDG_CONFIG_HOME || join(home, ".config");
    const systemctl = (...args: string[]) => ["systemctl", "--user", ...args];
    return {
      file: join(configHome, "systemd", "user", SYSTEMD_UNIT),
      contents: (target) => systemdUnit(program, target),
      install: [systemctl("daemon-reload"), systemctl("enable", SYSTEMD_UNIT), systemctl("restart", SYSTEMD_UNIT)],
      uninstall: [systemctl("disable", "--now", SYSTEMD_UNIT)],
      running: async (io) => (await io.host.exec("systemctl", ["--user", "is-active", "--quiet", SYSTEMD_UNIT])).code === 0,
      notes: [`It starts when you log in. To start it at boot without logging in, run \`loginctl enable-linger\`.`],
    };
  }
  if (platform === "darwin") {
    const domain = `gui/${uid}`;
    const file = join(home, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
    const logFile = join(home, "Library", "Logs", `${SERVICE_NAME}.log`);
    return {
      file,
      contents: (target) => launchdPlist(program, target, logFile),
      install: [["launchctl", "bootstrap", domain, file]],
      uninstall: [["launchctl", "bootout", `${domain}/${LAUNCHD_LABEL}`]],
      running: async (io) => {
        const ran = await io.host.exec("launchctl", ["print", `${domain}/${LAUNCHD_LABEL}`]);
        return ran.code === 0 && /^\s*state = running$/m.test(ran.stdout);
      },
      notes: [`It starts when you log in. Logs go to ${logFile}.`],
    };
  }
  return undefined;
}

function windowsInstructions(io: ServiceIo, target: ServeTarget | undefined): number {
  const command = target
    ? serveArgs(["tome"], target).join(" ")
    : "tome serve --host 127.0.0.1 --port 4777";
  io.stdout("tome service does not install anything on Windows. To run the app at log on:");
  io.stdout("  1. Open Task Scheduler and choose Create Task.");
  io.stdout('  2. On Triggers, add "At log on".');
  io.stdout(`  3. On Actions, start a program: ${command}`);
  if (target) io.stdout(`     with "Start in" set to ${target.root}`);
  io.stdout("  4. Save the task. Delete it in Task Scheduler to remove the service.");
  return 0;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function runAll(io: ServiceIo, commands: string[][]): Promise<boolean> {
  for (const [command, ...args] of commands) {
    let ran: Ran;
    try {
      ran = await io.host.exec(command!, args);
    } catch (error) {
      io.stderr(`Could not run ${command}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`);
      return false;
    }
    if (ran.code !== 0) {
      if (ran.stderr.trim()) io.stderr(ran.stderr.trim());
      io.stderr(`\`${[command, ...args].join(" ")}\` exited ${ran.code}`);
      return false;
    }
  }
  return true;
}

function setUp(io: ServiceIo): Manager | undefined {
  const home = homeDir(io.env);
  if (!home) {
    io.stderr("HOME is not set, so there is nowhere to write the service file.");
    return undefined;
  }
  const found = manager(io, home);
  if (!found) io.stderr(`tome service does not support ${io.host.platform}.`);
  return found;
}

export async function installService(io: ServiceIo, target: ServeTarget): Promise<number> {
  if (io.host.platform === "win32") return windowsInstructions(io, target);
  const found = setUp(io);
  if (!found) return 1;

  if (io.host.platform === "darwin" && (await exists(found.file))) {
    await io.host.exec(found.uninstall[0]![0]!, found.uninstall[0]!.slice(1)).catch(() => undefined);
  }
  await mkdir(dirname(found.file), { recursive: true });
  await writeFile(found.file, found.contents(target));
  if (!(await runAll(io, found.install))) {
    io.stderr(`Wrote ${found.file} but could not start it.`);
    return 1;
  }
  io.stdout(`Installed ${found.file}, serving ${target.root} on ${target.host}:${target.port}.`);
  for (const note of found.notes) io.stdout(note);
  return 0;
}

export async function uninstallService(io: ServiceIo): Promise<number> {
  if (io.host.platform === "win32") return windowsInstructions(io, undefined);
  const found = setUp(io);
  if (!found) return 1;

  if (!(await exists(found.file))) {
    io.stdout(`No service installed (${found.file} does not exist).`);
    return 0;
  }
  if (!(await runAll(io, found.uninstall))) return 1;
  await rm(found.file);
  if (io.host.platform === "linux") await runAll(io, [["systemctl", "--user", "daemon-reload"]]);
  io.stdout(`Stopped and removed ${found.file}.`);
  return 0;
}

export async function serviceStatus(io: ServiceIo, json: boolean): Promise<number> {
  if (io.host.platform === "win32") return windowsInstructions(io, undefined);
  const found = setUp(io);
  if (!found) return 1;

  const installed = await exists(found.file);
  let running = false;
  try {
    running = await found.running(io);
  } catch (error) {
    io.stderr(`Could not check whether it is running: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`);
  }
  if (json) {
    io.stdout(JSON.stringify({ installed, running, file: found.file }));
    return 0;
  }
  io.stdout(installed ? `Installed: ${found.file}` : "Not installed.");
  io.stdout(running ? "Running." : "Not running.");
  return 0;
}
