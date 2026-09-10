#!/usr/bin/env bash
set -euo pipefail

# 根据 package.json 或指定版本生成 Homebrew Formula
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-$(node -p "require('$ROOT/package.json').version")}"
FORMULA_FILE="$ROOT/Formula/skillpot.rb"

echo "== Generating Homebrew Formula for SkillPot v$VERSION =="

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# 打包 tarball 并计算 SHA256
cd "$TMP_DIR"
npm pack "$ROOT" --silent
TARBALL="$(ls -1 tec-explorer-skillpot-*.tgz | head -n 1)"
SHA256="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"

echo "Tarball: $TARBALL"
echo "SHA256:  $SHA256"

mkdir -p "$(dirname "$FORMULA_FILE")"
cat <<EOF > "$FORMULA_FILE"
class Skillpot < Formula
  desc "Cross-agent skill supply chain security & governance layer for coding agents"
  homepage "https://github.com/tec-explorer/skillpot"
  url "https://registry.npmjs.org/@tec-explorer/skillpot/-/@tec-explorer/skillpot-${VERSION}.tgz"
  sha256 "${SHA256}"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/skillpot --version")
    assert_match version.to_s, shell_output("#{bin}/spot --version")
  end
end
EOF

echo "✔ Updated $FORMULA_FILE"
