import AppKit
import ApplicationServices
import ImageIO
import ScreenCaptureKit

@_silgen_name("_AXUIElementGetWindow")
private func _AXUIElementGetWindow(_ element: AXUIElement, _ id: UnsafeMutablePointer<CGWindowID>) -> AXError

/// A downscaled copy of a photo or emoticon, as KakaoTalk draws it.
struct Thumbnail {
    let width: Int
    let height: Int
    /// Packed 8-bit RGB, row-major, `width * height * 3` bytes.
    let rgb: Data
    /// The picture near full resolution, for terminals that draw real images.
    var png: Data?

    var json: [String: Any] {
        var d: [String: Any] = ["w": width, "h": height, "rgb": rgb.base64EncodedString()]
        if let png { d["png"] = png.base64EncodedString() }
        return d
    }
}

/// Reads pixels straight out of KakaoTalk's chat window with ScreenCaptureKit.
///
/// KakaoTalk encrypts its media cache on disk, so the drawn bubble is the only readable
/// copy. A desktop-independent window capture works even while KakaoTalk is hidden.
final class Capture {
    /// Longest side of a thumbnail in pixels. The terminal shows far fewer cells than this,
    /// but a little headroom lets the UI resample when the window is resized.
    static let maxSide = 96

    static let sharpMaxSide = 800

    /// Off until the CLI turns pictures on (`config`), so by default nothing is captured and
    /// Screen Recording permission is never asked for.
    var enabled = false
    /// Also send a sharp PNG — set when the terminal speaks kitty graphics.
    var sharp = false
    static let debug = ProcessInfo.processInfo.environment["KAKAOWORK_DEBUG"] != nil

    /// Two frames match when a 16×16 reduction differs by under ~1% per channel on average.
    static func same(_ a: CGImage, _ b: CGImage) -> Bool {
        guard let x = fingerprint(a), let y = fingerprint(b) else { return false }
        let total = zip(x, y).reduce(0) { $0 + abs(Int($1.0) - Int($1.1)) }
        return Double(total) / Double(x.count) < 2.5
    }

