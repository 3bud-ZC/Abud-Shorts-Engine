#!/usr/bin/env node
/**
 * Short Studio 2.6 — fail-closed true fresh-install acceptance harness.
 *
 * This is deliberately a QA/operator tool, not part of the customer runtime.
 * It never copies state from an existing installation. It drives the real
 * commercial Setup.exe, then proves the remaining GA gates against the newly
 * installed instance.
 *
 * Required operator inputs are read from files so secrets never appear in the
 * process command line or the generated report:
 *   --license-token-file <path>
 *   --pexels-key-file <path>
 *
 * Example (elevated PowerShell / cmd):
 *   node scripts/qa/fresh-install-acceptance.mjs ^
 *     --installer "C:\\path\\ShortStudio-Setup-2.6.0.exe" ^
 *     --install-root "C:\\ProgramData\\ShortStudioAcceptance" ^
 *     --port 13910 ^
 *     --compose-project short-studio-acceptance ^
 *     --license-token-file "C:\\secure\\acceptance-license.txt" ^
 *     --pexels-key-file "C:\\secure\\pexels-key.txt"
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const DEFAULT_JOB_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_READY_TIMEOUT_MS = 10 * 60 * 1000;
const SECRET_KEYS = [
  'INTERNAL_SERVICE_TOKEN',
  'POSTGRES_PASSWORD',
  'N8N_ENCRYPTION_KEY',
  'SESSION_SECRET',
  'PROVIDER_VAULT_MASTER_KEY',
];

export function parseEnvText(text) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    out[line.slice(0, index).trim()] = line.slice(index + 1);
  }
  return out;
}

function sensitiveKeyName(key) {
  return /(^|_)(token|secret|password|credential|api[_-]?key|license[_-]?key|private[_-]?key)(_|$)/i.test(key)
    || /^(token|apiKey|password|licenseKey|secret)$/i.test(key);
}

export function sanitizePublicEvidence(value) {
  if (Array.isArray(value)) return value.map(sanitizePublicEvidence);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKeyName(key)) continue;
    out[key] = sanitizePublicEvidence(child);
  }
  return out;
}

export function findSemanticProof(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (
    value.semanticRuntime === 'open_clip'
    && Number.isFinite(Number(value.visualSemanticScore))
  ) {
    return {
      runtime: 'open_clip',
      score: Number(value.visualSemanticScore),
      modelId: typeof value.semanticModelId === 'string'
        ? value.semanticModelId
        : typeof value.modelId === 'string'
          ? value.modelId
          : undefined,
    };
  }
  for (const child of Object.values(value)) {
    const found = findSemanticProof(child, seen);
    if (found) return found;
  }
  return null;
}

export function expectedResourceNames(project) {
  return {
    containers: [
      `${project}-app`,
      `${project}-render-worker`,
      `${project}-postgres`,
      `${project}-n8n`,
    ],
    volumes: [`${project}-postgres-data`, `${project}-n8n-data`],
    network: `${project}-v2`,
  };
}

function usage() {
  return `Short Studio true fresh-install acceptance\n\nRequired:\n  --installer <Setup.exe>\n  --install-root <new, nonexistent directory>\n  --license-token-file <file>\n  --pexels-key-file <file>\n\nOptional:\n  --port <port>                       default: 13910\n  --compose-project <name>            default: short-studio-acceptance\n  --primary-install-root <path>       default: C:\\ProgramData\\ShortStudio\n  --job-timeout-ms <ms>               default: ${DEFAULT_JOB_TIMEOUT_MS}\n  --ready-timeout-ms <ms>             default: ${DEFAULT_READY_TIMEOUT_MS}\n  --report <path>                     default: <install-root>\\shared\\logs\\fresh-install-acceptance-<timestamp>.json\n  --resume-after-install              resume the gates against an install root where\n                                      Setup.exe already completed (e.g. the host\n                                      rebooted mid-run). Requires the installer's own\n                                      completion marker in <install-root>\\logs\\installer.log;\n                                      never re-runs Setup.exe.\n  --help\n`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function requireArg(args, key) {
  const value = args[key];
  if (!value || value === true) throw new Error(`Missing required --${key}.`);
  return path.resolve(String(value));
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

// Setup.exe is several gigabytes - readFileSync refuses anything over ~2 GiB,
// so the installer evidence hash must stream. Same pattern as
// scripts/release/package-client.mjs.
export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function samePath(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    windowsHide: false,
    timeout: options.timeoutMs,
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(executable)} exited with code ${result.status}.`);
  }
  return String(result.stdout || '').trim();
}

function runDocker(args) {
  return run('docker', args, { timeoutMs: 60_000 });
}

function listDocker(formatArgs) {
  const text = runDocker(formatArgs);
  return text ? text.split(/\r?\n/).map((v) => v.trim()).filter(Boolean) : [];
}

function portIsListening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const done = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(900);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function requestJson(baseUrl, endpoint, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 60_000);
  try {
    const response = await fetch(new URL(endpoint, baseUrl), {
      method: options.method || 'GET',
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.headers || {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const expected = options.expected || [200];
    if (!expected.includes(response.status)) {
      throw new Error(`${options.method || 'GET'} ${endpoint} returned HTTP ${response.status}.`);
    }
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); }
    catch { return { text }; }
  } finally {
    clearTimeout(timeout);
  }
}

// First-call voice synthesis on a CPU-only host legitimately takes several
// minutes; undici's fetch dispatcher enforces its own headersTimeout (~300s)
// regardless of the AbortSignal, so the long preview call uses node:http
// where the only bound is the one this harness sets.
function requestJsonLong(baseUrl, endpoint, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, baseUrl);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method || 'GET',
        headers: {
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(options.headers || {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (!(options.expected || [200]).includes(res.statusCode)) {
            reject(new Error(`${options.method || 'GET'} ${endpoint} returned HTTP ${res.statusCode}.`));
            return;
          }
          if (!text) { resolve({}); return; }
          try { resolve(JSON.parse(text)); } catch { resolve({ text }); }
        });
        res.on('error', reject);
      },
    );
    req.setTimeout(options.timeoutMs || 60_000, () => req.destroy(new Error(`Request to ${endpoint} timed out.`)));
    req.on('error', reject);
    if (options.body !== undefined) req.write(JSON.stringify(options.body));
    req.end();
  });
}

async function requestBytes(baseUrl, endpoint, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 60_000);
  try {
    const response = await fetch(new URL(endpoint, baseUrl), {
      headers: options.headers || {},
      signal: controller.signal,
    });
    if (!(options.expected || [200, 206]).includes(response.status)) {
      throw new Error(`GET ${endpoint} returned HTTP ${response.status}.`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) throw new Error(`GET ${endpoint} returned an empty body.`);
    return { status: response.status, bytes: bytes.byteLength, contentType: response.headers.get('content-type') || '' };
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForReady(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = 'not reached';
  while (Date.now() < deadline) {
    try {
      const ready = await requestJson(baseUrl, '/health/ready', { expected: [200], timeoutMs: 8_000 });
      if (ready.ready === true || ready.status === 'ready' || ready.ok === true) return ready;
      last = JSON.stringify(sanitizePublicEvidence(ready));
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(3_000);
  }
  throw new Error(`Fresh installation never became ready (${last}).`);
}

function readEnvFile(file) {
  return parseEnvText(fs.readFileSync(file, 'utf8'));
}

function assertIndependentSecrets(fresh, primary) {
  const checked = [];
  for (const key of SECRET_KEYS) {
    if (!fresh[key]) throw new Error(`Fresh installation did not generate ${key}.`);
    if (primary?.[key] && sha256Text(fresh[key]) === sha256Text(primary[key])) {
      throw new Error(`Fresh installation reused ${key} from the primary installation.`);
    }
    checked.push(key);
  }
  return checked;
}

function getContainerHealth(name) {
  const raw = runDocker(['inspect', name, '--format', '{{json .State}}']);
  const state = JSON.parse(raw);
  return {
    running: Boolean(state.Running),
    health: state.Health?.Status || null,
    status: state.Status || null,
  };
}

function assertContainerSet(project) {
  const expected = expectedResourceNames(project);
  const evidence = {};
  for (const name of expected.containers) {
    const state = getContainerHealth(name);
    if (!state.running || (state.health && state.health !== 'healthy')) {
      throw new Error(`Container ${name} is not healthy/running.`);
    }
    evidence[name] = state;
  }
  return evidence;
}

function currentReleaseDir(installRoot) {
  const pointer = path.join(installRoot, 'current.txt');
  if (!fs.existsSync(pointer)) throw new Error('Fresh install did not create current.txt.');
  const value = fs.readFileSync(pointer, 'utf8').trim();
  if (!value || !fs.existsSync(value)) throw new Error('current.txt does not point to a valid installed release.');
  return value;
}

async function configurePexels(baseUrl, pexelsKey) {
  await requestJson(baseUrl, '/api/v2/providers/pexels/credentials', {
    method: 'PUT',
    expected: [200, 201],
    body: { credentialType: 'api_key', value: pexelsKey },
  });
  const validation = await requestJson(baseUrl, '/api/v2/providers/pexels/validate', {
    method: 'POST',
    expected: [200],
  });
  if (validation.healthy !== true && validation.status !== 'healthy') {
    throw new Error('Pexels credential was saved but live validation is not healthy.');
  }
  return { healthy: true, status: validation.status || 'healthy' };
}

async function activateLicense(baseUrl, token) {
  const fingerprint = await requestJson(baseUrl, '/api/v2/licensing/fingerprint', { expected: [200] });
  const activation = await requestJson(baseUrl, '/api/v2/licensing/activate', {
    method: 'POST',
    expected: [200],
    body: { token },
  });
  const status = await requestJson(baseUrl, '/api/v2/licensing/status', { expected: [200] });
  // /licensing/status returns the flat LicenseStatus object
  // ({ activated, status, fingerprintMatch, ... }); tolerate a wrapped
  // { status: <object> } envelope but never treat the status STRING as the
  // status object.
  const resolved = status && typeof status.status === 'object' && status.status !== null ? status.status : status;
  if (activation.success !== true || resolved.activated !== true || resolved.status !== 'active' || resolved.fingerprintMatch !== true) {
    throw new Error('Fresh installation license did not reach active/fingerprint-matched state.');
  }
  return {
    fingerprint: fingerprint.fingerprint || fingerprint.machineFingerprint || fingerprint.currentMachineFingerprint || null,
    activated: true,
    status: 'active',
    fingerprintMatch: true,
  };
}

async function voiceFirstCall(baseUrl, provider, language, dialect, text) {
  const preview = await requestJsonLong(baseUrl, '/api/voice-preview', {
    method: 'POST',
    expected: [201],
    timeoutMs: 600_000,
    body: { text, language, dialect, provider },
  });
  const resolvedProvider = String(preview.provider || preview.resolvedProvider || '').toLowerCase();
  if (resolvedProvider !== provider) {
    throw new Error(`${provider} preview resolved to ${resolvedProvider || 'unknown'} instead of ${provider}.`);
  }
  if (!preview.audioUrl) throw new Error(`${provider} preview returned no audio URL.`);
  const media = await requestBytes(baseUrl, preview.audioUrl, { expected: [200, 206], timeoutMs: 60_000 });
  return { provider: resolvedProvider, audioBytes: media.bytes, contentType: media.contentType };
}

async function createProduction(baseUrl, input, timeoutMs) {
  const create = await requestJson(baseUrl, '/api/v2/jobs', {
    method: 'POST',
    expected: [200, 201, 202],
    body: input,
    timeoutMs: 60_000,
    headers: { 'idempotency-key': `fresh-acceptance-${crypto.randomUUID()}` },
  });
  const id = create.job?.id || create.id || create.jobId;
  if (!id) throw new Error('Production creation returned no job id.');

  const deadline = Date.now() + timeoutMs;
  let job = null;
  while (Date.now() < deadline) {
    const response = await requestJson(baseUrl, `/api/v2/jobs/${encodeURIComponent(id)}`, { expected: [200] });
    job = response.job || response;
    const status = String(job.status || '').toLowerCase();
    if (['ready', 'needs_review', 'failed', 'canceled'].includes(status)) break;
    await sleep(3_000);
  }
  if (!job) throw new Error(`Job ${id} was not readable.`);
  if (!['ready', 'needs_review'].includes(String(job.status || '').toLowerCase())) {
    throw new Error(`Job ${id} did not produce a usable output (status ${job.status || 'unknown'}).`);
  }

  let output = {};
  try {
    output = await requestJson(baseUrl, `/api/v2/production/jobs/${encodeURIComponent(id)}/output`, { expected: [200] });
  } catch { /* older/customer route can still provide the video id */ }
  const videoId = job.output?.videoId || output.videoId || output.output?.videoId || id;
  const video = await requestJson(baseUrl, `/api/videos/${encodeURIComponent(videoId)}`, { expected: [200] });
  const preview = await requestBytes(baseUrl, `/api/short-video/${encodeURIComponent(videoId)}`, {
    expected: [200, 206],
    headers: { Range: 'bytes=0-1023' },
  });
  const download = await requestBytes(baseUrl, `/api/videos/${encodeURIComponent(videoId)}/download`, {
    expected: [200, 206],
    headers: { Range: 'bytes=0-1023' },
  });
  return {
    id,
    videoId,
    status: job.status,
    job,
    output,
    video,
    preview: { status: preview.status, bytes: preview.bytes, contentType: preview.contentType },
    download: { status: download.status, bytes: download.bytes, contentType: download.contentType },
  };
}

