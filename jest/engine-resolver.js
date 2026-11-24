/**
 * Jest resolver for ENGINE=rust: a module that resolves to one of the ported
 * TypeScript engine files (logic/engine/<module>.ts) gets its Rust facade
 * logic/engine/rs/<module>.ts instead, whatever the import path ("@/logic/...",
 * relative, or the package index). The facades' own imports of the TypeScript
 * files (types, the pure grid helpers) are left alone. data, names, types and
 * rng stay TypeScript, so they are never redirected.
 */
const path = require("path");

const ENGINE = path.join(__dirname, "..", "logic", "engine");
const RS = path.join(ENGINE, "rs");
const PORTED = new Set(["actions", "bot", "state", "combat", "movement", "diplomacy", "opinion", "observe", "mapgen", "grid", "index", "botFull"]);

module.exports = (request, options) => {
  const resolved = options.defaultResolver(request, options);
  if (path.resolve(options.basedir) === RS) return resolved;
  if (path.dirname(resolved) !== ENGINE) return resolved;
  const base = path.basename(resolved).replace(/\.(ts|tsx|js)$/, "");
  if (!PORTED.has(base)) return resolved;
  return path.join(RS, base + ".ts");
};
