#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";

const VERSION = readPackageVersion();
const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;

type PackageManager = typeof PACKAGE_MANAGERS[number];

type CliArgs = {
  repo?: string;
  keyword?: string;
  zshrc?: string;
  yes: boolean;
  dryRun: boolean;
  remove: boolean;
  help: boolean;
  version: boolean;
  confirmed?: boolean;
};

type PackageJson = {
  version?: unknown;
  packageManager?: unknown;
  scripts?: Record<string, unknown>;
};

type GeneratedBlock = {
  block: string;
  startMarker: string;
  endMarker: string;
};

type ManagedMarkers = {
  startMarker: string;
  endMarker: string;
};

type RemovedBlock = {
  content: string;
  found: boolean;
};

type CompletionResult = [string[], string];

function readPackageVersion(): string {
  const packagePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8")) as PackageJson;
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function usage(): string {
  return `${terminalBox("repo-zsh-helper", [
    `version ${VERSION}`,
    "Generate a polished zsh command dashboard from package.json scripts.",
    "Usage: repo-zsh-helper --repo . --keyword app",
    "Interactive: repo-zsh-helper"
  ])}

Options:
  --repo <path>       Repo path. Defaults to ".".
  --keyword <name>    Shell command name to install.
  --zshrc <path>      Target zshrc path. Defaults to ~/.zshrc.
  --yes               Skip confirmation prompt.
  --dry-run           Print generated block without writing.
  --remove            Remove this helper's managed block for the keyword.
  --help              Show this help.
  --version           Show version.
`;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    repo: undefined,
    keyword: undefined,
    zshrc: undefined,
    yes: false,
    dryRun: false,
    remove: false,
    help: false,
    version: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo" || arg === "-r") args.repo = readOptionValue(argv, ++i, arg);
    else if (arg === "--keyword" || arg === "-k") args.keyword = readOptionValue(argv, ++i, arg);
    else if (arg === "--zshrc") args.zshrc = readOptionValue(argv, ++i, arg);
    else if (arg === "--yes" || arg === "-y") args.yes = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--remove" || arg === "--uninstall") args.remove = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--version" || arg === "-v") args.version = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  return args;
}

function readOptionValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (!value || value.startsWith("-")) throw new Error(`${option} requires a value.`);
  return value;
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function isDirectoryPath(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function isRepoPath(candidate: string): boolean {
  return isDirectoryPath(candidate) && fs.existsSync(path.join(candidate, "package.json"));
}

function formatRepoSuggestion(candidate: string, cwd = process.cwd()): string {
  const relative = path.relative(cwd, candidate);
  if (!relative) return ".";
  if (relative.startsWith("..")) return candidate;
  return `.${path.sep}${relative}`;
}

function repoPathSuggestions(cwd = process.cwd()): string[] {
  const suggestions: string[] = [];
  const seen = new Set<string>();

  const add = (candidate: string) => {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved) || !isRepoPath(resolved)) return;
    seen.add(resolved);
    suggestions.push(formatRepoSuggestion(resolved, cwd));
  };

  add(cwd);

  for (const parent of [cwd, path.join(cwd, "apps"), path.join(cwd, "packages")]) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(parent, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (suggestions.length >= 6) return suggestions;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const candidate = path.join(parent, entry.name);
      if (entry.isDirectory() || isDirectoryPath(candidate)) add(candidate);
    }
  }

  return suggestions;
}

function directoryPathCompleter(line: string): CompletionResult {
  const typed = line || "";
  const endsWithSeparator = typed.endsWith(path.sep);
  const rawDir = typed && !endsWithSeparator ? path.dirname(typed) : typed;
  const typedBase = typed && !endsWithSeparator ? path.basename(typed) : "";
  const displayDir = rawDir && rawDir !== "." ? `${rawDir.replace(/\/$/, "")}/` : "";
  const lookupDir = path.resolve(expandHome(rawDir || "."));

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(lookupDir, { withFileTypes: true });
  } catch {
    return [[], line];
  }

  const matches = entries
    .filter((entry) => {
      if (!typedBase && entry.name.startsWith(".")) return false;
      if (!entry.name.startsWith(typedBase)) return false;
      const candidate = path.join(lookupDir, entry.name);
      return entry.isDirectory() || isDirectoryPath(candidate);
    })
    .map((entry) => `${displayDir}${entry.name}/`)
    .sort();

  return [matches.length > 0 ? matches : [], line];
}

