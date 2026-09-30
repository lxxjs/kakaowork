#!/bin/sh
# Cuts a release: bumps the version, packs the npm tarball (which builds the universal
# bridge), publishes it as a GitHub release, and points the Homebrew formula at it.
#
#   scripts/release.sh [patch|minor|major|<version>]   (default: patch)
#   NPM=1 scripts/release.sh                            # also publish to npm
set -eu
cd "$(dirname "$0")/.."

repo=lxxjs/kakaowork
tap=lxxjs/homebrew-tap
bump=${1:-patch}

if [ -n "$(git status --porcelain)" ]; then
	echo "작업 트리가 깨끗하지 않습니다. 먼저 커밋하세요." >&2
	exit 1
fi
if [ -n "${NPM:-}" ] && ! npm whoami >/dev/null 2>&1; then
	echo "npm 에 로그인되어 있지 않습니다: npm login" >&2
	exit 1
fi
gh auth status >/dev/null

npm version "$bump" -m "Release v%s"
version=$(node -p 'require("./package.json").version')
tag="v$version"

out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
npm pack --pack-destination "$out"
tarball="$out/lxxjs-kakaowork-$version.tgz"
sha=$(shasum -a 256 "$tarball" | cut -d' ' -f1)

git push --follow-tags
gh release create "$tag" "$tarball" --repo "$repo" --title "$tag" --generate-notes

# Publish the very tarball the formula points at, so npm and Homebrew ship the same bits.
[ -z "${NPM:-}" ] || npm publish "$tarball"

gh repo view "$tap" >/dev/null 2>&1 ||
	gh repo create "$tap" --public --description "Homebrew formulae for kakaowork"
gh repo clone "$tap" "$out/tap" -- --quiet 2>/dev/null || git init --quiet -b main "$out/tap"
mkdir -p "$out/tap/Formula"
sed -e "s|@URL@|https://github.com/$repo/releases/download/$tag/lxxjs-kakaowork-$version.tgz|" \
	-e "s|@SHA256@|$sha|" packaging/kakaowork.rb >"$out/tap/Formula/kakaowork.rb"
(
	cd "$out/tap"
	git add Formula/kakaowork.rb
	git commit --quiet -m "kakaowork $version"
	git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$tap.git"
	git push --quiet origin HEAD:main
)

echo "릴리스 완료: $tag"
echo "  brew install lxxjs/tap/kakaowork"
[ -z "${NPM:-}" ] || echo "  npm i -g @lxxjs/kakaowork"
