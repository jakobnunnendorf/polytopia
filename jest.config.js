/** Jest config: the suite is __tests__/, run against the engine (the Rust addon, see logic/engine/rust.ts). */
module.exports = {
  preset: "jest-expo",
  // scripts/rust/coverage.spec.ts runs only through scripts/rust/coverage.sh (its --testMatch overrides this)
  testMatch: ["<rootDir>/__tests__/**/*.[jt]s?(x)"],
};
