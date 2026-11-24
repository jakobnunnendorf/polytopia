/**
 * Jest config. `ENGINE=rust npx jest` runs the same tests against the Rust
 * engine: imports of the ported logic/engine modules resolve to their facades
 * in logic/engine/rs/ (see jest/engine-resolver.js).
 */
module.exports = {
  preset: "jest-expo",
  // the suite is __tests__/; scripts/rust/coverage.spec.ts runs only through
  // scripts/rust/coverage.sh (its --testMatch overrides this)
  testMatch: ["<rootDir>/__tests__/**/*.[jt]s?(x)"],
  ...(process.env.ENGINE === "rust" ? { resolver: "<rootDir>/jest/engine-resolver.js" } : {}),
};
