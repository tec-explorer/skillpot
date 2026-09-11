# Homebrew 分发指引：Homebrew Tap for SkillPot

SkillPot 支持通过 Homebrew 进行开箱即用的分发与管理，Mac 和 Linux 开发者无需全局安装 npm 依赖即可一键获取 `skillpot` 与 `spot` 命令。

---

## 1. 终端用户安装方式

```bash
# 1. 添加官方 Tap 仓库
brew tap tec-explorer/tap

# 2. 安装 skillpot
brew install skillpot

# 3. 验证安装
skillpot --version
spot --version
```

更新至最新版本：
```bash
brew upgrade skillpot
```

---

## 2. 仓库维护者指引（Tap 仓库与发布自动化）

### 2.1 创建 `homebrew-tap` 仓库
在 GitHub 组织 `tec-explorer` 下创建名为 `homebrew-tap` 的公共仓库：
`https://github.com/tec-explorer/homebrew-tap`

在其中维护目录结构：
```
homebrew-tap/
├── README.md
└── Formula/
    └── skillpot.rb
```

### 2.2 发布新版本时自动生成 Formula
本项目内置自动化生成工具 [`scripts/generate-brew-formula.sh`](../../scripts/generate-brew-formula.sh)：

```bash
# 执行脚本，自动拉取当前版本 tarball 并计算真实 SHA256，生成 Formula/skillpot.rb
bash scripts/generate-brew-formula.sh
```

生成的 `Formula/skillpot.rb` 格式如下：

```ruby
class Skillpot < Formula
  desc "Cross-agent skill supply chain security & governance layer for coding agents"
  homepage "https://github.com/tec-explorer/skillpot"
  url "https://registry.npmjs.org/@tec-explorer/skillpot/-/@tec-explorer/skillpot-0.19.0.tgz"
  sha256 "6b4603016602b9d9c54495b66845680921734b7a83b8e9d27041e76047729f2f"
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
```

只需将生成的 `Formula/skillpot.rb` 拷贝或同步至 `tec-explorer/homebrew-tap` 仓库并提交即可。