function validateKeyword(keyword: string | undefined): asserts keyword is string {
  if (!keyword) throw new Error("Keyword is required.");
  if (/^[0-9]/.test(keyword)) throw new Error("Keyword cannot start with a number.");
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(keyword)) {
    throw new Error("Keyword may only contain letters, numbers, underscores, and hyphens.");
  }
}

function shellFunctionName(keyword: string): string {
  return keyword.replaceAll("-", "_");
}

function timestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
    "-",
    ms
  ].join("");
}

function uniqueBackupPath(zshrcPath: string): string {
  const base = `${zshrcPath}.backup-${timestamp()}`;
  if (!fs.existsSync(base)) return base;

  for (let i = 1; i < 1000; i += 1) {
    const candidate = `${base}-${i}`;
    if (!fs.existsSync(candidate)) return candidate;
  }

  throw new Error(`Could not create a unique backup path for ${zshrcPath}`);
}

function zshQuote(value: string): string {
  return JSON.stringify(value);
}

function isPackageManager(value: string): value is PackageManager {
  return PACKAGE_MANAGERS.includes(value as PackageManager);
}

function detectPackageManager(repoPath: string, pkg: PackageJson): PackageManager {
  const declared = typeof pkg.packageManager === "string"
    ? pkg.packageManager.split("@")[0]
    : "";

  if (isPackageManager(declared)) return declared;
  if (fs.existsSync(path.join(repoPath, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(repoPath, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(repoPath, "bun.lock")) || fs.existsSync(path.join(repoPath, "bun.lockb"))) return "bun";
  if (fs.existsSync(path.join(repoPath, "package-lock.json"))) return "npm";
  return "npm";
}

function packageManagerCommand(packageManager: PackageManager): string {
  if (packageManager === "npm") return "npm run";
  if (packageManager === "bun") return "bun run";
  return packageManager;
}

const ASCII_FONT: Record<string, string[]> = {
  A: [" ### ", "#   #", "#####", "#   #", "#   #"],
  B: ["#### ", "#   #", "#### ", "#   #", "#### "],
  C: [" ####", "#    ", "#    ", "#    ", " ####"],
  D: ["#### ", "#   #", "#   #", "#   #", "#### "],
  E: ["#####", "#    ", "#### ", "#    ", "#####"],
  F: ["#####", "#    ", "#### ", "#    ", "#    "],
  G: [" ####", "#    ", "#  ##", "#   #", " ####"],
  H: ["#   #", "#   #", "#####", "#   #", "#   #"],
  I: ["#####", "  #  ", "  #  ", "  #  ", "#####"],
  J: ["#####", "   # ", "   # ", "#  # ", " ##  "],
  K: ["#   #", "#  # ", "###  ", "#  # ", "#   #"],
  L: ["#    ", "#    ", "#    ", "#    ", "#####"],
  M: ["#   #", "## ##", "# # #", "#   #", "#   #"],
  N: ["#   #", "##  #", "# # #", "#  ##", "#   #"],
  O: [" ### ", "#   #", "#   #", "#   #", " ### "],
  P: ["#### ", "#   #", "#### ", "#    ", "#    "],
  Q: [" ### ", "#   #", "#   #", "#  ##", " ####"],
  R: ["#### ", "#   #", "#### ", "#  # ", "#   #"],
  S: [" ####", "#    ", " ### ", "    #", "#### "],
  T: ["#####", "  #  ", "  #  ", "  #  ", "  #  "],
  U: ["#   #", "#   #", "#   #", "#   #", " ### "],
  V: ["#   #", "#   #", "#   #", " # # ", "  #  "],
  W: ["#   #", "#   #", "# # #", "## ##", "#   #"],
  X: ["#   #", " # # ", "  #  ", " # # ", "#   #"],
  Y: ["#   #", " # # ", "  #  ", "  #  ", "  #  "],
  Z: ["#####", "   # ", "  #  ", " #   ", "#####"],
  "0": [" ### ", "#  ##", "# # #", "##  #", " ### "],
  "1": ["  #  ", " ##  ", "  #  ", "  #  ", "#####"],
  "2": [" ### ", "#   #", "   # ", "  #  ", "#####"],
  "3": ["#### ", "    #", " ### ", "    #", "#### "],
  "4": ["#   #", "#   #", "#####", "    #", "    #"],
  "5": ["#####", "#    ", "#### ", "    #", "#### "],
  "6": [" ### ", "#    ", "#### ", "#   #", " ### "],
  "7": ["#####", "   # ", "  #  ", " #   ", "#    "],
  "8": [" ### ", "#   #", " ### ", "#   #", " ### "],
  "9": [" ### ", "#   #", " ####", "    #", " ### "],
  "-": ["     ", "     ", "#####", "     ", "     "],
  "_": ["     ", "     ", "     ", "     ", "#####"]
};

function asciiBanner(keyword: string): string {
  const letters = keyword.toUpperCase().split("");
  const art = Array.from({ length: 5 }, (_, row) => letters
    .map((letter) => ASCII_FONT[letter]?.[row] ?? ASCII_FONT["_"][row])
    .join("  ")
    .replace(/\s+$/, ""));

  return [...art, "COMMAND CENTER"].join("\n");
}

function line(char: string, width: number): string {
  return char.repeat(Math.max(0, width));
}

function frameTop(title: string, width = 94): string {
  const label = title ? ` ${title} ` : "";
  const remaining = Math.max(0, width - label.length);
  return `╭${line("─", Math.floor(remaining / 2))}${label}${line("─", Math.ceil(remaining / 2))}╮`;
}

function frameBottom(width = 94): string {
  return `╰${line("─", width)}╯`;
}

function zshPrintP(text: string): string {
  return `      print -P ${zshQuote(text)}\n`;
}

function zshPrint(text = ""): string {
  return `      print ${zshQuote(text)}\n`;
}

function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 3) return value.slice(0, width);
  return `${value.slice(0, width - 3)}...`;
}

