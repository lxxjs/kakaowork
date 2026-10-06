import AppKit
import ApplicationServices

struct BridgeError: Error {
    let code: String
    let message: String
    init(_ code: String, _ message: String) { self.code = code; self.message = message }
}

/// Drives the KakaoTalk macOS app through the Accessibility API.
/// Every method must run on the bridge's single serial queue.
final class Kakao {
    static let bundleID = "com.kakao.KakaoTalkMac"
    private static let returnKey: CGKeyCode = 36
    private static let sendTitles: Set<String> = ["전송", "Send"]
    private static let inputLabels: Set<String> = ["메시지 입력", "Enter a message", "Message"]

    private var cached: (pid: pid_t, element: AXUIElement)?
    let capture = Capture()

    /// Keep KakaoTalk hidden: re-hide it after it had to come forward, and whenever the
    /// user switches away from it.
    var keepHidden = false

    /// The app that launched us (the terminal), where focus goes back to.
    private let homeBundleID = ProcessInfo.processInfo.environment["__CFBundleIdentifier"]

    var app: NSRunningApplication? {
        for attempt in 0..<3 {
            if let app = NSRunningApplication.runningApplications(withBundleIdentifier: Self.bundleID).first { return app }
            // A freshly started process can briefly see an empty list of running apps.
            if attempt < 2 { usleep(100_000) }
        }
        return nil
    }

    func axApp() throws -> AXUIElement {
        guard AXIsProcessTrusted() else {
            throw BridgeError("not_trusted", "터미널 앱에 손쉬운 사용(Accessibility) 권한이 필요합니다")
        }
        guard let app else { throw BridgeError("not_running", "카카오톡이 실행 중이 아닙니다") }
        if let cached, cached.pid == app.processIdentifier { return cached.element }
        let element = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(element, 3)
        cached = (app.processIdentifier, element)
        return element
    }

    func windows() throws -> [AXUIElement] {
        try axApp().attribute(kAXWindowsAttribute) as? [AXUIElement] ?? []
    }

    // MARK: main window / chat list

    /// - Parameter reopen: bring the main window back if it was closed. Polling passes false
    ///   so a closed window never makes KakaoTalk flash repeatedly.
    func mainWindow(reopen: Bool = true) throws -> AXUIElement {
        func find() throws -> AXUIElement? { try windows().first { $0.identifier == "Main Window" } }
        if let w = try find() { return w }
        guard reopen else { throw BridgeError("no_main_window", "카카오톡 메인 창이 닫혀 있습니다") }

        // The main window was closed. "창 > 채팅" (⌘2) reopens it while KakaoTalk is active;
        // the menu bar icon's "카카오톡 열기" also works when it is not.
        let previous = frontmostApp()
        defer { handBack(to: previous) }
        try pressMenu(["창", "Window"], item: ["채팅", "Chats"])
        for _ in 0..<10 {
            usleep(100_000)
            if let w = try find() { return w }
        }
        try pressStatusMenu(item: ["카카오톡 열기", "Open KakaoTalk"])
        for _ in 0..<20 {
            usleep(100_000)
            if let w = try find() { return w }
        }
        let locked = NSWorkspace.shared.frontmostApplication?.bundleIdentifier == "com.apple.loginwindow"
        throw BridgeError("no_main_window", locked
            ? "화면이 잠겨 있어 카카오톡 창을 읽을 수 없습니다"
            : "카카오톡 메인 창을 찾을 수 없습니다 · 카카오톡 창을 한 번 열어 주세요")
    }

    // MARK: focus

    // NSRunningApplication's isActive/isHidden lag behind (they update on the main run loop),
    // so ask the Accessibility API, which answers live.
    func isHidden() -> Bool { (try? axApp())?.attribute(kAXHiddenAttribute) as? Bool ?? false }
    func isFrontmost() -> Bool { (try? axApp())?.attribute(kAXFrontmostAttribute) as? Bool ?? false }

    func frontmostApp() -> NSRunningApplication? {
        if let focused = AXUIElementCreateSystemWide().attribute(kAXFocusedApplicationAttribute) {
            var pid: pid_t = 0
            if AXUIElementGetPid(focused as! AXUIElement, &pid) == .success, let app = NSRunningApplication(processIdentifier: pid) { return app }
        }
        return NSWorkspace.shared.frontmostApplication
    }

    /// Unhides KakaoTalk and makes it frontmost, for the few things that need real key focus.
    private func bringForward() throws {
        let app = try axApp()
        if isHidden() { app.set(kAXHiddenAttribute, kCFBooleanFalse) }
        app.set(kAXFrontmostAttribute, kCFBooleanTrue)
    }

    /// Gives focus back to where the user was and, in keep-hidden mode, hides KakaoTalk again.
    /// Activating first matters: hiding the frontmost app lets macOS pick the next one.
    /// The app to give focus back to: where the user was, or else the terminal running us.
    private func userApp(_ previous: NSRunningApplication?) -> NSRunningApplication? {
        guard let kakao = app else { return previous }
        if let previous, previous.processIdentifier != kakao.processIdentifier { return previous }
        return keepHidden ? homeBundleID.flatMap { NSRunningApplication.runningApplications(withBundleIdentifier: $0).first } : nil
    }

