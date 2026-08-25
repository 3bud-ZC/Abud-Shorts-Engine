import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";

import {
  PACKAGE_FORBIDDEN_PATTERNS,
  PACKAGE_INCLUDE,
  findForbiddenEntries,
  isForbiddenPackagePath,
} from "../../scripts/release/package-client.mjs";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const read = (relative: string) => fs.readFileSync(path.join(REPO_ROOT, relative), "utf-8");

/**
 * The script with its comment lines removed.
 *
 * The safety assertions below look for dangerous *invocations*, and these files
 * document the very commands they refuse to run ("there is no `down -v`
 * anywhere here"). Searching the raw text would flag the documentation rather
 * than the code.
 */
const readExecutable = (relative: string) =>
  read(relative)
    .split(/\r?\n/)
    .filter((line) => !/^\s*(#|\/\/)/.test(line))
    .join("\n");

/** Every host-side script that can stop, start or replace the installation. */
const HOST_SCRIPTS = [
  "install.sh",
  "install.ps1",
  "upgrade.sh",
  "upgrade.ps1",
  "scripts/host/abud-lib.sh",
  "scripts/host/abud-update.sh",
  "scripts/host/abud-shorts.sh",
  "scripts/host/abud-shorts.ps1",
];

describe("F4 - client package hygiene", () => {
  it("ships an installer, an updater, compose and client documentation", () => {
    for (const required of [
      "install.sh",
      "install.ps1",
      "docker-compose.prod.yml",
      "scripts/host/abud-shorts.sh",
      "scripts/host/abud-update.sh",
      "scripts/host/abud-shorts.ps1",
      "CLIENT_QUICK_START.md",
      "CLIENT_HANDOFF.md",
      "docs/UPDATING.md",
    ]) {
      expect(PACKAGE_INCLUDE).toContain(required);
    }
  });

  it("ships no source code, build output or dependencies", () => {
    // The application arrives as an immutable image. A customer never
    // compiles anything, so none of this belongs in their package.
    for (const excluded of ["src", "dist", "node_modules", "package.json", "pnpm-lock.yaml"]) {
      expect(PACKAGE_INCLUDE).not.toContain(excluded);
    }
  });

  it("rejects secrets, customer data and developer state by path", () => {
    const mustBeRejected = [
      ".env",
      ".env.local",
      "config/.env",
      ".git/config",
      "node_modules/axios/index.js",
      "src/version.ts",
      "dist/index.js",
      "data/videos/abc.mp4",
      "data-dev/uploads/logo.png",
      "shared/backups/pre-upgrade.sql",
      "logs/app.log",
      "integrations/n8n/n8n-data/database.sqlite",
      "integrations/n8n/my-n8n-credentials.json",
      "scratch_generate_real_outputs.ts",
      "ABUD_SHORTS_ENGINE_STATUS.md",
      "ABUD_SHORTS_ENGINE_STATUS_2026-08-25.md",
      "provider-vault.db",
      "some-api-key.json",
      "output.mp4",
      "whisper-bin-x64.zip",
    ];
    for (const candidate of mustBeRejected) {
      expect(isForbiddenPackagePath(candidate), `${candidate} should be rejected`).toBe(true);
    }
  });

  it("does not reject the files a customer genuinely needs", () => {
    const mustBeAllowed = [
      "install.sh",
      "install.ps1",
      "docker-compose.prod.yml",
      "nginx.conf.reference",
      "release.json",
      "CLIENT_QUICK_START.md",
      "docs/UPDATING.md",
      "scripts/host/abud-update.sh",
      "integrations/n8n/abud-shorts-v2-control-plane-workflow.json",
      "LICENSE",
    ];
    for (const candidate of mustBeAllowed) {
      expect(isForbiddenPackagePath(candidate), `${candidate} should be allowed`).toBe(false);
    }
  });

  it("finds a forbidden file anywhere in a staged package", () => {
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), "abud-package-audit-"));
    try {
      fs.mkdirSync(path.join(staging, "scripts", "host"), { recursive: true });
      fs.writeFileSync(path.join(staging, "install.sh"), "#!/usr/bin/env bash\n");
      expect(findForbiddenEntries(staging)).toEqual([]);

      // A secret smuggled in under a legitimate directory is still caught.
      fs.writeFileSync(path.join(staging, "scripts", ".env"), "SECRET=1\n");
      expect(findForbiddenEntries(staging)).toContain("scripts/.env");
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  });

  it("keeps every exclusion rule case-insensitive", () => {
    // A file named .ENV or Data/ is the same risk as .env or data/.
    for (const pattern of PACKAGE_FORBIDDEN_PATTERNS) {
      expect(pattern.flags).toContain("i");
    }
  });
});

