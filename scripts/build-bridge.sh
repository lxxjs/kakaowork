#!/bin/sh
# Builds dist/kakao-bridge as a universal (Apple Silicon + Intel) binary so the npm
# package runs on any Mac without Xcode.
set -eu
cd "$(dirname "$0")/.."
mkdir -p dist
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
for arch in arm64 x86_64; do
	swiftc -O -target "$arch-apple-macos12" -framework ApplicationServices -framework AppKit \
		-Xlinker -weak_framework -Xlinker ScreenCaptureKit bridge/*.swift -o "$tmp/$arch"
done
lipo -create "$tmp/arm64" "$tmp/x86_64" -output dist/kakao-bridge
codesign --force --sign - dist/kakao-bridge
