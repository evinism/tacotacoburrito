// Lets plain `node` run the app's TypeScript directly, with no build step and no
// extra dependencies. Node 24 strips types on its own; what it doesn't do is
// speak tsconfig, so this fills the two gaps:
//
//   1. the `@/…` path alias (tsconfig `paths`) -> <repo>/src/…
//   2. extensionless imports (`./methodone`, `.`) -> `.ts` / `index.ts`
//
// Both are bundler conventions Next.js handles in the app; the kernel under
// src/metronome/core/ is plain TS, so this is enough to import it from scripts.
//
// Usage: node --import ./scripts/tsalias.mjs scripts/whatever.ts

import { registerHooks } from "node:module";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "..", "src");

const isFile = (p) => existsSync(p) && statSync(p).isFile();

// Probe the extensions a bundler would try, in tsconfig's order.
const probe = (basePath) => {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.js"),
  ];
  return candidates.find(isFile);
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    let basePath;
    if (specifier.startsWith("@/")) {
      basePath = path.join(SRC, specifier.slice(2));
    } else if (specifier.startsWith(".") && context.parentURL) {
      basePath = path.resolve(
        path.dirname(fileURLToPath(context.parentURL)),
        specifier,
      );
    }

    if (basePath) {
      const resolved = probe(basePath);
      if (resolved) {
        return {
          url: pathToFileURL(resolved).href,
          // The repo's package.json has no `"type"`, so Node would default
          // these files to CommonJS and choke on their ESM syntax. The
          // `-typescript` variant is what routes .ts through type stripping.
          format: resolved.endsWith(".js") ? "module" : "module-typescript",
          shortCircuit: true,
        };
      }
    }

    return nextResolve(specifier, context);
  },
});
