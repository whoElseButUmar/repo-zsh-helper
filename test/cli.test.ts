import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from "node:child_process";
import { test } from "node:test";

const cliPath = path.resolve("bin/repo-zsh-helper.js");

type PackageJsonPatch = {
  packageManager?: string;
};

type CliOptions = Omit<SpawnSyncOptionsWithStringEncoding, "encoding">;

function makeFixture(packageJson: PackageJsonPatch = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-zsh-helper-"));
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  fs.writeFileSync(
    path.join(repo, "package.json"),
    JSON.stringify({
      scripts: {
        build: "echo build",
        check: "echo check",
        "check:fast": "echo fast",
        dev: "echo dev",
        "release:prod": "echo release"
      },
      ...packageJson
    }, null, 2)
  );

  return { root, repo, zshrc: path.join(root, ".zshrc") };
}

function runCli(
  args: string[],
  options: CliOptions = {}
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    ...options
  });
}

test("dry-run prints a managed zsh block and does not write zshrc", () => {
  const { repo, zshrc } = makeFixture({ packageManager: "pnpm@10.0.0" });

  const result = runCli(["--repo", repo, "--keyword", "hub", "--zshrc", zshrc, "--dry-run"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# >>> repo-zsh-helper:hub >>>/);
  assert.match(result.stdout, /local package_manager="pnpm"/);
  assert.match(result.stdout, /_hub_run_script "check:fast" "\$\{@:2\}"/);
  assert.equal(fs.existsSync(zshrc), false);
});

test("install preserves unrelated zshrc content and replaces only its own block", () => {
  const { repo, root, zshrc } = makeFixture({ packageManager: "npm@11.0.0" });
  fs.writeFileSync(zshrc, "export KEEP_ME=1\n");

  const first = runCli(["--repo", repo, "--keyword", "hub", "--zshrc", zshrc, "--yes"]);
  const second = runCli(["--repo", repo, "--keyword", "hub", "--zshrc", zshrc, "--yes"]);

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);

  const output = fs.readFileSync(zshrc, "utf8");
  assert.match(output, /^export KEEP_ME=1/m);
  assert.equal((output.match(/# >>> repo-zsh-helper:hub >>>/g) || []).length, 1);
  assert.equal((output.match(/# <<< repo-zsh-helper:hub <<</g) || []).length, 1);
  assert.match(output, /local package_manager="npm"/);
  assert.match(output, /npm run "\$@"/);

  const backups = fs.readdirSync(root).filter((name) => name.startsWith(".zshrc.backup-"));
  assert.equal(backups.length, 2);
});

test("generated block is valid zsh syntax", () => {
  const { repo, zshrc } = makeFixture({ packageManager: "bun@1.2.0" });

  const result = runCli(["--repo", repo, "--keyword", "demo-tool", "--zshrc", zshrc, "--yes"]);
  assert.equal(result.status, 0, result.stderr);

  const syntax = spawnSync("zsh", ["-n", zshrc], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test("missing option values fail clearly", () => {
  const result = runCli(["--repo"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--repo requires a value/);
});

test("malformed existing managed block fails without rewriting zshrc", () => {
  const { repo, zshrc } = makeFixture();
  const original = "export KEEP_ME=1\n# >>> repo-zsh-helper:hub >>>\n";
  fs.writeFileSync(zshrc, original);

  const result = runCli(["--repo", repo, "--keyword", "hub", "--zshrc", zshrc, "--yes"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /without a closer/);
  assert.equal(fs.readFileSync(zshrc, "utf8"), original);
});

test("package manager falls back to lockfiles and then npm", () => {
  const pnpm = makeFixture();
  fs.writeFileSync(path.join(pnpm.repo, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  const pnpmResult = runCli(["--repo", pnpm.repo, "--keyword", "pn", "--dry-run"]);
  assert.equal(pnpmResult.status, 0, pnpmResult.stderr);
  assert.match(pnpmResult.stdout, /local package_manager="pnpm"/);

  const npm = makeFixture();
  const npmResult = runCli(["--repo", npm.repo, "--keyword", "np", "--dry-run"]);
  assert.equal(npmResult.status, 0, npmResult.stderr);
  assert.match(npmResult.stdout, /local package_manager="npm"/);
});
