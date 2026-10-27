'use strict';

// Keep dependency installation outside Google Drive on both macOS and Windows.
// Only package manifests are copied; source files and .env stay in the project.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const TASKS = new Set(['start', 'dev', 'test', 'verify:live', 'test:postman']);

function cacheRoot(platform = process.platform, env = process.env, home = os.homedir()) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (env.CINE_NOVA_CACHE_DIR) return paths.resolve(env.CINE_NOVA_CACHE_DIR);
  if (platform === 'win32') return paths.join(env.LOCALAPPDATA || paths.join(home, 'AppData', 'Local'), 'CineNova');
  if (platform === 'darwin') return paths.join(home, 'Library', 'Caches', 'CineNova');
  return paths.join(env.XDG_CACHE_HOME || paths.join(home, '.cache'), 'CineNova');
}

function taskArgs(task, projectRoot, dependencyRoot) {
  switch (task) {
    case 'start': return [path.join(projectRoot, 'examples', 'server.js')];
    case 'dev': return [path.join(dependencyRoot, 'node_modules', 'nodemon', 'bin', 'nodemon.js'), path.join(projectRoot, 'examples', 'server.js')];
    case 'test': return ['--test', ...fs.readdirSync(path.join(projectRoot, 'test')).filter(name => name.endsWith('.test.js')).sort().map(name => path.join(projectRoot, 'test', name))];
    case 'verify:live': return [path.join(projectRoot, 'scripts', 'verify-live.js')];
    case 'test:postman': return [path.join(projectRoot, 'scripts', 'run-postman.js')];
    default: throw new Error(`Unknown task: ${task}. Choose ${[...TASKS].join(', ')}.`);
  }
}

function npmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const found = candidates.find(file => file && /\.(?:c?js)$/.test(file) && fs.existsSync(file));
  if (!found) throw new Error('npm could not be located. Run this helper through npm run start:local or npm run test:local.');
  return found;
}

function runNode(args, options) {
  return new Promise((resolve, reject) => {
    // Invoke npm's JS entry point with Node; no shell or Windows .cmd quoting.
    const child = spawn(process.execPath, args, { ...options, stdio: 'inherit', shell: false });
    const interrupt = () => child.kill('SIGINT');
    const terminate = () => child.kill('SIGTERM');
    const cleanup = () => {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', terminate);
    };
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', (code, signal) => {
      cleanup();
      resolve(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1));
    });
  });
}

async function main(task = process.argv[2] || 'start') {
  if (!TASKS.has(task)) throw new Error(`Unknown task: ${task}. Choose ${[...TASKS].join(', ')}.`);
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or later is required.');
  const projectRoot = path.resolve(__dirname, '..');
  const packageText = fs.readFileSync(path.join(projectRoot, 'package.json'));
  const lockText = fs.readFileSync(path.join(projectRoot, 'package-lock.json'));
  const manifest = JSON.parse(packageText.toString().replace(/^\uFEFF/, ''));
  const fingerprint = crypto.createHash('sha256').update(packageText).update(lockText)
    .update(`${process.platform}/${process.arch}/${process.versions.modules}`).digest('hex').slice(0, 24);
  const base = cacheRoot();
  const dependencyRoot = path.join(base, `tmdb-deps-${fingerprint}`);
  const marker = path.join(dependencyRoot, '.installed');
  let installed = false;
  try {
    const dependencyRequire = createRequire(path.join(dependencyRoot, 'package.json'));
    installed = fs.readFileSync(marker, 'utf8') === fingerprint;
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
      dependencyRequire.resolve(name);
    }
  } catch { installed = false; }

  if (!installed) {
    fs.mkdirSync(base, { recursive: true });
    const installLock = dependencyRoot + '.installing';
    try { fs.mkdirSync(installLock); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error(`Dependency installation is already in progress. Retry when it finishes. If it was interrupted, remove ${installLock} and retry.`);
      throw error;
    }
    try {
      fs.mkdirSync(dependencyRoot, { recursive: true });
      fs.rmSync(marker, { force: true });
      fs.writeFileSync(path.join(dependencyRoot, 'package.json'), packageText);
      fs.writeFileSync(path.join(dependencyRoot, 'package-lock.json'), lockText);
      console.log(`Installing project dependencies in ${dependencyRoot}`);
      const code = await runNode([npmCli(), 'ci', '--include=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', path.join(base, 'npm-cache')], { cwd: dependencyRoot });
      if (code !== 0) return code;
      fs.writeFileSync(marker, fingerprint);
    } finally { fs.rmdirSync(installLock); }
  }

  const env = { ...process.env, NODE_PATH: path.join(dependencyRoot, 'node_modules') };
  return runNode(taskArgs(task, projectRoot, dependencyRoot), { cwd: projectRoot, env });
}

if (require.main === module) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { cacheRoot, taskArgs, main };