function assertFreshDockerNamespace(project) {
  const expected = expectedResourceNames(project);
  const containers = new Set(listDocker(['ps', '-a', '--format', '{{.Names}}']));
  const volumes = new Set(listDocker(['volume', 'ls', '--format', '{{.Name}}']));
  const networks = new Set(listDocker(['network', 'ls', '--format', '{{.Name}}']));
  const collisions = [
    ...expected.containers.filter((name) => containers.has(name)),
    ...expected.volumes.filter((name) => volumes.has(name)),
    ...(networks.has(expected.network) ? [expected.network] : []),
  ];
  if (collisions.length) {
    throw new Error(`Acceptance Docker namespace is not fresh (${collisions.join(', ')} already exists).`);
  }
  return expected;
}

export function missingNamespaceResources(expected, present) {
  const containers = new Set(present.containers || []);
  const volumes = new Set(present.volumes || []);
  const networks = new Set(present.networks || []);
  return [
    ...expected.containers.filter((name) => !containers.has(name)),
    ...expected.volumes.filter((name) => !volumes.has(name)),
    ...(networks.has(expected.network) ? [] : [expected.network]),
  ];
}

// Resume-mode inverse of assertFreshDockerNamespace: the interrupted run must
// pick up exactly the namespace this install created - every expected
// container, volume and network present under the acceptance project name.
export function assertInstalledDockerNamespace(project) {
  const expected = expectedResourceNames(project);
  const missing = missingNamespaceResources(expected, {
    containers: listDocker(['ps', '-a', '--format', '{{.Names}}']),
    volumes: listDocker(['volume', 'ls', '--format', '{{.Name}}']),
    networks: listDocker(['network', 'ls', '--format', '{{.Name}}']),
  });
  if (missing.length) {
    throw new Error(`Acceptance Docker namespace is incomplete; cannot resume (${missing.join(', ')} missing).`);
  }
  return expected;
}

