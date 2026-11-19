import { randomBytes, scryptSync } from 'node:crypto';
import { writeSync } from 'node:fs';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

async function readPin() {
  if (!process.stdin.isTTY) {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk.toString();
      if (input.length > 16) throw new Error('Enter one eight-digit PIN.');
    }
    return input.replace(/\r?\n$/, '');
  }
  const silent = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const prompt = createInterface({
    input: process.stdin,
    output: silent,
    terminal: true,
    historySize: 0,
  });
  const controller = new AbortController();
  prompt.once('SIGINT', () => controller.abort());
  const ask = async (label) => {
    process.stderr.write(label);
    const value = await prompt.question('', { signal: controller.signal });
    process.stderr.write('\n');
    return value;
  };
  try {
    const pin = await ask('New eight-digit workspace PIN (hidden): ');
    if (pin !== (await ask('Confirm PIN (hidden): '))) throw new Error('PIN entries differ.');
    return pin;
  } finally {
    prompt.close();
    process.stdin.pause();
    process.stdin.unref?.();
  }
}

async function main() {
  const pin = await readPin();
  if (!/^[0-9]{8}$/.test(pin)) throw new Error('The PIN must contain exactly eight digits.');
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 64).toString('hex');
  const setting = 'WORKSPACE_PIN_HASH=scrypt:' + salt.toString('hex') + ':' + hash;
  const target = join(process.cwd(), '.env.local');
  let previous;
  try {
    previous = await readFile(target, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    previous = '';
  }
  const newline = previous.includes('\r\n') ? '\r\n' : '\n';
  const otherSettings = previous
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:export\s+)?WORKSPACE_PIN_HASH\s*=/.test(line));
  if (otherSettings.at(-1) === '') otherSettings.pop();
  const scratch = target + '.' + randomBytes(8).toString('hex') + '.tmp';
  try {
    await writeFile(scratch, [...otherSettings, setting, ''].join(newline), {
      flag: 'wx',
      mode: 0o600,
    });
    await rename(scratch, target);
  } finally {
    await unlink(scratch).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

main().then(
  () => {
    writeSync(1, 'Workspace PIN configured. Restart the app to apply it.\n');
    process.exit(0);
  },
  (error) => {
    writeSync(2, error.message + '\n');
    process.exit(1);
  },
);
