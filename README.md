# repo-zsh-helper

Generate a safe `zsh` command center from any repo's `package.json` scripts.

```sh
npx repo-zsh-helper
```

The interactive installer and generated command both render as compact terminal dashboards: keyword banner, setup plan, repo suggestions, grouped script panes, shortcut pane, and controls footer. When you run it in a repo that already has a managed helper, it offers update, remove, or add-new paths before changing anything.

It asks for:

- the repo path, defaulting to `.`
- the keyword you want, like `app`, `waker`, or `arch`

Then it installs a function into `~/.zshrc`, so your package scripts become easy to discover and run:

```sh
waker
waker check
waker lint
waker build
waker dev
waker some:custom:script
```

It detects the package manager from `packageManager` in `package.json`, then lockfiles, and falls back to `npm`.

The generated help screen renders ASCII art from your keyword, so `app`, `waker`, or any other valid keyword gets its own banner and command dashboard.

## Why

I had this idea because I kept wanting a nice local command index for repos with a lot of package scripts. I asked AI to build the first version with me. This package was fully created with AI assistance from that idea.

If something is wrong, too magical, unsafe, ugly, or just not how you would do it, please open an issue or PR. Small fixes are welcome.

## Install And Run

Interactive:

```sh
npx repo-zsh-helper
source ~/.zshrc
```

The repo-path prompt shows nearby package repos when it can. Press `Tab` while typing that path to autocomplete directories.

With flags:

```sh
npx repo-zsh-helper --repo ~/my-app --keyword app
source ~/.zshrc
```

Dry run:

```sh
npx repo-zsh-helper --repo . --keyword app --dry-run
```

Update an existing helper:

```sh
npx repo-zsh-helper --repo . --keyword app --yes
source ~/.zshrc
```

Remove an installed helper:

```sh
npx repo-zsh-helper --keyword app --remove --yes
unfunction app 2>/dev/null; source ~/.zshrc
```

## What It Changes

`repo-zsh-helper` only writes to your `~/.zshrc` by default.

Before writing, it creates a backup like:

```text
~/.zshrc.backup-20260511-093000
```

It writes a managed block with markers:

```zsh
# >>> repo-zsh-helper:app >>>
app() {
  ...
}
# <<< repo-zsh-helper:app <<<
```

If you run it again with the same keyword, it replaces only that managed block. It does not overwrite your whole `.zshrc`.

If you remove it with `--remove`, it deletes only the managed block for that keyword. It still creates a backup first.

If the command still works in the same terminal after removal, that shell has the old function loaded in memory. Run `unfunction <keyword> 2>/dev/null; source ~/.zshrc` or open a new terminal.

## Safety Notes

The CLI is intentionally boring:

- no shell `eval`
- no network calls from the package code
- no dependency install step beyond `npx` fetching the package
- no writes outside the target `.zshrc` and its timestamped backup
- no destructive cleanup
- no editing unmarked parts of `.zshrc`
- repo commands are not executed during install

The generated function runs commands only when you call it later. For example:

```sh
app check
```

runs:

```sh
npm run check
```

inside the repo you selected.

## Options

```text
--repo <path>       Repo path. Defaults to ".".
--keyword <name>    Shell command name to install.
--zshrc <path>      Target zshrc path. Defaults to ~/.zshrc.
--yes              Skip confirmation prompt.
--dry-run          Print generated block without writing.
--remove           Remove this helper's managed block for the keyword.
--help             Show help.
--version          Show version.
```

## Requirements

- macOS or another system using `zsh`
- Node.js 18+
- a repo with a `package.json`
- the repo's package manager available when you use the generated commands

macOS uses `zsh` as the default login shell on modern versions, so this fits the normal Mac setup.

## Package Manager Detection

Detection order:

1. `packageManager` in `package.json`
2. `pnpm-lock.yaml`
3. `yarn.lock`
4. `bun.lock` or `bun.lockb`
5. `package-lock.json`
6. fallback to `npm`

Generated commands use the matching script runner:

```text
npm run <script>
pnpm <script>
yarn <script>
bun run <script>
```

## Release Checklist

Before publishing:

```sh
npm run build
npm run check
npm test
npm pack --dry-run
```

## License

MIT
