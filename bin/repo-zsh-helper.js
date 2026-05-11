#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
const VERSION = "0.1.1";
const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"];
function usage() {
    return `repo-zsh-helper ${VERSION}

Generate a zsh command center from a repo's package.json scripts.

Usage:
  repo-zsh-helper
  repo-zsh-helper --repo . --keyword app

Options:
  --repo <path>       Repo path. Defaults to ".".
  --keyword <name>    Shell command name to install.
  --zshrc <path>      Target zshrc path. Defaults to ~/.zshrc.
  --yes              Skip confirmation prompt.
  --dry-run          Print generated block without writing.
  --help             Show this help.
  --version          Show version.
`;
}
function parseArgs(argv) {
    const args = {
        repo: undefined,
        keyword: undefined,
        zshrc: undefined,
        yes: false,
        dryRun: false,
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
function asciiBanner(keyword) {
    return [
        "    ____  _____ ____   ___     ______ ____  _   _",
        "   |  _ \\| ____|  _ \\ / _ \\   |__  / / ___|| | | |",
        "   | |_) |  _| | |_) | | | |    / /  \\___ \\| |_| |",
        "   |  _ <| |___|  __/| |_| |   / /_   ___) |  _  |",
        "   |_| \\_\\_____|_|    \\___/   /____| |____/|_| |_|",
        `                ${keyword.toUpperCase()} COMMAND CENTER`
    ].join("\n");
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
function generateBlock({ keyword, functionName, packageManager, repoPath, scripts }) {
    const startMarker = `# >>> repo-zsh-helper:${keyword} >>>`;
    const endMarker = `# <<< repo-zsh-helper:${keyword} <<<`;
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
    out += `      print -P "%F{cyan}"\n`;
    out += `      cat <<'EOF'\n`;
    out += `${banner}\n`;
    out += `EOF\n`;
    out += `      print -P "%f%F{244}repo:%f $repo"\n`;
    out += `      print -P "%F{244}runner:%f ${command}"\n`;
    out += `      print\n`;
    for (const group of orderedGroups) {
        out += `      print -P "%F{cyan}${group}%f"\n`;
        for (const script of groups.get(group)) {
            out += `      printf "  %-28s %-30s ${command} %s\\n" ${zshQuote(`${keyword} ${script}`)} ${zshQuote(displayLabel(script))} ${zshQuote(script)}\n`;
        }
        out += `      print\n`;
    }
    if (shortcuts.length > 0) {
        out += `      print -P "%F{cyan}Shortcuts%f"\n`;
        for (const [alias, target] of shortcuts) {
            out += `      printf "  %-28s %-30s ${command} %s\\n" ${zshQuote(`${keyword} ${alias}`)} ${zshQuote(`Alias for ${target}`)} ${zshQuote(target)}\n`;
        }
        out += `      print\n`;
    }
    out += `      print -P "%F{244}Tip:%f pass extra args after any command, e.g. ${keyword} check --force"\n`;
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
function replaceManagedBlock(existing, { block, startMarker, endMarker }) {
    const lines = existing.split(/\n/);
    const kept = [];
    let skip = false;
    for (const line of lines) {
        if (line === startMarker) {
            if (skip)
                throw new Error(`Found nested managed block marker: ${startMarker}`);
            skip = true;
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
    const base = kept.join("\n").replace(/\n*$/, "");
    return `${base}\n\n${block}`;
}
async function promptIfMissing(args) {
    const rl = readline.createInterface({ input, output, completer: directoryPathCompleter });
    try {
        if (!args.repo) {
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
            const answer = await rl.question("Install into ~/.zshrc? [y/N]: ");
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
    const zshrcPath = path.resolve(expandHome(args.zshrc || path.join(os.homedir(), ".zshrc")));
    const existing = fs.existsSync(zshrcPath) ? fs.readFileSync(zshrcPath, "utf8") : "";
    const backupPath = uniqueBackupPath(zshrcPath);
    fs.mkdirSync(path.dirname(zshrcPath), { recursive: true });
    fs.writeFileSync(backupPath, existing, { mode: 0o600 });
    fs.writeFileSync(zshrcPath, replaceManagedBlock(existing, generated), { mode: 0o600 });
    process.stdout.write(`\nInstalled ${shellFunctionName(args.keyword)}() into ${zshrcPath}\n`);
    process.stdout.write(`Repo: ${repoPath}\n`);
    process.stdout.write(`Runner: ${packageManagerCommand(packageManager)}\n`);
    process.stdout.write(`Backup: ${backupPath}\n`);
    process.stdout.write("Run: source ~/.zshrc\n");
}
main().catch((error) => {
    if (!(error instanceof Error))
        throw error;
    process.stderr.write(`Error: ${error.message}\n`);
    process.exit(1);
});