// A resume is only honest if the real Setup.exe actually finished - the
// installer engine writes this line as its very last step.
function assertInstallerCompleted(installRoot) {
  const log = path.join(installRoot, 'logs', 'installer.log');
  if (!fs.existsSync(log)) {
    throw new Error('Cannot resume: installer.log is missing, so Setup.exe completion is unproven.');
  }
  const text = fs.readFileSync(log, 'utf8');
  if (!/INSTALLATION COMPLETE/i.test(text)) {
    throw new Error('Cannot resume: installer.log has no INSTALLATION COMPLETE marker; Setup.exe did not finish.');
  }
  return true;
}

function verifyLocalVoiceIsolation(freshEnv, primaryEnv, installRoot, primaryRoot) {
  const freshPort = Number(freshEnv.LOCAL_TTS_PORT || 0);
  if (!Number.isInteger(freshPort) || freshPort <= 0) {
    throw new Error('Fresh install did not persist a valid LOCAL_TTS_PORT.');
  }
  if (primaryEnv && !samePath(installRoot, primaryRoot)) {
    const primaryPort = Number(primaryEnv.LOCAL_TTS_PORT || 0);
    if (primaryPort > 0 && primaryPort === freshPort) {
      throw new Error(
        `Fresh Local Voice reused the primary installation port ${freshPort}; this is not an isolated fresh install.`,
      );
    }
  }
  return { port: freshPort, isolatedFromPrimaryPort: true };
}

