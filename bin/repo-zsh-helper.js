#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
const VERSION = readPackageVersion();
const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"];
function readPackageVersion() {
    const packagePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    try {
        const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
        return typeof pkg.version === "string" ? pkg.version : "0.0.0";
    }
    catch {
        return "0.0.0";
    }
}
function usage() {
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
function parseArgs(argv) {
    const args = {
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
        if (arg === "--repo" || arg === "-r")
            args.repo = readOptionValue(argv, ++i, arg);
        else if (arg === "--keyword" || arg === "-k")
            args.keyword = readOptionValue(argv, ++i, arg);
        else if (arg === "--zshrc")
            args.zshrc = readOptionValue(argv, ++i, arg);
        else if (arg === "--yes" || arg === "-y")
            args.yes = true;
        else if (arg === "--dry-run")
            args.dryRun = true;
        else if (arg === "--remove" || arg === "--uninstall")
            args.remove = true;
        else if (arg === "--help" || arg === "-h")
            args.help = true;
        else if (arg === "--version" || arg === "-v")
            args.version = true;
        else
            throw new Error(`Unknown option: ${arg}`);
    }
    return args;
}
function readOptionValue(argv, index, option) {
    const value = argv[index];
    if (!value || value.startsWith("-"))
        throw new Error(`${option} requires a value.`);
    return value;
}
function expandHome(value) {
    if (value === "~")
        return os.homedir();
    if (value.startsWith("~/"))
        return path.join(os.homedir(), value.slice(2));
    return value;
}
function isDirectoryPath(candidate) {
    try {
        return fs.statSync(candidate).isDirectory();
    }
    catch {
        return false;
    }
}
function isRepoPath(candidate) {
    return isDirectoryPath(candidate) && fs.existsSync(path.join(candidate, "package.json"));
}
function repoDisplayName(repoPath) {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(path.resolve(expandHome(repoPath)), "package.json"), "utf8"));
        if (typeof pkg.name === "string" && pkg.name.trim())
            return pkg.name.split("/").pop() || pkg.name;
    }
    catch {
        // Fall through to folder name.
    }
    return path.basename(path.resolve(expandHome(repoPath))) || "repo";
}
function suggestedKeyword(repoPath) {
    const cleaned = repoDisplayName(repoPath)
        .toLowerCase()
        .replace(/^@[^/]+\//, "")
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
    if (!cleaned || /^[0-9]/.test(cleaned))
        return "app";
    if (cleaned.length <= 14)
        return cleaned;
    const parts = cleaned.split(/[-_]+/).filter(Boolean);
    const short = parts
        .map((part) => part[0])
        .join("")
        .slice(0, 12);
    return /^[a-z_]/.test(short) && short.length >= 2 ? short : cleaned.slice(0, 14);
}
function formatRepoSuggestion(candidate, cwd = process.cwd()) {
    const relative = path.relative(cwd, candidate);
    if (!relative)
        return ".";
    if (relative.startsWith(".."))
        return candidate;
    return `.${path.sep}${relative}`;
}
function repoPathSuggestions(cwd = process.cwd()) {
    const suggestions = [];
    const seen = new Set();
    const add = (candidate) => {
        const resolved = path.resolve(candidate);
        if (seen.has(resolved) || !isRepoPath(resolved))
            return;
        seen.add(resolved);
        suggestions.push(formatRepoSuggestion(resolved, cwd));
    };
    add(cwd);
    for (const parent of [cwd, path.join(cwd, "apps"), path.join(cwd, "packages")]) {
        let entries;
        try {
            entries = fs.readdirSync(parent, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            if (suggestions.length >= 6)
                return suggestions;
            if (entry.name.startsWith(".") || entry.name === "node_modules")
                continue;
            const candidate = path.join(parent, entry.name);
            if (entry.isDirectory() || isDirectoryPath(candidate))
                add(candidate);
        }
    }
    return suggestions;
}
function directoryPathCompleter(line) {
    const typed = line || "";
    const endsWithSeparator = typed.endsWith(path.sep);
    const rawDir = typed && !endsWithSeparator ? path.dirname(typed) : typed;
    const typedBase = typed && !endsWithSeparator ? path.basename(typed) : "";
    const displayDir = rawDir && rawDir !== "." ? `${rawDir.replace(/\/$/, "")}/` : "";
    const lookupDir = path.resolve(expandHome(rawDir || "."));
    let entries;
    try {
        entries = fs.readdirSync(lookupDir, { withFileTypes: true });
    }
    catch {
        return [[], line];
    }
    const matches = entries
        .filter((entry) => {
        if (!typedBase && entry.name.startsWith("."))
            return false;
        if (!entry.name.startsWith(typedBase))
            return false;
        const candidate = path.join(lookupDir, entry.name);
        return entry.isDirectory() || isDirectoryPath(candidate);
    })
        .map((entry) => `${displayDir}${entry.name}/`)
        .sort();
    return [matches.length > 0 ? matches : [], line];
}
function validateKeyword(keyword) {
    if (!keyword)
        throw new Error("Keyword is required.");
    if (/^[0-9]/.test(keyword))
        throw new Error("Keyword cannot start with a number.");
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(keyword)) {
        throw new Error("Keyword may only contain letters, numbers, underscores, and hyphens.");
    }
}
function shellFunctionName(keyword) {
    return keyword.replaceAll("-", "_");
}
function timestamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
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
function uniqueBackupPath(zshrcPath) {
    const base = `${zshrcPath}.backup-${timestamp()}`;
    if (!fs.existsSync(base))
        return base;
    for (let i = 1; i < 1000; i += 1) {
        const candidate = `${base}-${i}`;
        if (!fs.existsSync(candidate))
            return candidate;
    }
    throw new Error(`Could not create a unique backup path for ${zshrcPath}`);
}
function zshQuote(value) {
    return JSON.stringify(value);
}
function isPackageManager(value) {
    return PACKAGE_MANAGERS.includes(value);
}
function detectPackageManager(repoPath, pkg) {
    const declared = typeof pkg.packageManager === "string"
        ? pkg.packageManager.split("@")[0]
        : "";
    if (isPackageManager(declared))
        return declared;
    if (fs.existsSync(path.join(repoPath, "pnpm-lock.yaml")))
        return "pnpm";
    if (fs.existsSync(path.join(repoPath, "yarn.lock")))
        return "yarn";
    if (fs.existsSync(path.join(repoPath, "bun.lock")) || fs.existsSync(path.join(repoPath, "bun.lockb")))
        return "bun";
    if (fs.existsSync(path.join(repoPath, "package-lock.json")))
        return "npm";
    return "npm";
}
function packageManagerCommand(packageManager) {
    if (packageManager === "npm")
        return "npm run";
    if (packageManager === "bun")
        return "bun run";
    return packageManager;
}
const ASCII_FONT = {
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
function asciiBanner(keyword) {
    const letters = keyword.toUpperCase().split("");
    const art = Array.from({ length: 5 }, (_, row) => letters
        .map((letter) => ASCII_FONT[letter]?.[row] ?? ASCII_FONT["_"][row])
        .join("  ")
        .replace(/\s+$/, ""));
    return [...art, "COMMAND CENTER"].join("\n");
}
function line(char, width) {
    return char.repeat(Math.max(0, width));
}
function frameTop(title, width = 94) {
    const label = title ? ` ${title} ` : "";
    const remaining = Math.max(0, width - label.length);
    return `╭${line("─", Math.floor(remaining / 2))}${label}${line("─", Math.ceil(remaining / 2))}╮`;
}
function frameBottom(width = 94) {
    return `╰${line("─", width)}╯`;
}
function zshPrintP(text) {
    return `      print -P ${zshQuote(text)}\n`;
}
function zshPrint(text = "") {
    return `      print ${zshQuote(text)}\n`;
}
function truncate(value, width) {
    if (value.length <= width)
        return value;
    if (width <= 3)
        return value.slice(0, width);
    return `${value.slice(0, width - 3)}...`;
}
function stripAnsi(value) {
    return value.replace(/\x1b\[[0-9;]*m/g, "");
}
function padVisible(value, width) {
    const visible = stripAnsi(value);
    if (visible.length >= width)
        return value;
    return `${value}${" ".repeat(width - visible.length)}`;
}
function fitVisible(value, width) {
    const visible = stripAnsi(value);
    if (visible.length <= width)
        return padVisible(value, width);
    return truncate(visible, width);
}
function terminalBox(title, rows, width = 86) {
    const inner = width - 2;
    const top = frameTop(title, inner);
    const bottom = frameBottom(inner);
    const body = rows.map((row) => `│ ${fitVisible(row, inner - 2)} │`);
    return [top, ...body, bottom].join("\n");
}
function displayLabel(script) {
    return script
        .replace(/[:_-]+/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase())
        .slice(0, 28);
}
function groupFor(script) {
    if (/deploy|release|publish|secret|migrate|email/.test(script))
        return "Deploy + Operations";
    if (/(^|:)dev$|start|serve|preview|watch/.test(script))
        return "Launch";
    if (/test|check|lint|format|type|build|validate|ci|fix/.test(script))
        return "Quality";
    return "Scripts";
}
function makeShortcutMap(scripts) {
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
    const shortcuts = [];
    for (const [alias, choices] of candidates) {
        const target = choices.find((choice) => scripts.includes(choice));
        if (target && target !== alias)
            shortcuts.push([alias, target]);
    }
    return shortcuts;
}
function managedMarkers(keyword) {
    return {
        startMarker: `# >>> repo-zsh-helper:${keyword} >>>`,
        endMarker: `# <<< repo-zsh-helper:${keyword} <<<`
    };
}
function generateBlock({ keyword, functionName, packageManager, repoPath, scripts }) {
    const { startMarker, endMarker } = managedMarkers(keyword);
    const banner = asciiBanner(keyword);
    const groups = new Map();
    for (const script of scripts) {
        const group = groupFor(script);
        if (!groups.has(group))
            groups.set(group, []);
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
function removeManagedBlock(existing, { startMarker, endMarker }) {
    const lines = existing.split(/\n/);
    const kept = [];
    let skip = false;
    let found = false;
    for (const line of lines) {
        if (line === startMarker) {
            if (skip)
                throw new Error(`Found nested managed block marker: ${startMarker}`);
            skip = true;
            found = true;
            continue;
        }
        if (line === endMarker) {
            if (!skip)
                throw new Error(`Found closing managed block marker without an opener: ${endMarker}`);
            skip = false;
            continue;
        }
        if (!skip)
            kept.push(line);
    }
    if (skip)
        throw new Error(`Found opening managed block marker without a closer: ${startMarker}`);
    return { content: kept.join("\n").replace(/\n*$/, ""), found };
}
function replaceManagedBlock(existing, generated) {
    const removed = removeManagedBlock(existing, generated);
    const base = removed.content.replace(/\n*$/, "");
    return base ? `${base}\n\n${generated.block}` : generated.block;
}
function parseManagedBlocks(existing) {
    const blocks = [];
    const blockPattern = /^# >>> repo-zsh-helper:([^ ]+) >>>\n([\s\S]*?)^# <<< repo-zsh-helper:\1 <<</gm;
    let match;
    while ((match = blockPattern.exec(existing)) !== null) {
        const keyword = match[1];
        const body = match[2];
        const repoMatch = body.match(/^\s*local repo=(.+)$/m);
        let repo;
        if (repoMatch) {
            try {
                const parsed = JSON.parse(repoMatch[1]);
                if (typeof parsed === "string")
                    repo = parsed;
            }
            catch {
                repo = undefined;
            }
        }
        blocks.push({ keyword, repo });
    }
    return blocks;
}
function sameRepoPath(a, b) {
    if (!a)
        return false;
    try {
        return fs.realpathSync(path.resolve(expandHome(a))) === fs.realpathSync(path.resolve(expandHome(b)));
    }
    catch {
        return path.resolve(expandHome(a)) === path.resolve(expandHome(b));
    }
}
function existingBlocksForRepo(zshrcPath, repoPath) {
    const existing = fs.existsSync(zshrcPath) ? fs.readFileSync(zshrcPath, "utf8") : "";
    return parseManagedBlocks(existing).filter((block) => sameRepoPath(block.repo, repoPath));
}
const SETUP_BANNER = String.raw `
██████╗ ███████╗██████╗  ██████╗       ███████╗███████╗██╗  ██╗
██╔══██╗██╔════╝██╔══██╗██╔═══██╗      ╚══███╔╝██╔════╝██║  ██║
██████╔╝█████╗  ██████╔╝██║   ██║█████╗  ███╔╝ ███████╗███████║
██╔══██╗██╔══╝  ██╔═══╝ ██║   ██║╚════╝ ███╔╝  ╚════██║██╔══██║
██║  ██║███████╗██║     ╚██████╔╝      ███████╗███████║██║  ██║
╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝       ╚══════╝╚══════╝╚═╝  ╚═╝
`.trim();
const TTY_COLORS = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    bg: "\x1b[48;2;0;0;0m",
    fg: "\x1b[38;2;230;238;246m",
    cyan: "\x1b[38;2;34;211;238m",
    green: "\x1b[38;2;90;214;125m",
    orange: "\x1b[38;2;255;184;77m",
    pink: "\x1b[38;2;255;93;163m",
    purple: "\x1b[38;2;180;124;255m",
    red: "\x1b[38;2;255;92;92m",
    slate: "\x1b[38;2;137;148;171m"
};
function ttyEnabled() {
    return Boolean(input.isTTY && output.isTTY);
}
function color(text, value) {
    return `${value}${text}${TTY_COLORS.reset}`;
}
function clearTty() {
    output.write(`${TTY_COLORS.bg}${TTY_COLORS.fg}\x1b[2J\x1b[H`);
}
function ttyWidth() {
    return Math.max(78, Math.min(output.columns || 100, 120));
}
function colorBox(title, rows, accent = TTY_COLORS.cyan, width = ttyWidth() - 2) {
    const inner = width - 2;
    const top = color(frameTop(title, inner), accent);
    const bottom = color(frameBottom(inner), accent);
    const body = rows.map((row) => `${color("│", accent)} ${fitVisible(row, inner - 2)} ${color("│", accent)}`);
    return [top, ...body, bottom].join("\n");
}
function btopPanel(title, rows, accent = TTY_COLORS.cyan, width = ttyWidth() - 2) {
    const inner = width - 2;
    const label = title ? ` ${title} ` : "";
    const top = `${color("╭", accent)}${color(label, accent)}${color(line("─", Math.max(0, inner - stripAnsi(label).length)), accent)}${color("╮", accent)}`;
    const bottom = `${color("╰", accent)}${color(line("─", inner), accent)}${color("╯", accent)}`;
    const body = rows.map((row) => `${color("│", accent)}${fitVisible(` ${row}`, inner)}${color("│", accent)}`);
    return [top, ...body, bottom].join("\n");
}
function hstack(blocks, gap = 2) {
    const split = blocks.map((block) => block.split("\n"));
    const widths = split.map((lines) => Math.max(...lines.map((row) => stripAnsi(row).length)));
    const height = Math.max(...split.map((lines) => lines.length));
    const rows = [];
    for (let i = 0; i < height; i += 1) {
        rows.push(split.map((lines, index) => padVisible(lines[i] || "", widths[index])).join(" ".repeat(gap)));
    }
    return rows.join("\n");
}
function kv(label, value, accent = TTY_COLORS.fg) {
    return `${color(label.padEnd(8), TTY_COLORS.dim)} ${color(value, accent)}`;
}
function scriptCount(repoPath) {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(path.resolve(expandHome(repoPath)), "package.json"), "utf8"));
        return Object.keys(pkg.scripts || {}).length;
    }
    catch {
        return 0;
    }
}
function compactPath(value) {
    const home = os.homedir();
    return value.startsWith(home) ? `~${value.slice(home.length)}` : value;
}
function statusText(state) {
    if (state.existingBlocks.length === 0)
        return "No helper installed yet";
    return `${state.existingBlocks.map((block) => block.keyword).join(", ")} installed`;
}
function renderWizard(state) {
    const repo = state.args.repo || (state.field === "repo" ? state.value || "." : "pending");
    const keyword = state.args.keyword || (state.field === "keyword" ? state.value || "pending" : "pending");
    const repoName = repo === "pending" ? "pending" : repoDisplayName(repo);
    const repoPath = repo === "pending" ? "pending" : compactPath(path.resolve(expandHome(repo)));
    const zshrc = state.args.zshrc || "~/.zshrc";
    const count = repo === "pending" ? 0 : scriptCount(repo);
    const action = state.field === "action"
        ? "choose"
        : state.args.remove
            ? "remove"
            : state.args.action === "update"
                ? "update"
                : "install";
    const promptLabel = state.field === "repo"
        ? "Repo path"
        : state.field === "action"
            ? "Existing helper found"
            : state.field === "keyword"
                ? "Shell keyword"
                : `${state.args.remove ? "Remove from" : state.args.action === "update" ? "Update in" : "Install into"} ~/.zshrc?`;
    const inputPreview = state.field === "confirm"
        ? "Press Enter to apply, or n to cancel"
        : state.field === "action"
            ? `Enter update ${state.existingBlocks[0]?.keyword || "existing"}   r remove   n add new   q quit`
            : `${state.field === "repo" && !state.value ? "." : state.value}${color("█", TTY_COLORS.green)}`;
    const keyRows = state.field === "confirm"
        ? ["Enter apply   n cancel   Ctrl-C quit", "A backup is created before any managed block is changed."]
        : state.field === "action"
            ? ["Enter update   r remove   n new helper   q/Ctrl-C quit", state.message || "Choose the smallest change for this repo."]
            : [
                `Enter accept${state.field === "repo" ? " current directory" : ""}   Tab autocomplete   Backspace edit`,
                "Ctrl-C quit",
                state.message || "The installer writes only a managed block and creates a backup first."
            ];
    const suggestionRows = state.suggestions.length > 0
        ? state.suggestions.map((suggestion, index) => `${index === 0 ? ">" : " "} ${suggestion}`)
        : ["No nearby package repos found. Type a path, or press Enter for current directory."];
    const existingRows = state.existingBlocks.length > 0
        ? state.existingBlocks.map((block, index) => `${index === 0 ? ">" : " "} ${block.keyword}  ${block.repo || "(repo missing)"}`)
        : [];
    const panelWidth = Math.floor((ttyWidth() - 6) / 2);
    const defaultAction = state.field === "action"
        ? `Enter ${color("update", TTY_COLORS.green)}`
        : state.field === "confirm"
            ? `Enter ${color("apply", TTY_COLORS.green)}`
            : `Enter ${color("accept", TTY_COLORS.green)}`;
    clearTty();
    output.write(`${color("¹setup", TTY_COLORS.pink)}${color("│", TTY_COLORS.slate)}${color("repo-zsh-helper", TTY_COLORS.bold)} ${color(`v${VERSION}`, TTY_COLORS.orange)} ${color("step", TTY_COLORS.dim)} ${color(`${state.step}/${state.totalSteps}`, TTY_COLORS.green)} ${color("·", TTY_COLORS.slate)} ${defaultAction} ${color("· Ctrl-C quit", TTY_COLORS.dim)}\n`);
    output.write(hstack([
        btopPanel("workspace", [
            kv("repo", repoName, TTY_COLORS.green),
            kv("path", repoPath, TTY_COLORS.slate),
            kv("scripts", String(count), TTY_COLORS.orange),
            kv("zshrc", zshrc, TTY_COLORS.cyan)
        ], TTY_COLORS.cyan, panelWidth),
        btopPanel(action === "choose" ? "decision" : "next", [
            kv("mode", action, action === "remove" ? TTY_COLORS.red : action === "update" ? TTY_COLORS.orange : TTY_COLORS.green),
            kv("helper", statusText(state), state.existingBlocks.length > 0 ? TTY_COLORS.purple : TTY_COLORS.slate),
            kv("keyword", keyword, TTY_COLORS.green),
            kv("default", stripAnsi(defaultAction), TTY_COLORS.orange)
        ], state.field === "action" ? TTY_COLORS.purple : TTY_COLORS.green, panelWidth)
    ]));
    output.write("\n");
    if (state.field === "repo") {
        output.write(btopPanel("repo suggestions", suggestionRows, TTY_COLORS.purple));
        output.write("\n");
    }
    if (state.field === "action" && existingRows.length > 0) {
        output.write(btopPanel("already set up", existingRows, TTY_COLORS.purple));
        output.write("\n");
    }
    output.write(btopPanel(promptLabel, [inputPreview], state.field === "confirm" ? TTY_COLORS.orange : TTY_COLORS.green));
    output.write("\n");
    output.write(btopPanel("keys", keyRows, TTY_COLORS.slate));
}
async function ttyPromptField(state) {
    input.setRawMode(true);
    input.resume();
    output.write("\x1b[?25l");
    renderWizard(state);
    return new Promise((resolve) => {
        const onData = (buffer) => {
            const values = [...buffer.toString("utf8")];
            for (const value of values) {
                if (value === "\u0003") {
                    cleanup();
                    output.write("\n");
                    resolve(undefined);
                    return;
                }
                if (state.field === "action") {
                    if (/^u$/i.test(value) || value === "\r") {
                        cleanup();
                        resolve("update");
                        return;
                    }
                    if (/^r$/i.test(value)) {
                        cleanup();
                        resolve("remove");
                        return;
                    }
                    if (/^n$/i.test(value)) {
                        cleanup();
                        resolve("new");
                        return;
                    }
                    if (/^q$/i.test(value) || value === "\x1b") {
                        cleanup();
                        resolve(undefined);
                        return;
                    }
                }
                else if (state.field === "confirm") {
                    if (/^y$/i.test(value) || value === "\r") {
                        cleanup();
                        resolve("yes");
                        return;
                    }
                    if (/^n$/i.test(value) || value === "\x1b") {
                        cleanup();
                        resolve("no");
                        return;
                    }
                }
                else if (value === "\r") {
                    cleanup();
                    resolve(state.field === "repo" && !state.value.trim() ? "." : state.value.trim());
                    return;
                }
                else if (value === "\t" && state.field === "repo") {
                    const [matches] = directoryPathCompleter(state.value);
                    if (matches.length > 0) {
                        state.value = matches[0];
                        state.message = `Completed to ${matches[0]}`;
                    }
                    else {
                        state.message = "No path completions found.";
                    }
                }
                else if (value === "\x7f" || value === "\b") {
                    state.value = state.value.slice(0, -1);
                    state.message = "";
                }
                else if (/^[ -~]$/.test(value)) {
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
            output.write("\x1b[?25h\x1b[0m\x1b[2J\x1b[H");
        };
        input.on("data", onData);
    });
}
async function promptIfMissingTty(args) {
    let step = 1;
    let totalSteps = 2;
    let existingBlocks = [];
    const zshrcPath = path.resolve(expandHome(args.zshrc || path.join(os.homedir(), ".zshrc")));
    if (!args.remove && !args.repo && isRepoPath(process.cwd())) {
        args.repo = ".";
    }
    const prompt = async (field, { value = "", suggestions = [], message = "", totalSteps = 3 } = {}) => {
        const result = await ttyPromptField({
            args,
            field,
            step,
            totalSteps,
            value,
            suggestions,
            existingBlocks,
            message
        });
        step += 1;
        return result;
    };
    if (!args.remove && !args.repo) {
        totalSteps = 3;
        const result = await prompt("repo", {
            totalSteps,
            suggestions: repoPathSuggestions(),
            message: "Press Enter for current directory, or Tab for path completion."
        });
        if (result === undefined) {
            args.confirmed = false;
            return args;
        }
        args.repo = result || ".";
    }
    const repoForLookup = args.repo || ".";
    existingBlocks = existingBlocksForRepo(zshrcPath, repoForLookup);
    if (args.remove && !args.keyword && existingBlocks.length === 1) {
        args.keyword = existingBlocks[0].keyword;
    }
    if (!args.remove && !args.keyword && existingBlocks.length > 0) {
        totalSteps = step + 1;
        const result = await prompt("action", {
            totalSteps,
            message: `Found ${existingBlocks.length} helper${existingBlocks.length === 1 ? "" : "s"} for this repo.`
        });
        if (result === undefined) {
            args.confirmed = false;
            return args;
        }
        if (result === "update") {
            args.action = "update";
            args.keyword = existingBlocks[0].keyword;
        }
        else if (result === "remove") {
            args.action = "remove";
            args.remove = true;
            args.keyword = existingBlocks[0].keyword;
        }
        else {
            args.action = "install";
        }
    }
    if (!args.keyword) {
        totalSteps = step + 1;
        const defaultKeyword = suggestedKeyword(args.repo || ".");
        const result = await prompt("keyword", {
            value: defaultKeyword,
            totalSteps,
            message: `Suggested from this repo. Press Enter for "${defaultKeyword}", or edit it.`
        });
        if (result === undefined) {
            args.confirmed = false;
            return args;
        }
        args.keyword = result;
    }
    if (!args.yes && !args.dryRun) {
        const result = await prompt("confirm", { totalSteps });
        args.confirmed = result === "yes";
    }
    return args;
}
async function promptIfMissing(args) {
    if (ttyEnabled())
        return promptIfMissingTty(args);
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
    }
    finally {
        rl.close();
    }
    return args;
}
async function main() {
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
    if (!fs.existsSync(packagePath))
        throw new Error(`No package.json found in ${repoPath}`);
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    const scripts = Object.keys(pkg.scripts || {}).sort();
    if (scripts.length === 0)
        throw new Error(`No package scripts found in ${packagePath}`);
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
    const hadManagedBlock = removeManagedBlock(existing, generated).found;
    const backupPath = uniqueBackupPath(zshrcPath);
    fs.mkdirSync(path.dirname(zshrcPath), { recursive: true });
    fs.writeFileSync(backupPath, existing, { mode: 0o600 });
    fs.writeFileSync(zshrcPath, replaceManagedBlock(existing, generated), { mode: 0o600 });
    process.stdout.write(`\n${terminalBox(args.action === "update" || hadManagedBlock ? "Updated" : "Installed", [
        `function: ${shellFunctionName(args.keyword)}()`,
        `scripts: ${scripts.length}`,
        `runner: ${packageManagerCommand(packageManager)}`,
        `repo: ${repoPath}`,
        `zshrc: ${zshrcPath}`,
        `backup: ${backupPath}`,
        "run: source ~/.zshrc"
    ])}\n`);
}
main().catch((error) => {
    if (!(error instanceof Error))
        throw error;
    process.stderr.write(`Error: ${error.message}\n`);
    process.exit(1);
});
