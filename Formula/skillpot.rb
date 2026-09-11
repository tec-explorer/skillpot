class Skillpot < Formula
  desc "Cross-agent skill supply chain security & governance layer for coding agents"
  homepage "https://github.com/tec-explorer/skillpot"
  url "https://registry.npmjs.org/@tec-explorer/skillpot/-/@tec-explorer/skillpot-0.18.0.tgz"
  sha256 "c93fc3ea740402e4fea867c48bfa8e4fcb9ad9d37a179a415cbc2b673e2a1769"
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
