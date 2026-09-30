# Template for Formula/kakaowork.rb in lxxjs/homebrew-tap. scripts/release.sh fills in
# @URL@ and @SHA256@ and pushes it; edit this file, not the one in the tap.
class Kakaowork < Formula
  desc "KakaoTalk for macOS in your terminal, with a Claude Code-style UI"
  homepage "https://github.com/lxxjs/kakaowork"
  url "@URL@"
  sha256 "@SHA256@"
  license "MIT"

  depends_on :macos
  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  def caveats
    <<~EOS
      kakaowork drives the KakaoTalk app through the Accessibility API.
      On first run, allow your terminal app in:
        System Settings → Privacy & Security → Accessibility
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/kakaowork --version")
  end
end
