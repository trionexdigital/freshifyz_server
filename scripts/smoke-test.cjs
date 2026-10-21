'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

async function availablePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

function waitForStartup(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Startup deadline exceeded')); }, 15000);
    const cleanup = () => { clearTimeout(timeout); child.stdout.off('data', data); child.off('exit', exit); child.off('error', error); };
    const data = chunk => {
      output += chunk.toString();
      if (output.includes('"event":"server_started"')) { cleanup(); resolve(); }
    };
    const exit = () => { cleanup(); reject(new Error('Application exited before startup')); };
    const error = () => { cleanup(); reject(new Error('Application could not start')); };
    child.stdout.on('data', data);
    child.once('exit', exit);
    child.once('error', error);
  });
}

async function main() {
  const port = await availablePort();
  const child = spawn(process.execPath, ['dist/start.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NODE_EXPRESS_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  // Keep raw subprocess output private even on failure.
  child.stderr.resume();
  try {
    await waitForStartup(child);
    const base = `http://127.0.0.1:${port}`;
    for (const endpoint of ['/api/health', '/api/health/ready']) {
      const response = await fetch(base + endpoint, { signal: AbortSignal.timeout(12000) });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.ok(response.headers.get('x-request-id'));
      const body = await response.json();
      assert.equal(body.success, true);
      assert.equal(body.data.service, 'freshifyz');
    }
    for (const endpoint of ['/auth/login', '/api/users', '/v1/dashboard']) {
      const response = await fetch(base + endpoint, { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 404);
    }
    console.log(JSON.stringify({ success: true, actualStartupVerified: true, liveHealthVerified: true, removedApisUnavailable: true }));
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      const deadline = setTimeout(() => child.kill('SIGKILL'), 12000);
      deadline.unref();
      await exited;
      clearTimeout(deadline);
    }
  }
}

void main().catch(() => { console.error('Freshifyz live smoke test failed; check configuration and the SSH tunnel.'); process.exitCode = 1; });