function installerArgs({ installRoot, port, project }) {
  return [
    '/VERYSILENT',
    '/SUPPRESSMSGBOXES',
    '/NORESTART',
    `/PORT=${port}`,
    `/COMPOSEPROJECT=${project}`,
    `/INSTALLROOT=${installRoot}`,
    '/LOCALVOICE=AUTO',
  ];
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  if (process.platform !== 'win32') {
    throw new Error('This acceptance harness must run on the target Windows host because it drives Setup.exe and the host-native Local Voice service.');
  }

  const installer = requireArg(args, 'installer');
  const installRoot = requireArg(args, 'install-root');
  const licenseTokenFile = requireArg(args, 'license-token-file');
  const pexelsKeyFile = requireArg(args, 'pexels-key-file');
  const primaryRoot = path.resolve(String(args['primary-install-root'] || 'C:\\ProgramData\\ShortStudio'));
  const resume = Boolean(args['resume-after-install']);
  const port = Number(args.port || 13910);
  const project = String(args['compose-project'] || 'short-studio-acceptance').trim();
  const jobTimeoutMs = Number(args['job-timeout-ms'] || DEFAULT_JOB_TIMEOUT_MS);
  const readyTimeoutMs = Number(args['ready-timeout-ms'] || DEFAULT_READY_TIMEOUT_MS);

  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('--port must be an integer from 1024 to 65535.');
  if (!/^[a-z0-9][a-z0-9_-]{2,50}$/i.test(project)) throw new Error('--compose-project contains unsupported characters.');
  if (!fs.existsSync(installer) || path.extname(installer).toLowerCase() !== '.exe') throw new Error('The supplied --installer does not exist or is not an EXE.');
  if (!fs.existsSync(licenseTokenFile) || !fs.existsSync(pexelsKeyFile)) throw new Error('The license token file and Pexels key file must both exist.');
  if (resume) {
    if (!fs.existsSync(installRoot)) {
      throw new Error('--resume-after-install requires an existing install root from a completed Setup.exe run.');
    }
    assertInstallerCompleted(installRoot);
  } else {
    if (fs.existsSync(installRoot)) throw new Error('The acceptance install root already exists. Choose a brand-new directory; this harness never deletes it for you.');
    if (await portIsListening(port)) throw new Error(`Port ${port} is already in use.`);
  }
  if (samePath(installRoot, primaryRoot)) throw new Error('The acceptance install root must not be the primary installation root.');

  runDocker(['info']);
  if (resume) assertInstalledDockerNamespace(project);
  else assertFreshDockerNamespace(project);

  // Requiring elevation up front avoids a silent/hidden UAC failure halfway
  // through a multi-gigabyte Setup.exe run.
  try { run('net.exe', ['session'], { timeoutMs: 10_000 }); }
  catch { throw new Error('Run this harness from an elevated Administrator terminal.'); }

  const report = {
    product: 'Short Studio Server',
    targetVersion: '2.6.0',
    startedAt: new Date().toISOString(),
    host: { platform: os.platform(), release: os.release(), arch: os.arch() },
    install: { root: installRoot, port, composeProject: project, resumedAfterInstall: resume },
    gates: {},
    overall: 'RUNNING',
  };
  const gate = (name, data = {}) => {
    report.gates[name] = { status: 'PASS', at: new Date().toISOString(), ...sanitizePublicEvidence(data) };
    process.stdout.write(`[PASS] ${name}\n`);
  };

  let reportPath = args.report ? path.resolve(String(args.report)) : null;
  try {
    const primaryEnvFile = path.join(primaryRoot, 'shared', 'config', '.env');
    const primaryEnv = fs.existsSync(primaryEnvFile) ? readEnvFile(primaryEnvFile) : null;
    gate('preflight_isolation', {
      installerSha256: await sha256File(installer),
      primaryInstallDetected: Boolean(primaryEnv),
      resumedAfterInstall: resume,
      dockerNamespace: resume ? 'installed' : 'fresh',
      ...(resume ? { installerCompletedMarker: true } : { targetPortFree: true }),
    });

    if (resume) {
      process.stdout.write('[RUN ] resume after completed Setup.exe install\n');
    } else {
      process.stdout.write('[RUN ] real Setup.exe fresh install\n');
      run(installer, installerArgs({ installRoot, port, project }), { inherit: true, timeoutMs: 45 * 60 * 1000 });
    }

    const envFile = path.join(installRoot, 'shared', 'config', '.env');
    if (!fs.existsSync(envFile)) throw new Error('Setup.exe finished but the fresh installation .env file is missing.');
    const freshEnv = readEnvFile(envFile);
    const secretKeysChecked = assertIndependentSecrets(freshEnv, primaryEnv);
    const voiceIsolation = verifyLocalVoiceIsolation(freshEnv, primaryEnv, installRoot, primaryRoot);
    currentReleaseDir(installRoot);
    gate('installer_and_installation_isolation', {
      independentSecretKeysChecked: secretKeysChecked,
      localVoice: voiceIsolation,
      currentReleasePointer: true,
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    const ready = await waitForReady(baseUrl, readyTimeoutMs);
    const containers = assertContainerSet(project);
    gate('docker_runtime', { ready: Boolean(ready.ready ?? true), containers });

    const licenseToken = fs.readFileSync(licenseTokenFile, 'utf8').trim();
    if (!licenseToken) throw new Error('The license token file is empty.');
    const license = await activateLicense(baseUrl, licenseToken);
    gate('license_activation', license);

    const pexelsKey = fs.readFileSync(pexelsKeyFile, 'utf8').trim();
    if (!pexelsKey) throw new Error('The Pexels key file is empty.');
    const pexels = await configurePexels(baseUrl, pexelsKey);
    gate('pexels_live_configuration', pexels);

    const kokoro = await voiceFirstCall(
      baseUrl,
      'kokoro',
      'en',
      'none',
      'Short Studio fresh install voice verification.',
    );
    gate('kokoro_first_call', kokoro);

    const voicetut = await voiceFirstCall(
      baseUrl,
      'voicetut',
      'ar',
      'egyptian',
      'ده اختبار حقيقي للصوت العربي بعد تثبيت جديد بالكامل.',
    );
    gate('voicetut_first_call', voicetut);

    const english = await createProduction(baseUrl, {
      creationMode: 'prompt',
      prompt: 'Create a 15 second vertical explainer about why coffee aroma feels stronger right after grinding. Keep it factual and concise.',
      language: 'en',
      dialect: 'none',
      durationSeconds: 15,
      aspectRatio: '9:16',
      resolution: '1080p',
      quality: 'standard',
      productionMode: 'auto_hybrid',
      visualMode: 'stock',
      visualSource: 'stock',
      budgetMode: 'free_only',
      stockProvider: 'pexels',
      voiceProvider: 'kokoro',
      captionEnabled: true,
      captionStyle: 'viral_bold',
    }, jobTimeoutMs);
    gate('english_real_production', {
      jobId: english.id,
      videoId: english.videoId,
      status: english.status,
      preview: english.preview,
      download: english.download,
    });

    const arabic = await createProduction(baseUrl, {
      creationMode: 'prompt',
      prompt: 'اعمل فيديو 15 ثانية باللهجة المصرية يشرح ليه النسخ الاحتياطي مهم للمشاريع الصغيرة، من غير اختراع أرقام أو عروض.',
      language: 'ar',
      dialect: 'egyptian',
      durationSeconds: 15,
      aspectRatio: '9:16',
      resolution: '1080p',
      quality: 'standard',
      productionMode: 'auto_hybrid',
      visualMode: 'stock',
      visualSource: 'stock',
      budgetMode: 'free_only',
      stockProvider: 'pexels',
      voiceProvider: 'voicetut',
      captionEnabled: true,
      captionStyle: 'viral_bold',
    }, jobTimeoutMs);
    gate('arabic_real_production', {
      jobId: arabic.id,
      videoId: arabic.videoId,
      status: arabic.status,
      preview: arabic.preview,
      download: arabic.download,
    });

    const semantic = [english, arabic]
      .map((production) => findSemanticProof({ job: production.job, output: production.output, video: production.video }))
      .find(Boolean);
    if (!semantic) {
      throw new Error('Neither real production exposed proof of semanticRuntime=open_clip with a numeric visualSemanticScore. Lexical/perceptual fallback does not satisfy this gate.');
    }
    gate('openclip_semantic_mode', semantic);

    const releaseDir = currentReleaseDir(installRoot);
    const operatorScript = path.join(releaseDir, 'scripts', 'host', 'short-studio.ps1');
    if (!fs.existsSync(operatorScript)) throw new Error('Installed short-studio.ps1 operator command is missing.');
    process.stdout.write('[RUN ] canonical Short Studio restart\n');
    run('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', operatorScript, 'restart',
    ], {
      inherit: true,
      timeoutMs: 10 * 60 * 1000,
      env: {
        ...process.env,
        ABUD_HOME: installRoot,
        SHORT_STUDIO_COMPOSE_PROJECT: project,
      },
    });
    await waitForReady(baseUrl, readyTimeoutMs);
    const restartedContainers = assertContainerSet(project);
    await requestBytes(baseUrl, `/api/short-video/${encodeURIComponent(english.videoId)}`, {
      expected: [200, 206], headers: { Range: 'bytes=0-1023' },
    });
    await requestBytes(baseUrl, `/api/short-video/${encodeURIComponent(arabic.videoId)}`, {
      expected: [200, 206], headers: { Range: 'bytes=0-1023' },
    });
    const postRestartVoice = await voiceFirstCall(
      baseUrl,
      'voicetut',
      'ar',
      'egyptian',
      'اختبار الصوت بعد إعادة تشغيل النظام.',
    );
    const postRestartLicense = await requestJson(baseUrl, '/api/v2/licensing/status', { expected: [200] });
    const status = postRestartLicense && typeof postRestartLicense.status === 'object' && postRestartLicense.status !== null
      ? postRestartLicense.status
      : postRestartLicense;
    if (status.activated !== true || status.status !== 'active') {
      throw new Error('License activation did not survive the canonical restart.');
    }
    gate('restart_survival', {
      containers: restartedContainers,
      priorEnglishVideoReadable: true,
      priorArabicVideoReadable: true,
      voicetutAfterRestart: postRestartVoice,
      licenseStillActive: true,
    });

    report.overall = 'PASS';
    report.finishedAt = new Date().toISOString();
    reportPath ||= path.join(installRoot, 'shared', 'logs', `fresh-install-acceptance-${report.finishedAt.replace(/[:.]/g, '-')}.json`);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(sanitizePublicEvidence(report), null, 2)}\n`, 'utf8');
    process.stdout.write(`\nTRUE FRESH INSTALL ACCEPTANCE: PASS\nReport: ${reportPath}\n`);
  } catch (error) {
    report.overall = 'FAIL';
    report.finishedAt = new Date().toISOString();
    report.failure = { message: error instanceof Error ? error.message : String(error) };
    reportPath ||= fs.existsSync(installRoot)
      ? path.join(installRoot, 'shared', 'logs', `fresh-install-acceptance-${report.finishedAt.replace(/[:.]/g, '-')}.json`)
      : path.resolve(`fresh-install-acceptance-${report.finishedAt.replace(/[:.]/g, '-')}.json`);
    try {
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, `${JSON.stringify(sanitizePublicEvidence(report), null, 2)}\n`, 'utf8');
    } catch { /* original failure is more important */ }
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_FILE)) {
  main().catch((error) => {
    process.stderr.write(`\nFresh-install acceptance FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