function terminalBox(title: string, rows: string[], width = 86): string {
  const inner = width - 2;
  const top = frameTop(title, inner);
  const bottom = frameBottom(inner);
  const body = rows.map((row) => `│ ${truncate(row, inner - 2).padEnd(inner - 2)} │`);
  return [top, ...body, bottom].join("\n");
}

function displayLabel(script: string): string {
  return script
    .replace(/[:_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .slice(0, 28);
}

function groupFor(script: string): string {
  if (/deploy|release|publish|secret|migrate|email/.test(script)) return "Deploy + Operations";
  if (/(^|:)dev$|start|serve|preview|watch/.test(script)) return "Launch";
  if (/test|check|lint|format|type|build|validate|ci|fix/.test(script)) return "Quality";
  return "Scripts";
}

function makeShortcutMap(scripts: string[]): Array<[string, string]> {
  const candidates = new Map([
    ["dev", ["dev", "start", "studio:dev", "app:dev"]],
    ["start", ["start", "dev", "studio:dev", "app:dev"]],
    ["check", ["check", "validate", "ci"]],
    ["fast", ["check:fast"]],
    ["changed", ["check:changed"]],
    ["lint", ["lint", "biome:check"]],
    ["fix", ["lint:fix", "fix", "biome:fix"]],
    ["format", ["format", "biome:format"]],
    ["build", ["build"]],
    ["types", ["types", "typecheck", "type-check"]],
    ["test", ["test"]],
    ["deploy", ["deploy"]]
  ]);

  const shortcuts: Array<[string, string]> = [];
  for (const [alias, choices] of candidates) {
    const target = choices.find((choice) => scripts.includes(choice));
    if (target && target !== alias) shortcuts.push([alias, target]);
  }
  return shortcuts;
}

function managedMarkers(keyword: string): ManagedMarkers {
  return {
    startMarker: `# >>> repo-zsh-helper:${keyword} >>>`,
    endMarker: `# <<< repo-zsh-helper:${keyword} <<<`
  };
}

function generateBlock({
  keyword,
  functionName,
  packageManager,
  repoPath,
  scripts
}: {
  keyword: string;
  functionName: string;
  packageManager: PackageManager;
  repoPath: string;
  scripts: string[];
}): GeneratedBlock {
  const { startMarker, endMarker } = managedMarkers(keyword);
  const banner = asciiBanner(keyword);
  const groups = new Map();

  for (const script of scripts) {
    const group = groupFor(script);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(script);
  }

  const orderedGroups = ["Launch", "Deploy + Operations", "Quality", "Scripts"]
    .filter((group) => groups.has(group));
  const shortcuts = makeShortcutMap(scripts);
  let out = "";
  const command = packageManagerCommand(packageManager);
  const scriptCount = scripts.length;

  out += `${startMarker}\n`;
  out += `${functionName}() {\n`;
  out += `  local repo=${zshQuote(repoPath)}\n`;
  out += `  local package_manager=${zshQuote(packageManager)}\n\n`;
  out += `  _${functionName}_run_script() {\n`;
  out += `    case "$package_manager" in\n`;
  out += `      npm) npm run "$@" ;;\n`;
  out += `      pnpm) pnpm "$@" ;;\n`;
  out += `      yarn) yarn "$@" ;;\n`;
  out += `      bun) bun run "$@" ;;\n`;
  out += `      *) print -u2 "Unsupported package manager: $package_manager"; return 1 ;;\n`;
  out += `    esac\n`;
  out += `  }\n\n`;
  out += `  cd "$repo" || return\n\n`;
  out += `  case "$1" in\n`;
  out += `    ""|help)\n`;
  out += zshPrintP("%F{cyan}");
  out += `      cat <<'EOF'\n`;
  out += `${banner}\n`;
  out += `EOF\n`;
  out += zshPrintP("%f");
  out += zshPrintP(`%F{cyan}${frameTop(`${keyword} command dashboard`)}%f`);
  out += `      printf "│ %-18s │ %-18s │ %-18s │ %-25s │\\n" "keyword: ${keyword}" "scripts: ${scriptCount}" "runner: ${command}" "repo: \${repo:t}"\n`;
  out += zshPrintP(`%F{cyan}${frameBottom()}%f`);
  out += zshPrint();

  for (const group of orderedGroups) {
    out += zshPrintP(`%F{cyan}${frameTop(group)}%f`);
    out += `      printf "│ %-28s  %-26s  %-32s │\\n" "command" "label" "runs"\n`;
    out += zshPrintP(`%F{244}├${line("─", 94)}┤%f`);
    for (const script of groups.get(group)) {
      out += `      printf "│ %-28.28s  %-26.26s  %-32.32s │\\n" ${zshQuote(`${keyword} ${script}`)} ${zshQuote(displayLabel(script))} ${zshQuote(`${command} ${script}`)}\n`;
    }
    out += zshPrintP(`%F{cyan}${frameBottom()}%f`);
    out += zshPrint();
  }

  if (shortcuts.length > 0) {
    out += zshPrintP(`%F{magenta}${frameTop("Shortcuts")}%f`);
    out += `      printf "│ %-28s  %-26s  %-32s │\\n" "shortcut" "target" "runs"\n`;
    out += zshPrintP(`%F{244}├${line("─", 94)}┤%f`);
    for (const [alias, target] of shortcuts) {
      out += `      printf "│ %-28.28s  %-26.26s  %-32.32s │\\n" ${zshQuote(`${keyword} ${alias}`)} ${zshQuote(target)} ${zshQuote(`${command} ${target}`)}\n`;
    }
    out += zshPrintP(`%F{magenta}${frameBottom()}%f`);
    out += zshPrint();
  }

  out += zshPrintP(`%F{244}${frameTop("Controls")}%f`);
  out += `      printf "│ %-92s │\\n" "Run: ${keyword} <script> [...args]     Help: ${keyword} help     Extra args: ${keyword} check --force"\n`;
  out += `      printf "│ %-92s │\\n" "Fallback: unknown subcommands pass directly to ${command}, so custom scripts still work."\n`;
  out += zshPrintP(`%F{244}${frameBottom()}%f`);
  out += `      ;;\n`;

  for (const [alias, target] of shortcuts) {
    out += `    ${alias})\n`;
    out += `      _${functionName}_run_script ${zshQuote(target)} "\${@:2}"\n`;
    out += `      ;;\n`;
  }

  out += `    *)\n`;
  out += `      _${functionName}_run_script "$@"\n`;
  out += `      ;;\n`;
  out += `  esac\n`;
  out += `}\n`;
  out += `${endMarker}\n`;
  return { block: out, startMarker, endMarker };
}

function removeManagedBlock(existing: string, { startMarker, endMarker }: ManagedMarkers): RemovedBlock {
  const lines = existing.split(/\n/);
  const kept: string[] = [];
  let skip = false;
  let found = false;

  for (const line of lines) {
    if (line === startMarker) {
      if (skip) throw new Error(`Found nested managed block marker: ${startMarker}`);
      skip = true;
      found = true;
      continue;
    }
    if (line === endMarker) {
      if (!skip) throw new Error(`Found closing managed block marker without an opener: ${endMarker}`);
      skip = false;
      continue;
    }
    if (!skip) kept.push(line);
  }

  if (skip) throw new Error(`Found opening managed block marker without a closer: ${startMarker}`);

  return { content: kept.join("\n").replace(/\n*$/, ""), found };
}

function replaceManagedBlock(existing: string, generated: GeneratedBlock): string {
  const removed = removeManagedBlock(existing, generated);
  const base = removed.content.replace(/\n*$/, "");
  return base ? `${base}\n\n${generated.block}` : generated.block;
}

const TTY_COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[38;2;34;211;238m",
  green: "\x1b[38;2;90;214;125m",
  orange: "\x1b[38;2;255;184;77m",
  pink: "\x1b[38;2;255;93;163m",
  purple: "\x1b[38;2;180;124;255m",
  slate: "\x1b[38;2;137;148;171m"
};

type WizardField = "repo" | "keyword" | "confirm";

type WizardState = {
  args: CliArgs;
  field: WizardField;
  step: number;
  totalSteps: number;
  value: string;
  suggestions: string[];
  message: string;
};

function ttyEnabled(): boolean {
  return Boolean(input.isTTY && output.isTTY);
}

function color(text: string, value: string): string {
  return `${value}${text}${TTY_COLORS.reset}`;
}

function clearTty(): void {
  output.write("\x1b[2J\x1b[H");
}

function ttyWidth(): number {
  return Math.max(78, Math.min(output.columns || 100, 120));
}

function colorBox(title: string, rows: string[], accent = TTY_COLORS.cyan, width = ttyWidth() - 2): string {
  const inner = width - 2;
  const top = color(frameTop(title, inner), accent);
  const bottom = color(frameBottom(inner), accent);
  const body = rows.map((row) => `${color("│", accent)} ${truncate(row, inner - 2).padEnd(inner - 2)} ${color("│", accent)}`);
  return [top, ...body, bottom].join("\n");
}

function renderWizard(state: WizardState): void {
  const repo = state.args.repo || (state.field === "repo" ? state.value || "." : "pending");
  const keyword = state.args.keyword || (state.field === "keyword" ? state.value || "pending" : "pending");
  const action = state.args.remove ? "remove managed block" : "install command dashboard";
  const promptLabel = state.field === "repo"
    ? "Repo path"
    : state.field === "keyword"
      ? "Shell keyword"
      : `${state.args.remove ? "Remove from" : "Install into"} ~/.zshrc?`;
  const inputPreview = state.field === "confirm"
    ? "Press y to confirm, n or Enter to cancel"
    : `${state.field === "repo" && !state.value ? "." : state.value}${color("█", TTY_COLORS.green)}`;
  const keyRows = state.field === "confirm"
    ? ["y confirm   n/Enter cancel   Ctrl-C quit", "A backup is created before any managed block is changed."]
    : [
        `Enter accept${state.field === "repo" ? " current directory" : ""}   Tab autocomplete   Backspace edit`,
        "Ctrl-C quit",
        state.message || "The installer writes only a managed block and creates a backup first."
      ];
  const suggestionRows = state.suggestions.length > 0
    ? state.suggestions.map((suggestion, index) => `${index === 0 ? ">" : " "} ${suggestion}`)
    : ["No nearby package repos found. Type a path, or press Enter for current directory."];

  clearTty();
  output.write(color(asciiBanner("repo"), TTY_COLORS.cyan));
  output.write("\n");
  output.write(`${color("repo-zsh-helper setup", TTY_COLORS.bold)}  ${TTY_COLORS.dim}step${TTY_COLORS.reset} ${color(`${state.step}/${state.totalSteps}`, TTY_COLORS.pink)}  ${TTY_COLORS.dim}version${TTY_COLORS.reset} ${color(VERSION, TTY_COLORS.orange)}\n`);
  output.write(colorBox("plan", [
    `action: ${action}`,
    `repo: ${repo}`,
    `keyword: ${keyword}`,
    `target: ${state.args.zshrc || "~/.zshrc"}`
  ], TTY_COLORS.cyan));
  output.write("\n");
  if (state.field === "repo") {
    output.write(colorBox("repo suggestions", suggestionRows, TTY_COLORS.purple));
    output.write("\n");
  }
  output.write(colorBox(promptLabel, [inputPreview], state.field === "confirm" ? TTY_COLORS.orange : TTY_COLORS.green));
  output.write("\n");
  output.write(colorBox("keys", keyRows, TTY_COLORS.slate));
}

async function ttyPromptField(state: WizardState): Promise<string | undefined> {
  input.setRawMode(true);
  input.resume();
  renderWizard(state);

  return new Promise((resolve) => {
    const onData = (buffer: Buffer) => {
      const values = [...buffer.toString("utf8")];

      for (const value of values) {
        if (value === "\u0003") {
          cleanup();
          output.write("\n");
          resolve(undefined);
          return;
        }

        if (state.field === "confirm") {
          if (/^y$/i.test(value)) {
            cleanup();
            resolve("yes");
            return;
          }
          if (value === "\r" || /^n$/i.test(value) || value === "\x1b") {
            cleanup();
            resolve("no");
            return;
          }
        } else if (value === "\r") {
          cleanup();
          resolve(state.field === "repo" && !state.value.trim() ? "." : state.value.trim());
          return;
        } else if (value === "\t" && state.field === "repo") {
          const [matches] = directoryPathCompleter(state.value);
          if (matches.length > 0) {
            state.value = matches[0];
            state.message = `Completed to ${matches[0]}`;
          } else {
            state.message = "No path completions found.";
          }
        } else if (value === "\x7f" || value === "\b") {
          state.value = state.value.slice(0, -1);
          state.message = "";
        } else if (/^[ -~]$/.test(value)) {
          state.value += value;
          state.message = "";
        }
      }

      renderWizard(state);
    };

    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      clearTty();
    };

    input.on("data", onData);
  });
}

async function promptIfMissingTty(args: CliArgs): Promise<CliArgs> {
  const fields: WizardField[] = [];
  if (!args.remove && !args.repo) fields.push("repo");
  if (!args.keyword) fields.push("keyword");
  if (!args.yes && !args.dryRun) fields.push("confirm");

  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];
    const suggestions = field === "repo" ? repoPathSuggestions() : [];
    const result = await ttyPromptField({
      args,
      field,
      step: i + 1,
      totalSteps: fields.length,
      value: "",
      suggestions,
      message: field === "repo" ? "Press Enter for current directory, or Tab for path completion." : ""
    });

    if (result === undefined) {
      args.confirmed = false;
      return args;
    }
    if (field === "repo") args.repo = result || ".";
    else if (field === "keyword") args.keyword = result;
    else args.confirmed = result === "yes";
  }

  return args;
}

