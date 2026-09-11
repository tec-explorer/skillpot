class Skillpot < Formula
  desc "Cross-agent skill supply chain security & governance layer for coding agents"
  homepage "https://github.com/tec-explorer/skillpot"
  url "https://registry.npmjs.org/@tec-explorer/skillpot/-/@tec-explorer/skillpot-0.19.1.tgz"
  sha256 "eaa0482def009979df22aadd51fbe288cb9ef2f6e393c7e0f1b0afe38069e07b"
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
