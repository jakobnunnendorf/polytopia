#!/bin/sh
# Builds the Python extension module engine/py/polyengine.so (release, abi3 for Python >= 3.9).
# Usage: engine/py/build.sh   then   import polyengine   with engine/py on sys.path.
set -e
here=$(cd "$(dirname "$0")" && pwd)
export PATH="$HOME/.cargo/bin:$PATH"
cd "$here/.."
cargo build --release -p polypy
for f in target/release/libpolyengine.dylib target/release/libpolyengine.so; do
  if [ -f "$f" ]; then
    cp "$f" "$here/polyengine.so"
    echo "built $here/polyengine.so"
    exit 0
  fi
done
echo "libpolyengine not found in target/release" >&2
exit 1
