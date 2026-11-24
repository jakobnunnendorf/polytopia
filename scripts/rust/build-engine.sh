#!/bin/zsh
# Builds the Rust engine for both places it runs:
#   engine/node/polyengine.node  Node addon (scripts, jest, training)
#   public/polyengine.wasm       WebAssembly module (the web app loads it at /polyengine.wasm)
# Run after any change under engine/ (npm run engine:build).
set -e
cd "$(dirname "$0")/../.."
export PATH="$HOME/.cargo/bin:$PATH"
cd engine
cargo build --release -p polynode
cargo build --release -p polywasm --target wasm32-unknown-unknown \
  --config profile.release.debug=0 --config profile.release.strip=true
cd ..
# write next to the target, then rename: replacing a loaded .node in place can crash running processes
cp engine/target/release/libpolynode.dylib engine/node/polyengine.node.new
mv engine/node/polyengine.node.new engine/node/polyengine.node
mkdir -p public
cp engine/target/wasm32-unknown-unknown/release/polywasm.wasm public/polyengine.wasm
ls -la engine/node/polyengine.node public/polyengine.wasm
