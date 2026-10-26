'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { cacheRoot, taskArgs } = require('../scripts/run-local');

test('dependency folders use native Windows and macOS paths with spaces', () => {
  assert.equal(cacheRoot('win32', { LOCALAPPDATA: 'C:\\Users\\Team Member\\AppData\\Local' }, 'C:\\Users\\Team Member'), 'C:\\Users\\Team Member\\AppData\\Local\\CineNova');
  assert.equal(cacheRoot('win32', {}, 'C:\\Users\\Team Member'), 'C:\\Users\\Team Member\\AppData\\Local\\CineNova');
  assert.equal(cacheRoot('darwin', {}, '/Users/Team Member'), '/Users/Team Member/Library/Caches/CineNova');
  assert.equal(cacheRoot('linux', { XDG_CACHE_HOME: '/tmp/team cache' }, '/home/team'), '/tmp/team cache/CineNova');
});

test('explicit dependency cache locations are respected on both platforms', () => {
  assert.equal(cacheRoot('win32', { CINE_NOVA_CACHE_DIR: 'D:\\Team Cache' }, 'C:\\Users\\team'), 'D:\\Team Cache');
  assert.equal(cacheRoot('darwin', { CINE_NOVA_CACHE_DIR: '/tmp/team cache' }, '/Users/team'), '/tmp/team cache');
});

test('launch arguments preserve project paths and include the full test suite', () => {
  const project = path.resolve(__dirname, '..');
  const deps = path.join(project, 'dependency folder');
  assert.deepEqual(taskArgs('start', project, deps), [path.join(project, 'examples/server.js')]);
  assert.deepEqual(taskArgs('dev', project, deps), [path.join(deps, 'node_modules/nodemon/bin/nodemon.js'), path.join(project, 'examples/server.js')]);
  assert.deepEqual(taskArgs('test', project, deps), ['--test', path.join(project, 'test/run-local.test.js'), path.join(project, 'test/tmdbClient.test.js')]);
  assert.deepEqual(taskArgs('verify:live', project, deps), [path.join(project, 'scripts/verify-live.js')]);
  assert.deepEqual(taskArgs('test:postman', project, deps), [path.join(project, 'scripts/run-postman.js')]);
});

test('unknown tasks fail before installation or startup', () => {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/run-local.js'), 'invalid-task'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown task/);
  assert.equal(result.stdout, '');
});