    private static func fingerprint(_ image: CGImage) -> [UInt8]? {
        var pixels = [UInt8](repeating: 0, count: 16 * 16 * 4)
        let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let ctx = CGContext(data: buffer.baseAddress, width: 16, height: 16, bitsPerComponent: 8, bytesPerRow: 64,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            ctx.interpolationQuality = .medium
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: 16, height: 16))
            return true
        }
        return drawn ? pixels : nil
    }

    private var windows: [CGWindowID: AnyObject] = [:]  // SCWindow, boxed for macOS 12 builds
    private var asked = false

    /// Whether the terminal may record the screen. Asks macOS once per run, the first time
    /// there is actually a picture to show.
    var allowed: Bool {
        if CGPreflightScreenCaptureAccess() { return true }
        if !asked { asked = true; _ = CGRequestScreenCaptureAccess() }
        return false
    }

    /// Captures `rect` (screen points) from `window`. Returns nil unless the whole rect is
    /// inside `viewport` — a half-scrolled photo would come out cropped.
    ///
    /// - Parameter attempts: how many frames to wait for the picture to settle. KakaoTalk loads a
    ///   picture once it scrolls into view and fades it in, so a frame grabbed too early blends it
    ///   with whatever was drawn there before. Animated emoticons never settle; pass fewer.
    func thumbnail(window: AXUIElement, rect: CGRect, viewport: CGRect, attempts: Int = 8) -> Thumbnail? {
        guard #available(macOS 14.0, *) else { return nil }
        guard enabled, rect.width >= 8, rect.height >= 8, viewport.insetBy(dx: -1, dy: -1).contains(rect), allowed else { return nil }
        var id: CGWindowID = 0
        guard _AXUIElementGetWindow(window, &id) == .success, id != 0 else { return nil }
        let frame = window.frame
        var image: CGImage?
        var tries = 0
        for _ in 0..<max(1, attempts) {
            tries += 1
            guard let current = grab(windowID: id, windowFrame: frame, rect: rect) else { break }
            if let previous = image, Capture.same(previous, current) { image = current; break }
            image = current
            if tries < attempts { usleep(90_000) }
        }
        if Capture.debug { FileHandle.standardError.write("capture: \(tries) frame(s)\n".data(using: .utf8)!) }
        guard let image, var thumbnail = Capture.downscale(image) else { return nil }
        if sharp { thumbnail.png = Capture.png(image, maxSide: Capture.sharpMaxSide) }
        return thumbnail
    }

    static func png(_ image: CGImage, maxSide: Int) -> Data? {
        let data = NSMutableData()
        guard let scaled = resized(image, maxSide: maxSide),
              let destination = CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, scaled, nil)
        return CGImageDestinationFinalize(destination) ? data as Data : nil
    }

    private static func resized(_ image: CGImage, maxSide: Int) -> CGImage? {
        let longest = max(image.width, image.height)
        guard longest > maxSide else { return image }
        let factor = Double(maxSide) / Double(longest)
        let w = max(1, Int((Double(image.width) * factor).rounded()))
        let h = max(1, Int((Double(image.height) * factor).rounded()))
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.interpolationQuality = .high
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        return ctx.makeImage()
    }

    @available(macOS 14.0, *)
    private func grab(windowID: CGWindowID, windowFrame: CGRect, rect: CGRect) -> CGImage? {
        guard let scWindow = scWindow(windowID) else { return nil }
        let filter = SCContentFilter(desktopIndependentWindow: scWindow)
        let config = SCStreamConfiguration()
        config.sourceRect = rect.offsetBy(dx: -windowFrame.minX, dy: -windowFrame.minY)
        let scale = CGFloat(filter.pointPixelScale)
        config.width = max(1, Int(rect.width * scale))
        config.height = max(1, Int(rect.height * scale))
        config.showsCursor = false
        return wait { try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config) }
    }

    /// Listing shareable content is slow (tens of ms), so windows are remembered by id.
    @available(macOS 14.0, *)
    private func scWindow(_ id: CGWindowID) -> SCWindow? {
        if let cached = windows[id] as? SCWindow { return cached }
        guard let content = wait({ try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false) })
        else { return nil }
        windows = [:]
        for w in content.windows where w.owningApplication?.bundleIdentifier == Kakao.bundleID { windows[w.windowID] = w }
        return windows[id] as? SCWindow
    }

    /// Runs async ScreenCaptureKit calls from the bridge's serial queue.
    private func wait<T>(_ body: @escaping () async throws -> T) -> T? {
        let done = DispatchSemaphore(value: 0)
        let box = ResultBox<T>()
        Task.detached {
            box.value = try? await body()
            done.signal()
        }
        return done.wait(timeout: .now() + 2) == .success ? box.value : nil
    }

    static func downscale(_ image: CGImage) -> Thumbnail? {
        let longest = max(image.width, image.height)
        let factor = min(1, Double(maxSide) / Double(longest))
        let w = max(1, Int((Double(image.width) * factor).rounded()))
        let h = max(1, Int((Double(image.height) * factor).rounded()))
        var rgba = [UInt8](repeating: 0, count: w * h * 4)
        let drawn = rgba.withUnsafeMutableBytes { buffer -> Bool in
            guard let ctx = CGContext(data: buffer.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            ctx.interpolationQuality = .high
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard drawn else { return nil }
        var rgb = Data(capacity: w * h * 3)
        for i in stride(from: 0, to: rgba.count, by: 4) { rgb.append(contentsOf: rgba[i..<i + 3]) }
        return Thumbnail(width: w, height: h, rgb: rgb)
    }
}

private final class ResultBox<T>: @unchecked Sendable {
    var value: T?
}