    func handBack(to previous: NSRunningApplication?) {
        guard let kakao = app else { return }
        let target = userApp(previous)
        // Hiding first takes KakaoTalk off screen at once; macOS then hands focus to the app
        // that was active before it, and we make sure it is the one the user was in.
        if keepHidden { (try? axApp())?.set(kAXHiddenAttribute, kCFBooleanTrue) }
        if let target, target.processIdentifier != kakao.processIdentifier,
           frontmostApp()?.processIdentifier != target.processIdentifier {
            let front = AXUIElementCreateApplication(target.processIdentifier)
            if front.set(kAXFrontmostAttribute, kCFBooleanTrue) != .success { target.activate() }
            for _ in 0..<20 where isFrontmost() { usleep(10_000) }
            if keepHidden { (try? axApp())?.set(kAXHiddenAttribute, kCFBooleanTrue) }
        }
    }

    /// Called from polling: once the user has left KakaoTalk, tuck it away again.
    func enforceHidden() {
        guard keepHidden, app != nil, !isHidden() else { return }
        // Polling never overlaps open(), so KakaoTalk in front now means the user brought it up.
        if isFrontmost() { unparkAll(); return }
        (try? axApp())?.set(kAXHiddenAttribute, kCFBooleanTrue)
    }

    private func trace(_ what: String) {
        guard ProcessInfo.processInfo.environment["KAKAOWORK_DEBUG"] != nil else { return }
        FileHandle.standardError.write(String(format: "%.3f %@\n", Date().timeIntervalSince1970, what).data(using: .utf8)!)
    }

    /// KakaoTalk unhides itself once more as it finishes putting a room's window up; hide it
    /// again whenever that happens, in the background so the open can return right away.
    private func keepHidden(_ app: AXUIElement, for seconds: TimeInterval) {
        Thread {
            let until = Date().addingTimeInterval(seconds)
            while Date() < until {
                if app.attribute(kAXHiddenAttribute) as? Bool == false {
                    app.set(kAXHiddenAttribute, kCFBooleanTrue)
                    self.trace("KakaoTalk unhid itself; hidden again")
                }
                usleep(3_000)
            }
        }.start()
    }

    /// Watches the window server (not the Accessibility tree, which waits on KakaoTalk while it
    /// is busy putting the window up) for the room's new window, and brings the user's app
    /// back in front of it the frame it appears. Raising the user's app is handled by that
    /// app, so it lands even while KakaoTalk is too busy to be hidden.
    private func coverNewWindow(of pid: pid_t, with user: NSRunningApplication?) -> WindowWatch? {
        guard let user, user.processIdentifier != pid else { return nil }
        let before = onScreenWindowIDs(pid)
        let watch = WindowWatch()
        let front = AXUIElementCreateApplication(user.processIdentifier)
        Thread {
            let deadline = Date().addingTimeInterval(4)
            while !watch.stopped && Date() < deadline {
                if self.onScreenWindowIDs(pid).contains(where: { !before.contains($0) }) {
                    front.set(kAXFrontmostAttribute, kCFBooleanTrue)
                    self.trace("new window on screen; raised \(user.localizedName ?? "user app") over it")
                    // KakaoTalk activates itself while it shows the window; if that lands after
                    // our raise it ends up on top again, so keep the user's app in front a while.
                    // (Asking the user's app is cheap even while KakaoTalk is busy.)
                    let until = Date().addingTimeInterval(0.4)
                    while !watch.stopped && Date() < until {
                        if front.attribute(kAXFrontmostAttribute) as? Bool != true {
                            front.set(kAXFrontmostAttribute, kCFBooleanTrue)
                            self.trace("KakaoTalk came back on top; raised user app again")
                        }
                        usleep(2_000)
                    }
                    return
                }
                usleep(2_000)
            }
        }.start()
        return watch
    }

