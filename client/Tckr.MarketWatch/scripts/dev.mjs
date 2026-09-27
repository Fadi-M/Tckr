#!/usr/bin/env node
/**
 * `npm run dev`: Vite's dev server, plus one option of our own.
 *
 *   npm run dev                          real time (the default)
 *   npm run dev:open                     EGX mid-session: 12:00 Cairo, market open
 *   npm run dev:bell                     09:59:45 Cairo: watch the opening bell
 *   npm run dev -- --market 14:29:30     any Cairo time, e.g. just before the close
 *
 * (`dev:open` / `dev:bell` are this script with `--market open` / `--market bell`
 * baked in; only a custom time needs npm's `--` to pass the flag through.)
 *
 * `--market` sets `VITE_TCKR_SIM_CLOCK` (see `src/data/simulatedClock.ts`): the app's
 * clock starts at that Cairo time on the latest EGX trading day and runs forward in real
 * time. Simulated source only. Every other argument goes to Vite unchanged
 * (`npm run dev:open -- --port 5199`).
 */
import { spawn } from 'node:child_process';

const VALUE = /^(open|bell|([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?)$/i;
const HELP = "'open' (12:00 Cairo), 'bell' (09:59:45 Cairo) or a Cairo time 'HH:MM[:SS]'";

const viteArgs = [];
let market;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--market') {
    market = args[++i];
    if (market === undefined) {
      console.error(`--market needs a value: ${HELP}.`);
      process.exit(1);
    }
  } else if (arg.startsWith('--market=')) {
    market = arg.slice('--market='.length);
  } else {
    viteArgs.push(arg);
  }
}

const env = { ...process.env };
if (market !== undefined) {
  if (!VALUE.test(market)) {
    console.error(`Invalid --market "${market}": expected ${HELP}.`);
    process.exit(1);
  }
  env.VITE_TCKR_SIM_CLOCK = market;
  console.log(`Simulated market clock: starting at ${market} (Cairo, latest EGX trading day).`);
}

// `npm run` puts node_modules/.bin on PATH, so this is the project's own Vite.
const child = spawn('vite', viteArgs, { stdio: 'inherit', env, shell: process.platform === 'win32' });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