async function promptIfMissing(args: CliArgs): Promise<CliArgs> {
  if (ttyEnabled()) return promptIfMissingTty(args);

  const rl = readline.createInterface({ input, output, completer: directoryPathCompleter });
  try {
    if (!args.remove && !args.repo) {
      const suggestions = repoPathSuggestions();
      if (suggestions.length > 0) {
        output.write(`Repo suggestions: ${suggestions.join(", ")}\n`);
      }
      output.write("Tip: press Tab to autocomplete paths.\n");
      const answer = await rl.question("Repo path [.]: ");
      args.repo = answer.trim() || ".";
    }
    if (!args.keyword) {
      const answer = await rl.question("Keyword for shell command, e.g. app: ");
      args.keyword = answer.trim();
    }
    if (!args.yes && !args.dryRun) {
      const action = args.remove ? "Remove from" : "Install into";
      const answer = await rl.question(`${action} ~/.zshrc? [y/N]: `);
      args.confirmed = /^y(es)?$/i.test(answer.trim());
    }
  } finally {
    rl.close();
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  if (args.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  await promptIfMissing(args);
  if (!args.yes && !args.dryRun && !args.confirmed) {
    process.stdout.write("No changes made.\n");
    return;
  }

  validateKeyword(args.keyword);
  const zshrcPath = path.resolve(expandHome(args.zshrc || path.join(os.homedir(), ".zshrc")));

  if (args.remove) {
    const existing = fs.existsSync(zshrcPath) ? fs.readFileSync(zshrcPath, "utf8") : "";
    const removed = removeManagedBlock(existing, managedMarkers(args.keyword));

    if (!removed.found) {
      process.stdout.write(`No managed block found for keyword "${args.keyword}" in ${zshrcPath}.\n`);
      process.stdout.write("No changes made.\n");
      return;
    }

    if (args.dryRun) {
      process.stdout.write(`Would remove managed block for keyword "${args.keyword}" from ${zshrcPath}.\n`);
      return;
    }

    const backupPath = uniqueBackupPath(zshrcPath);
    fs.writeFileSync(backupPath, existing, { mode: 0o600 });
    fs.writeFileSync(zshrcPath, removed.content ? `${removed.content}\n` : "", { mode: 0o600 });

    process.stdout.write(`\n${terminalBox("Removed", [
      `function: ${shellFunctionName(args.keyword)}()`,
      `zshrc: ${zshrcPath}`,
      `backup: ${backupPath}`,
      `run: unfunction ${shellFunctionName(args.keyword)} 2>/dev/null; source ~/.zshrc`
    ])}\n`);
    return;
  }

  const repoPath = fs.realpathSync(path.resolve(expandHome(args.repo || ".")));
  const packagePath = path.join(repoPath, "package.json");
  if (!fs.existsSync(packagePath)) throw new Error(`No package.json found in ${repoPath}`);

  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8")) as PackageJson;
  const scripts = Object.keys(pkg.scripts || {}).sort();
  if (scripts.length === 0) throw new Error(`No package scripts found in ${packagePath}`);
  const packageManager = detectPackageManager(repoPath, pkg);

  const generated = generateBlock({
    keyword: args.keyword,
    functionName: shellFunctionName(args.keyword),
    packageManager,
    repoPath,
    scripts
  });

  if (args.dryRun) {
    process.stdout.write(generated.block);
    return;
  }

  const existing = fs.existsSync(zshrcPath) ? fs.readFileSync(zshrcPath, "utf8") : "";
  const backupPath = uniqueBackupPath(zshrcPath);
  fs.mkdirSync(path.dirname(zshrcPath), { recursive: true });
  fs.writeFileSync(backupPath, existing, { mode: 0o600 });
  fs.writeFileSync(zshrcPath, replaceManagedBlock(existing, generated), { mode: 0o600 });

  process.stdout.write(`\n${terminalBox("Installed", [
    `function: ${shellFunctionName(args.keyword)}()`,
    `scripts: ${scripts.length}`,
    `runner: ${packageManagerCommand(packageManager)}`,
    `repo: ${repoPath}`,
    `zshrc: ${zshrcPath}`,
    `backup: ${backupPath}`,
    "run: source ~/.zshrc"
  ])}\n`);
}

main().catch((error: unknown) => {
  if (!(error instanceof Error)) throw error;
  process.stderr.write(`Error: ${error.message}\n`);
  process.exit(1);
});
