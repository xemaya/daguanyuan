import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EXTENSIONS = ['.ts', '.mjs', '.js'];

/** 与 tsconfig paths / vite alias 保持一致的分层别名。 */
const ALIASES = {
  '@engine/': new URL('../engine/', import.meta.url),
  '@builder/': new URL('../builder/', import.meta.url),
  '@knowledge/': new URL('../knowledge/', import.meta.url),
  '@project/': new URL('../projects/daguanyuan/', import.meta.url),
};

/**
 * Resolve hook: retries an extensionless relative specifier with each known
 * source extension.
 *
 * Only relative specifiers are touched, so bare package names ("three") still
 * go through Node's normal resolution and nothing about dependency lookup
 * changes.
 */
export async function resolve(specifier, context, next) {
  for (const [prefix, base] of Object.entries(ALIASES)) {
    if (!specifier.startsWith(prefix)) continue;
    const target = new URL(specifier.slice(prefix.length), base);
    for (const ext of ['', ...EXTENSIONS]) {
      const candidate = new URL(target.href + ext);
      if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
    }
    for (const ext of EXTENSIONS) {
      const candidate = new URL(`${target.href}/index${ext}`);
      if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
    }
  }
  if (specifier.startsWith('.') && !EXTENSIONS.some((e) => specifier.endsWith(e))) {
    const base = new URL(specifier, context.parentURL);
    for (const ext of EXTENSIONS) {
      const candidate = new URL(base.href + ext);
      if (existsSync(fileURLToPath(candidate))) {
        return next(candidate.href, context);
      }
    }
    // Directory import: fall back to its index file.
    for (const ext of EXTENSIONS) {
      const candidate = new URL(`${base.href}/index${ext}`);
      if (existsSync(fileURLToPath(candidate))) {
        return next(candidate.href, context);
      }
    }
  }
  return next(specifier, context);
}
