/**
 * Module resolve hook for running the TS suites under Node's built-in runner:
 *   - maps the `@/` path alias to ./src
 *   - appends `.ts` to extensionless relative/alias imports
 *   - redirects `vitest` to the local shim
 *
 * Used only for the no-npm verification path. Real Vitest uses tsconfig paths.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as presolve } from 'node:path';

const SRC = presolve(fileURLToPath(new URL('../../src', import.meta.url)));
const SHIM = new URL('./vitest-shim.mjs', import.meta.url).href;

function withTs(path) {
  if (/\.(ts|mjs|js|json)$/.test(path)) return path;
  if (existsSync(path + '.ts')) return path + '.ts';
  return path;
}

export async function resolve(specifier, context, next) {
  if (specifier === 'vitest') return { url: SHIM, shortCircuit: true };
  if (specifier.startsWith('node:')) return next(specifier, context);

  if (specifier.startsWith('@/')) {
    const p = withTs(presolve(SRC, specifier.slice(2)));
    return { url: pathToFileURL(p).href, shortCircuit: true };
  }
  if (specifier.startsWith('.')) {
    const parent = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : process.cwd();
    const p = withTs(presolve(parent, specifier));
    return { url: pathToFileURL(p).href, shortCircuit: true };
  }
  return next(specifier, context);
}