describe("F4 - installation and update never destroy customer data", () => {
  it("never removes a volume in any install, update or restart path", () => {
    for (const script of HOST_SCRIPTS) {
      const source = readExecutable(script);
      // `down -v` detaches and deletes the PostgreSQL and n8n volumes. It must
      // not appear anywhere outside the explicitly destructive uninstaller.
      expect(source, `${script} must not remove volumes`).not.toMatch(/down["'\s,)-]+-v\b/);
      expect(source, `${script} must not remove volumes`).not.toMatch(/"down",\s*"-v"/);
      expect(source, `${script} must not prune`).not.toMatch(/docker\s+(system\s+)?prune/);
      expect(source, `${script} must not remove volumes`).not.toMatch(/docker\s+volume\s+rm/);
    }
  });

  it("stops only the services whose image changes during an update", () => {
    for (const script of ["scripts/host/abud-update.sh", "scripts/host/abud-shorts.ps1"]) {
      const source = read(script);
      // PostgreSQL and n8n keep running through an update, so no data volume is
      // ever detached while the version is switched.
      expect(source).toMatch(/abud-shorts-app.*abud-shorts-render-worker/s);
      expect(source).not.toMatch(/stop\s+abud-shorts-postgres/);
      expect(source).not.toMatch(/stop["'\s,()]+(?:Get-ContainerName\s*)?["']?postgres/);
    }
  });

  it("allows isolated client installs to run beside the primary stack", () => {
    const compose = read("docker-compose.prod.yml");
    expect(compose).toMatch(/container_name:\s*\$\{ABUD_CONTAINER_PREFIX:-abud-shorts\}-app/);
    expect(compose).toMatch(/container_name:\s*\$\{ABUD_CONTAINER_PREFIX:-abud-shorts\}-postgres/);

    const shellInstaller = read("install.sh");
    expect(shellInstaller).toMatch(/ABUD_COMPOSE_PROJECT=.*abud-shorts/);
    expect(shellInstaller).toMatch(/ABUD_CONTAINER_PREFIX=\$ABUD_COMPOSE_PROJECT/);
    expect(shellInstaller).toMatch(/--project-name "\$ABUD_COMPOSE_PROJECT"/);

    const windowsInstaller = read("install.ps1");
    expect(windowsInstaller).toMatch(/\[string\]\$ComposeProject = "abud-shorts"/);
    expect(windowsInstaller).toMatch(/ABUD_CONTAINER_PREFIX=\$ComposeProject/);
  });

  it("keeps customer data outside every release directory", () => {
    // The invariant the whole delivery model rests on: a release directory may
    // be replaced, the shared directory may not.
    const lib = read("scripts/host/abud-lib.sh");
    expect(lib).toMatch(/ABUD_DATA_DIR=.*ABUD_SHARED/);
    expect(lib).toMatch(/ABUD_BACKUP_DIR="\$ABUD_SHARED\/backups"/);

    const compose = read("docker-compose.prod.yml");
    expect(compose).toMatch(/\$\{ABUD_DATA_DIR[^}]*\}:\/app\/data/);
  });

  it("takes a backup before it changes anything, and stops if it cannot", () => {
    const shell = read("scripts/host/abud-update.sh");
    expect(shell).toMatch(/create_pre_upgrade_backup/);
    expect(shell).toMatch(/A safety backup could not be created, so the update was stopped/);

    const powershell = read("scripts/host/abud-shorts.ps1");
    expect(powershell).toMatch(/New-PreUpgradeBackup/);
    expect(powershell).toMatch(/A safety backup could not be created, so the update was stopped/);
  });

  it("verifies the download before it stops the running system", () => {
    const shell = read("scripts/host/abud-update.sh");
    const verifyAt = shell.indexOf("verify_sha256");
    const stopAt = shell.indexOf("compose stop");
    expect(verifyAt).toBeGreaterThan(-1);
    expect(stopAt).toBeGreaterThan(-1);
    // Nothing unverified is ever executed, and nothing is stopped for an
    // update that was going to be rejected anyway.
    expect(verifyAt).toBeLessThan(stopAt);
  });

  it("uninstalls without touching customer data unless explicitly told to", () => {
    const shell = read("uninstall.sh");
    expect(shell).toMatch(/--remove-data/);
    expect(shell).toMatch(/PRESERVED/);
    // The destructive path is opt-in and requires a typed confirmation.
    expect(shell).toMatch(/Type DELETE to confirm/);

    const powershell = read("uninstall.ps1");
    expect(powershell).toMatch(/RemoveData/);
    expect(powershell).toMatch(/Type DELETE to confirm/);
  });
});

describe("F4 - update security posture", () => {
  it("never gives the web application control of the Docker daemon", () => {
    // A Docker socket in the application container is effectively host root.
    // The application reports on updates; the host applies them.
    for (const compose of ["docker-compose.prod.yml", "docker-compose.v2.yml"]) {
      expect(read(compose)).not.toMatch(/docker\.sock/);
    }
    const serverSources = [
      "src/server/v2/routes.ts",
      "src/server/v2/updates/updateService.ts",
      "src/server/server.ts",
    ];
    for (const source of serverSources) {
      const text = read(source);
      expect(text, `${source} must not shell out`).not.toMatch(/child_process/);
      expect(text, `${source} must not run docker`).not.toMatch(/docker\.sock|execSync|spawnSync/);
    }
  });

  it("exposes no generic command-execution endpoint", () => {
    // A whole path segment named exec/shell/command, not a domain action that
    // merely contains the word: /publishing/publications/:id/execute runs a
    // publication, not a shell.
    const routes = read("src/server/v2/routes.ts");
    expect(routes).not.toMatch(
      /router\.(post|get)\(["'][^"']*\/(exec|shell|command|run-command|eval)(["'/]|$)/,
    );
  });

  it("publishes only the application, never the database, automation or worker", () => {
    const compose = read("docker-compose.prod.yml");
    const publishedPorts = compose.match(/^\s+- "\$\{?[^"]*\}?:\d+"/gm) || [];
    // Exactly one published port, and it is the app's.
    expect(publishedPorts).toHaveLength(1);
    expect(publishedPorts[0]).toContain("HOST_PORT");
  });

  it("pins the dependencies a customer runs", () => {
    const compose = read("docker-compose.prod.yml");
    // A floating `latest` means an unrelated PostgreSQL or n8n upgrade can ride
    // along with an application update.
    expect(compose).not.toMatch(/image:\s*postgres:latest/);
    expect(compose).not.toMatch(/image:\s*n8nio\/n8n:latest/);
    expect(compose).toMatch(/image:\s*postgres:\d+\.\d+/);
    expect(compose).toMatch(/image:\s*n8nio\/n8n:\d+\.\d+\.\d+/);
  });

  it("runs the client stack from an immutable image rather than a source build", () => {
    const compose = read("docker-compose.prod.yml");
    expect(compose).not.toMatch(/^\s+build:/m);
    expect(compose).toMatch(/image:\s*\$\{ABUD_IMAGE/);
  });

  it("pulls the application image by digest, not by a movable tag", () => {
    for (const script of ["scripts/host/abud-update.sh", "scripts/host/abud-shorts.ps1"]) {
      const source = read(script);
      expect(source, `${script} must build a digest-pinned image reference`).toMatch(
        /@(?:\$\{REL_DIGEST\}|\$\(\$release\.imageDigest\))/,
      );
      expect(source, `${script} must pull the digest-pinned image`).toMatch(
        /docker pull(?: --quiet)? ["']?\$(?:PINNED_IMAGE|pinnedImage)/,
      );
    }
  });

  it("refuses a manifest whose channel does not match the installation", () => {
    for (const script of ["scripts/host/abud-update.sh", "scripts/host/abud-shorts.ps1"]) {
      expect(read(script)).toMatch(/is not on the \$?\{?channel|is not on the \$channel/i);
    }
  });

  it("prevents two updates running at once", () => {
    expect(read("scripts/host/abud-lib.sh")).toMatch(/Update already in progress/);
    expect(read("scripts/host/abud-shorts.ps1")).toMatch(/Update already in progress/);
  });
});

describe("F4 - client-facing language", () => {
  it("tells the customer a command they can run, not a Docker invocation", () => {
    const quickStart = read("CLIENT_QUICK_START.md");
    expect(quickStart).toMatch(/abud-shorts update/);
    expect(quickStart).not.toMatch(/docker compose/);
  });

  it("keeps Git out of the customer update path", () => {
    const updating = read("docs/UPDATING.md");
    expect(updating).not.toMatch(/git (pull|clone|checkout)/);
    expect(updating).toMatch(/sudo abud-shorts update/);
  });

  it("does not carry a shared or default password anywhere in the installers", () => {
    for (const script of ["install.sh", "install.ps1"]) {
      const source = read(script);
      expect(source).toMatch(/no shared or default password/i);
      // Secrets are generated per machine, never written as literals.
      expect(source).toMatch(/rand|RandomNumberGenerator/);
    }
    const quickStart = read("CLIENT_QUICK_START.md");
    expect(quickStart).toMatch(/no default password/i);
  });
});