    /// KakaoTalk's normal-level windows currently drawn on screen, straight from the window server.
    private func onScreenWindowIDs(_ pid: pid_t) -> Set<CGWindowID> {
        let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        return Set(list.compactMap { info -> CGWindowID? in
            guard (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
                  (info[kCGWindowLayer as String] as? NSNumber)?.intValue == 0 else { return nil }
            return (info[kCGWindowNumber as String] as? NSNumber).map { CGWindowID($0.uint32Value) }
        })
    }

    // MARK: parking
    //
    // Opening a room needs KakaoTalk in front for a moment, which would flash its windows on
    // screen. So while it is kept hidden its windows wait in the bottom-right corner of the
    // main display — as far off screen as macOS allows (it keeps a sliver of title bar on
    // screen) — and go back to where they were whenever KakaoTalk is shown or closed, so using
    // KakaoTalk directly still finds them in place.
    //
    // macOS only accepts that spot for a visible window; a hidden window parked anywhere it
    // considers invalid gets pulled fully on screen when it reappears. So the spot is learned:
    // the first time KakaoTalk has to come forward, windows are pushed into the corner and
    // wherever macOS lets them settle is remembered, and from then on they wait there.

    private var homes: [String: CGPoint] = [:]
    private var learnedSpot: CGPoint?

    private var cornerRequest: CGPoint {
        let f = NSScreen.screens.first?.frame ?? .zero
        return CGPoint(x: f.maxX - 1, y: f.maxY - 1)
    }

    private func isParked(_ origin: CGPoint) -> Bool {
        guard let spot = learnedSpot else { return false }
        return abs(origin.x - spot.x) < 2 && abs(origin.y - spot.y) < 2
    }

    private func homeKey(_ window: AXUIElement) -> String {
        window.identifier == "Main Window" ? "main" : "chat:" + window.title
    }

    private func home(for key: String) -> CGPoint {
        if let p = homes[key] { return p }
        let main = homes["main"] ?? CGPoint(x: 200, y: 120)
        return key == "main" ? main : CGPoint(x: main.x + 30, y: main.y + 30)
    }

    private func setOrigin(_ window: AXUIElement, _ point: CGPoint) {
        var p = point
        window.set(kAXPositionAttribute, AXValueCreate(.cgPoint, &p)!)
    }

    /// Sends a window to the corner. While KakaoTalk is hidden this only happens once the
    /// spot is known to be acceptable; a visible window teaches us the spot.
    func park(_ window: AXUIElement, visible: Bool) {
        let origin = window.frame.origin
        guard !isParked(origin) else { return }
        if homes[homeKey(window)] == nil { homes[homeKey(window)] = origin }
        if visible {
            setOrigin(window, cornerRequest)
            // macOS settles the position a moment later; remember where it ends up.
            var settled = window.frame.origin
            for _ in 0..<10 {
                usleep(5_000)
                let now = window.frame.origin
                if now == settled && now != cornerRequest { break }
                settled = now
            }
            learnedSpot = settled
        } else if let spot = learnedSpot {
            setOrigin(window, spot)
        }
    }

    /// Puts a window we moved back where it was.
    private func unpark(_ window: AXUIElement) {
        let key = homeKey(window)
        guard homes[key] != nil || isParked(window.frame.origin) else { return }
        setOrigin(window, home(for: key))
        homes[key] = nil
    }

    /// Puts every window we moved back (on show, on exit, when the user opens KakaoTalk).
    func unparkAll() {
        for window in (try? windows()) ?? [] { unpark(window) }
    }

    /// The chat list table in the main window, switching to the chats tab if needed.
    func chatList(reopen: Bool = true) throws -> (scroll: AXUIElement, table: AXUIElement) {
        if let found = try findChatList(in: mainWindow(reopen: reopen)) { return found }
        try pressMenu(["창", "Window"], item: ["채팅", "Chats"])
        usleep(300_000)
        if let found = try findChatList(in: mainWindow(reopen: reopen)) { return found }
        throw BridgeError("no_chat_list", "채팅 목록을 찾을 수 없습니다")
    }

    private func findChatList(in window: AXUIElement) -> (scroll: AXUIElement, table: AXUIElement)? {
        let candidates = window.children.filter { $0.role == "AXScrollArea" }.compactMap { scroll -> (AXUIElement, AXUIElement, CGFloat)? in
            guard let table = scroll.children.first(where: { $0.role == "AXTable" }) else { return nil }
            return (scroll, table, scroll.frame.height)
        }
        // Chat rows carry a message preview (a scroll area) — friend rows do not.
        for (scroll, table, _) in candidates.sorted(by: { $0.2 > $1.2 }) {
            let rows = visibleRows(table).prefix(3)
            let looksLikeChats = rows.contains { row in
                guard let cell = row.children.first else { return false }
                return cell.children.contains { $0.role == "AXScrollArea" || $0.identifier == "_NS:69" }
            }
            if looksLikeChats { return (scroll, table) }
        }
        return nil
    }

    func totalUnread(reopen: Bool = true) -> Int? {
        guard let main = try? mainWindow(reopen: reopen) else { return nil }
        let kids = main.children
        guard let button = kids.first(where: { $0.identifier == "chatrooms" }) else { return nil }
        let bf = button.frame
        for kid in kids where kid.role == "AXStaticText" {
            if kid.frame.intersects(bf), let v = kid.string, Parse.isCount(v) { return Parse.count(v) }
        }
        return 0
    }

    func myName() throws -> String? {
        let (scroll, table) = try chatList()
        var name: String?
        visitRows(scroll: scroll, table: table, indices: Array(0..<min(40, table.children.count))) { index, row in
            guard let room = Parse.chatRow(row, index: index), room.kind == "me" else { return false }
            name = room.name
            return true
        }
        return name
    }

    func chats(limit: Int) throws -> [ChatRoom] {
        let (scroll, table) = try chatList()
        let count = min(limit, table.children.count)
        var found: [Int: ChatRoom] = [:]
        visitRows(scroll: scroll, table: table, indices: Array(0..<count)) { index, row in
            if let room = Parse.chatRow(row, index: index) { found[index] = room }
            return false
        }
        return found.keys.sorted().compactMap { found[$0] }
    }

    /// Only the rows currently on screen — cheap enough to poll.
    func visibleChats() throws -> [ChatRoom] {
        let (_, table) = try chatList(reopen: false)
        return visibleRows(table).compactMap { row in
            guard let index = row.attribute("AXIndex") as? Int else { return nil }
            return Parse.chatRow(row, index: index)
        }
    }

    // MARK: chat windows

    func chatWindow(title: String) throws -> AXUIElement? {
        try windows().first { $0.identifier != "Main Window" && $0.title == title && messageTable(in: $0) != nil }
    }

    func openChatTitles() throws -> [String] {
        try windows().filter { $0.identifier != "Main Window" && messageTable(in: $0) != nil }.map(\.title)
    }

    func messageTable(in window: AXUIElement) -> (scroll: AXUIElement, table: AXUIElement)? {
        for scroll in window.children where scroll.role == "AXScrollArea" {
            if let table = scroll.children.first(where: { $0.role == "AXTable" }) { return (scroll, table) }
        }
        return nil
    }

    /// The message composer. Other text areas can appear in a chat window (the in-chat
    /// search bar, a reply preview), so prefer the labelled one, then the lowest one.
    private func inputArea(in window: AXUIElement) -> AXUIElement? {
        let areas = window.children.filter { $0.role == "AXScrollArea" }
            .flatMap { $0.children.filter { $0.role == "AXTextArea" } }
        if let labelled = areas.first(where: { Self.inputLabels.contains($0.attribute(kAXDescriptionAttribute) as? String ?? "") }) {
            return labelled
        }
        return areas.max { $0.frame.maxY < $1.frame.maxY }
    }

    private func requireWindow(_ title: String) throws -> AXUIElement {
        guard let w = try chatWindow(title: title) else {
            throw BridgeError("no_window", "'\(title)' 채팅창이 열려 있지 않습니다")
        }
        return w
    }

    // MARK: open

    func open(name: String, hint: Int?) throws -> [String: Any] {
        if try chatWindow(title: name) != nil { return ["title": name, "alreadyOpen": true] }
        let app = try axApp()
        let (scroll, table) = try chatList()
        guard let index = findRow(named: name, hint: hint, scroll: scroll, table: table) else {
            throw BridgeError("not_found", "'\(name)' 채팅방을 찾을 수 없습니다")
        }

        // What works without focus happens while KakaoTalk is still hidden, so the moment it
        // has to be in front is as short as possible.
        scrollIntoView(scroll: scroll, table: table, index: index)
        let main = try mainWindow()
        if keepHidden { for window in try windows() { park(window, visible: false) } }

        let previous = frontmostApp()
        let wasHidden = isHidden()
        defer {
            handBack(to: previous)
            if wasHidden && !keepHidden { app.set(kAXHiddenAttribute, kCFBooleanTrue) }
        }

        // Quietly first: the user's app gets the front back right after the key, so KakaoTalk
        // builds the room's window behind it. Should KakaoTalk lose the key that way, press
        // again the plain way.
        for quiet in keepHidden ? [true, false] : [false] {
            if try press(row: index, named: name, in: table, main: main, quiet: quiet, previous: previous) {
                return ["title": name, "alreadyOpen": false]
            }
            trace("room did not open (quiet: \(quiet))")
        }
        throw BridgeError("open_timeout", "'\(name)' 채팅창이 열리지 않았습니다")
    }

    /// Selects a room in the chat list and presses Return on it; true once its window exists.
    ///
    /// Opening a room needs a real Return keypress in the chat list, so KakaoTalk has to be
    /// frontmost with the list focused. Focus is verified before the key is sent so a stray
    /// Return can never land in some chat's input field.
    private func press(row index: Int, named name: String, in table: AXUIElement, main: AXUIElement,
                       quiet: Bool, previous: NSRunningApplication?) throws -> Bool {
        if try chatWindow(title: name) != nil { return true }
        let app = try axApp()
        guard let kakao = self.app else { throw BridgeError("not_running", "카카오톡이 실행 중이 아닙니다") }

        try bringForward()
        // Visible now: anything not sitting in the corner (first time, or macOS moved it) goes there.
        if keepHidden { for window in try windows() { park(window, visible: true) } }
        main.perform(kAXRaiseAction)
        main.set(kAXMainAttribute, kCFBooleanTrue)

        // KakaoTalk rebuilds the list when it comes forward, so find the row again now.
        let rows = table.children
        guard index < rows.count, Parse.chatRow(rows[index], index: index)?.name == name else {
            throw BridgeError("not_found", "채팅 목록이 바뀌었습니다. 다시 시도해 주세요")
        }
        let row = rows[index]
        row.set(kAXSelectedAttribute, kCFBooleanTrue)
        table.set(kAXSelectedRowsAttribute, [row] as CFArray)

        var ready = false
        for _ in 0..<50 {
            table.set(kAXFocusedAttribute, kCFBooleanTrue)
            let focusedWindow = app.attribute(kAXFocusedWindowAttribute).map { $0 as! AXUIElement }
            let focused = app.attribute(kAXFocusedUIElementAttribute).map { $0 as! AXUIElement }
            let selected = (table.attribute(kAXSelectedRowsAttribute) as? [AXUIElement]) ?? []
            if focusedWindow?.same(main) == true, focused.map({ $0.same(table) || $0.role == "AXTable" }) == true,
               selected.contains(where: { $0.same(row) }) {
                ready = true
                break
            }
            usleep(10_000)
        }
        guard ready else { throw BridgeError("focus_failed", "카카오톡 채팅 목록에 포커스를 줄 수 없습니다") }

        let pid = kakao.processIdentifier
        let watch = keepHidden ? coverNewWindow(of: pid, with: userApp(previous)) : nil
        defer { if let watch { DispatchQueue.global().asyncAfter(deadline: .now() + 0.5) { watch.stop() } } }
        let source = CGEventSource(stateID: .privateState)
        CGEvent(keyboardEventSource: source, virtualKey: Self.returnKey, keyDown: true)?.postToPid(pid)
        CGEvent(keyboardEventSource: source, virtualKey: Self.returnKey, keyDown: false)?.postToPid(pid)
        trace("return sent")
        // The key is already queued ahead of the deactivation this causes, so KakaoTalk still
        // handles it — and then puts the room's window up as a background app, behind the user's.
        if quiet, let user = userApp(previous) {
            AXUIElementCreateApplication(user.processIdentifier).set(kAXFrontmostAttribute, kCFBooleanTrue)
            trace("gave the front back to \(user.localizedName ?? "user app")")
        }

        // The room's window comes up wherever KakaoTalk last saved it, and macOS won't let a new
        // window appear off screen. KakaoTalk creates the window a moment before it puts it on
        // screen (unhiding itself to do so), so hide it as soon as the window exists and keep it
        // hidden while KakaoTalk tries to show it; the room finishes loading in the background.
        let deadline = Date().addingTimeInterval(quiet ? 2.5 : 4)
        while Date() < deadline {
            usleep(3_000)
            if let window = try chatWindow(title: name) {
                trace("chat window in AX tree, hidden=\(isHidden())")
                if keepHidden {
                    app.set(kAXHiddenAttribute, kCFBooleanTrue)
                    park(window, visible: false)
                    keepHidden(app, for: 0.6)
                }
                return true
            }
        }
        return false
    }

    private func findRow(named name: String, hint: Int?, scroll: AXUIElement, table: AXUIElement) -> Int? {
        let rows = table.children
        if let hint, hint < rows.count, Parse.chatRow(rows[hint], index: hint)?.name == name { return hint }
        var found: Int?
        visitRows(scroll: scroll, table: table, indices: Array(0..<rows.count)) { index, row in
            guard Parse.chatRow(row, index: index)?.name == name else { return false }
            found = index
            return true
        }
        return found
    }

    func close(title: String) throws {
        let window = try requireWindow(title)
        guard let button = window.children.first(where: { $0.attribute(kAXSubroleAttribute) as? String == kAXCloseButtonSubrole }) else {
            throw BridgeError("close_failed", "닫기 버튼을 찾을 수 없습니다")
        }
        // KakaoTalk reopens a room where its window was last closed, so don't leave it parked.
        unpark(window)
        button.perform(kAXPressAction)
    }

    // MARK: messages

    func messages(title: String, limit: Int) throws -> (messages: [Message], rowCount: Int) {
        let window = try requireWindow(title)
        guard let (scroll, table) = messageTable(in: window) else {
            throw BridgeError("no_window", "메시지 목록을 찾을 수 없습니다")
        }
        loadHistory(scroll: scroll, table: table, rows: limit + 2)
        let count = table.children.count
        var list = read(window: window, scroll: scroll, table: table, indices: Array(max(0, count - limit - 1)..<count))
        if list.count > limit { list = Array(list.suffix(limit)) }
        complete(&list, scroll: scroll, table: table)
        return (list, count)
    }

    /// Makes KakaoTalk load older history until its table holds `wanted` rows, and returns how
    /// many it added in front. KakaoTalk keeps only the newest rows of a conversation in the
    /// table and fetches the ~50 before them each time the list is scrolled to its top.
    @discardableResult
    func loadHistory(scroll: AXUIElement, table: AXUIElement, rows wanted: Int) -> Int {
        let initial = table.children.count
        var count = initial
        guard count < wanted, let bar = scrollBar(scroll) else { return 0 }
        let atBottom = (bar.number ?? 1) > 0.999
        // KakaoTalk can add a second batch a moment after the first, so wait for the count to hold still.
        func settled() -> Int {
            var seen = table.children.count
            var calm = 0
            while calm < 4 {
                usleep(100_000)
                let now = table.children.count
                if now == seen { calm += 1 } else { seen = now; calm = 0 }
            }
            return seen
        }
        while count < wanted {
            // Already at the top, nothing would move; step away first.
            if (bar.number ?? 1) < 0.001 { bar.set(kAXValueAttribute, 0.02 as CFNumber); usleep(50_000) }
            bar.set(kAXValueAttribute, 0 as CFNumber)
            for _ in 0..<15 where table.children.count <= count { usleep(100_000) }
            let grown = settled()
            if grown <= count { break }  // the start of the conversation
            count = grown
        }
        // Loading leaves the list where it was reading; a hidden window belongs at the newest message.
        if atBottom {
            bar.set(kAXValueAttribute, 1 as CFNumber)
            count = settled()
        }
        return count - initial
    }

    /// Reads the rows at `indices`, oldest first, with their pictures.
    func read(window: AXUIElement, scroll: AXUIElement, table: AXUIElement, indices: [Int]) -> [Message] {
        let rows = table.children
        var parsed: [Int: Message] = [:]
        let viewport = scroll.frame
        visitRows(scroll: scroll, table: table, indices: indices) { index, row in
            if let m = parseWithImage(row, index: index, window: window, viewport: viewport) { parsed[index] = m }
            return false
        }
        // Rows are read as soon as any part is on screen, so a tall photo can come out clipped.
        // Scroll each of those fully into view and try again.
        let missed = parsed.values.filter { $0.imageFrame != nil && $0.image == nil }.map(\.row).sorted()
        if !missed.isEmpty {
            let bar = scrollBar(scroll)
            let original = bar?.number
            for index in missed where index < rows.count {
                park(scroll: scroll, table: table, bar: bar, row: rows[index], atBottom: false)
                if let m = parseWithImage(rows[index], index: index, window: window, viewport: viewport) { parsed[index] = m }
            }
            if let bar, let original { bar.set(kAXValueAttribute, original as CFNumber) }
        }
        return parsed.keys.sorted().compactMap { parsed[$0] }
    }

    /// Fills in what a run of rows does not say by itself: senders and separator dates.
    func complete(_ list: inout [Message], scroll: AXUIElement, table: AXUIElement) {
        // A sender's follow-up bubbles carry no name; look further back for the first one.
        var carry: String?
        if let first = list.first(where: { $0.kind != "divider" && $0.kind != "system" }), !first.mine, !first.hasProfile, first.row > 0 {
            let back = Array(max(0, first.row - 30)..<first.row).reversed()
            visitRows(scroll: scroll, table: table, indices: Array(back), restore: true) { index, row in
                guard let m = Parse.messageRow(row, index: index) else { return false }
                if m.mine || m.kind == "divider" || m.kind == "system" { return true }
                if m.hasProfile { carry = m.sender; return true }
                return false
            }
        }
        Kakao.fillSenders(&list, carry: carry)
        Kakao.fillDividerDates(&list)
    }

    /// Re-reads rows `from` through the newest (at most `limit`) for their unread counts.
    /// Pictures are not captured, so this is cheap enough to repeat every few seconds.
    func unread(title: String, from: Int, limit: Int) throws -> [Message] {
        let window = try requireWindow(title)
        guard let (scroll, table) = messageTable(in: window) else {
            throw BridgeError("no_window", "메시지 목록을 찾을 수 없습니다")
        }
        let count = table.children.count
        let start = min(count, max(0, from, count - limit))
        var parsed: [Message] = []
        visitRows(scroll: scroll, table: table, indices: Array(start..<count)) { index, row in
            if let m = Parse.messageRow(row, index: index) { parsed.append(m) }
            return false
        }
        return parsed.sorted { $0.row < $1.row }
    }

    /// Parses a row and, if it shows a photo or emoticon, grabs the picture while it is on screen.
    func parseWithImage(_ row: AXUIElement, index: Int, window: AXUIElement, viewport: CGRect) -> Message? {
        guard var m = Parse.messageRow(row, index: index) else { return nil }
        if var frame = m.imageFrame {
            // Photos are drawn with rounded corners and a hairline border, so the full frame
            // picks up the chat background at its edges; trim a little off every side.
            if m.kind == "photo" {
                let inset = max(3, min(frame.width, frame.height) * 0.03)
                frame = frame.insetBy(dx: inset, dy: inset)
            }
            m.image = capture.thumbnail(window: window, rect: frame, viewport: viewport, attempts: m.kind == "emoticon" ? 3 : 8)
        }
        return m
    }

    /// Date separators expose no text, but every day's messages carry their date on
    /// their time labels — so a separator takes the date of the next labelled message.
    static func fillDividerDates(_ list: inout [Message]) {
        var next: String?
        for i in list.indices.reversed() {
            if list[i].kind == "divider" {
                if list[i].date == nil { list[i].date = next }
                next = nil
            } else if let date = list[i].date {
                next = date
            }
        }
    }

    static func fillSenders(_ list: inout [Message], carry: String?) {
        var last = carry
        for i in list.indices {
            let m = list[i]
            if m.mine || m.kind == "divider" || m.kind == "system" { last = nil; continue }
            if m.hasProfile { last = m.sender } else if m.sender == nil { list[i].sender = last }
        }
    }

    // MARK: send

    func send(title: String, text: String) throws {
        let window = try requireWindow(title)
        guard let input = inputArea(in: window) else { throw BridgeError("send_failed", "입력창을 찾을 수 없습니다") }
        let inputFrame = input.frame
        let buttons = window.children.filter { $0.role == "AXButton" }
        let sendButton = buttons.first { Self.sendTitles.contains($0.title) }
            ?? buttons.filter { $0.frame.minY >= inputFrame.minY && !$0.title.isEmpty }.max { $0.frame.maxX < $1.frame.maxX }
        guard let send = sendButton else { throw BridgeError("send_failed", "전송 버튼을 찾을 수 없습니다") }

        // Whatever was typed in KakaoTalk itself goes back once our message is out.
        let draft = input.string ?? ""
        defer { if !draft.isEmpty { input.set(kAXValueAttribute, draft as CFString) } }

        // The send button only enables once KakaoTalk has processed the text change (~50–300ms).
        func fill() throws -> Bool {
            guard input.set(kAXValueAttribute, text as CFString) == .success else {
                throw BridgeError("send_failed", "입력창에 메시지를 넣지 못했습니다")
            }
            for _ in 0..<30 {
                usleep(50_000)
                if send.attribute(kAXEnabledAttribute) as? Bool == true { return true }
            }
            return false
        }
        var enabled = try fill()
        if !enabled {
            // Give the composer focus and try once more before giving up.
            input.set(kAXValueAttribute, "" as CFString)
            input.set(kAXFocusedAttribute, kCFBooleanTrue)
            usleep(100_000)
            enabled = try fill()
        }
        guard enabled else {
            input.set(kAXValueAttribute, "" as CFString)
            throw BridgeError("send_failed", "전송 버튼이 활성화되지 않았습니다\(blockers(window))")
        }
        // KakaoTalk reports failure for AXPress even when it sends, so check the input instead.
        // A read KakaoTalk is too busy to answer says nothing either way, so it doesn't count.
        func cleared() -> Bool {
            var value: AnyObject?
            switch AXUIElementCopyAttributeValue(input, kAXValueAttribute as CFString, &value) {
            case .success: return (value as? String ?? "").isEmpty
            case .noValue: return true
            default: return false
            }
        }
        send.perform(kAXPressAction)
        for _ in 0..<40 {
            usleep(50_000)
            if cleared() { return }
        }
        input.set(kAXValueAttribute, "" as CFString)
        throw BridgeError("send_failed", "전송되지 않았습니다")
    }

    /// Explains what in KakaoTalk might be stopping a send, for the error message.
    private func blockers(_ window: AXUIElement) -> String {
        var reasons: [String] = []
        if window.attribute(kAXMinimizedAttribute) as? Bool == true { reasons.append("채팅창이 최소화되어 있음") }
        if window.children.contains(where: { $0.role == "AXSheet" }) { reasons.append("채팅창에 대화상자가 열려 있음") }
        if let windows = try? windows(), windows.contains(where: {
            let sub = $0.attribute(kAXSubroleAttribute) as? String
            return sub == kAXDialogSubrole || sub == kAXSystemDialogSubrole
        }) {
            reasons.append("카카오톡에 대화상자가 열려 있음")
        }
        if let focused = (try? axApp())?.attribute(kAXFocusedUIElementAttribute).map({ $0 as! AXUIElement }),
           ["AXMenu", "AXMenuItem"].contains(focused.role) {
            reasons.append("카카오톡 메뉴가 열려 있음")
        }
        let areas = window.children.filter { $0.role == "AXScrollArea" }.flatMap { $0.children.filter { $0.role == "AXTextArea" } }
        if areas.count > 1 { reasons.append("입력창이 \(areas.count)개로 보임") }
        return reasons.isEmpty ? "" : " (\(reasons.joined(separator: ", ")))"
    }

    // MARK: app visibility

    func setHidden(_ hidden: Bool) throws {
        let app = try axApp()
        keepHidden = hidden
        if !hidden { unparkAll() }
        if hidden, isFrontmost() {
            handBack(to: nil)  // hands focus to the terminal, then hides
        } else {
            app.set(kAXHiddenAttribute, hidden ? kCFBooleanTrue : kCFBooleanFalse)
        }
    }

    /// Presses an item in KakaoTalk's menu bar icon menu. Titles must match exactly —
    /// "모두 읽음 처리" sits right next to "카카오톡 열기".
    func pressStatusMenu(item itemTitles: Set<String>) throws {
        guard let extras = try axApp().attribute("AXExtrasMenuBar").map({ $0 as! AXUIElement }) else { return }
        for barItem in extras.children {
            for menu in barItem.children {
                for item in menu.children where itemTitles.contains(item.title) {
                    item.perform(kAXPressAction)
                    return
                }
            }
        }
    }

    func pressMenu(_ menuTitles: Set<String>, item itemTitles: Set<String>) throws {
        guard let bar = try axApp().attribute(kAXMenuBarAttribute).map({ $0 as! AXUIElement }) else { return }
        for top in bar.children where menuTitles.contains(top.title) {
            for menu in top.children {
                for item in menu.children where itemTitles.contains(item.title) {
                    item.perform(kAXPressAction)
                    return
                }
            }
        }
    }

    // MARK: row access

    private func scrollIntoView(scroll: AXUIElement, table: AXUIElement, index: Int) {
        let rows = table.children
        guard index < rows.count,
              !visibleRows(table).contains(where: { $0.attribute("AXIndex") as? Int == index }),
              let bar = scroll.children.first(where: { $0.role == "AXScrollBar" && $0.frame.height > $0.frame.width })
        else { return }
        let tableFrame = table.frame
        let maxOffset = tableFrame.height - scroll.frame.height
        let offset = rows[index].frame.minY - tableFrame.minY
        bar.set(kAXValueAttribute, (maxOffset > 0 ? min(1, max(0, offset / maxOffset)) : 0) as CFNumber)
        usleep(50_000)
    }

    func scrollBar(_ scroll: AXUIElement) -> AXUIElement? {
        scroll.children.first { $0.role == "AXScrollBar" && $0.frame.height > $0.frame.width }
    }

    /// Scrolls so `row` sits at the top (or bottom) edge of the viewport.
    private func park(scroll: AXUIElement, table: AXUIElement, bar: AXUIElement?, row: AXUIElement, atBottom: Bool) {
        guard let bar else { return }
        let tableFrame = table.frame
        let viewport = scroll.frame.height
        let maxOffset = tableFrame.height - viewport
        let rowFrame = row.frame
        let offset = atBottom ? rowFrame.maxY - tableFrame.minY - viewport : rowFrame.minY - tableFrame.minY
        let value = maxOffset > 0 ? min(1, max(0, offset / maxOffset)) : 0
        bar.set(kAXValueAttribute, value as CFNumber)
        usleep(30_000)
    }

    func visibleRows(_ table: AXUIElement) -> [AXUIElement] {
        table.attribute("AXVisibleRows") as? [AXUIElement] ?? []
    }

    /// Calls `visit` for each requested row, scrolling the table so rows are on screen
    /// when read — on-screen rows answer ~100x faster than off-screen ones.
    /// Return `true` from `visit` to stop early.
    func visitRows(scroll: AXUIElement, table: AXUIElement, indices: [Int], restore: Bool = true,
                   _ visit: (Int, AXUIElement) -> Bool) {
        var pending = Set(indices)
        let order = indices
        guard !pending.isEmpty else { return }

        func visitVisible() -> Bool {
            let visible = visibleRows(table).compactMap { row -> (Int, AXUIElement)? in
                guard let i = row.attribute("AXIndex") as? Int, pending.contains(i) else { return nil }
                return (i, row)
            }
            let rank = Dictionary(uniqueKeysWithValues: order.enumerated().map { ($1, $0) })
            for (i, row) in visible.sorted(by: { rank[$0.0, default: 0] < rank[$1.0, default: 0] }) {
                pending.remove(i)
                if visit(i, row) { return true }
            }
            return false
        }

        if visitVisible() || pending.isEmpty { return }

        let rows = table.children
        let bar = scrollBar(scroll)
        let original = bar?.number
        defer { if restore, let bar, let original { bar.set(kAXValueAttribute, original as CFNumber) } }
        // Walking upwards, park the next row at the bottom of the viewport instead of the top.
        let descending = (order.first ?? 0) > (order.last ?? 0)

        var attempts = 0
        while let next = order.first(where: { pending.contains($0) }), attempts < 400 {
            attempts += 1
            let before = pending.count
            if let bar, next < rows.count {
                park(scroll: scroll, table: table, bar: bar, row: rows[next], atBottom: descending)
                if visitVisible() { return }
            }
            if pending.count == before {
                // Could not scroll it into view; read it the slow way.
                pending.remove(next)
                if next < rows.count, visit(next, rows[next]) { return }
            }
        }
    }
}

/// Lets `coverNewWindow`'s thread know the open is over.
final class WindowWatch: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false
    var stopped: Bool { lock.lock(); defer { lock.unlock() }; return done }
    func stop() { lock.lock(); done = true; lock.unlock() }
}
