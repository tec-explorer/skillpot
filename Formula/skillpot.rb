class Skillpot < Formula
  desc "Cross-agent skill supply chain security & governance layer for coding agents"
  homepage "https://github.com/tec-explorer/skillpot"
  url "https://registry.npmjs.org/@tec-explorer/skillpot/-/@tec-explorer/skillpot-0.17.0.tgz"
  sha256 "736b9fd928ea1df504c5b27a1d44bcf6732f66ecbd1d3f609fcff37b73dae126"
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
