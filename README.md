# repo-zsh-helper

Generate a safe `zsh` command center from any repo's `package.json` scripts.

```sh
npx repo-zsh-helper
```

It asks for:

- the repo path, defaulting to `.`
- the keyword you want, like `hub`, `waker`, or `arch`

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

## Why

I had this idea because I kept wanting a nice local command index for repos with a lot of package scripts. I asked AI to build the first version with me. This package was fully created with AI assistance from that idea.

If something is wrong, too magical, unsafe, ugly, or just not how you would do it, please open an issue or PR. Small fixes are welcome.

## Install And Run

Interactive:

```sh
npx repo-zsh-helper
source ~/.zshrc
```

With flags:

```sh
npx repo-zsh-helper --repo ~/workspaces-hub --keyword hub
source ~/.zshrc
```

Dry run:

```sh
npx repo-zsh-helper --repo . --keyword app --dry-run
```

## What It Changes

`repo-zsh-helper` only writes to your `~/.zshrc` by default.

Before writing, it creates a backup like:

```text
~/.zshrc.backup-20260511-093000
```

It writes a managed block with markers:

```zsh
# >>> repo-zsh-helper:hub >>>
hub() {
  ...
}
# <<< repo-zsh-helper:hub <<<
```

If you run it again with the same keyword, it replaces only that managed block. It does not overwrite your whole `.zshrc`.

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
hub check
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
