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

    private var cached: (pid: pid_t, element: AXUIElement)?

    var app: NSRunningApplication? {
        NSRunningApplication.runningApplications(withBundleIdentifier: Self.bundleID).first
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

    func mainWindow() throws -> AXUIElement {
        func find() throws -> AXUIElement? { try windows().first { $0.identifier == "Main Window" } }
        if let w = try find() { return w }

        // The main window was closed. "창 > 채팅" (⌘2) reopens it while KakaoTalk is active;
        // the menu bar icon's "카카오톡 열기" also works when it is not.
        let previous = NSWorkspace.shared.frontmostApplication
        defer { restoreFront(previous) }
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

    private func restoreFront(_ previous: NSRunningApplication?) {
        guard let previous, let kakao = app, previous.processIdentifier != kakao.processIdentifier,
              kakao.isActive else { return }
        let front = AXUIElementCreateApplication(previous.processIdentifier)
        if front.set(kAXFrontmostAttribute, kCFBooleanTrue) != .success { previous.activate() }
    }

    /// The chat list table in the main window, switching to the chats tab if needed.
    func chatList() throws -> (scroll: AXUIElement, table: AXUIElement) {
        if let found = try findChatList(in: mainWindow()) { return found }
        try pressMenu(["창", "Window"], item: ["채팅", "Chats"])
        usleep(300_000)
        if let found = try findChatList(in: mainWindow()) { return found }
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

    func totalUnread() -> Int? {
        guard let main = try? mainWindow() else { return nil }
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
        let (_, table) = try chatList()
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

    private func inputArea(in window: AXUIElement) -> AXUIElement? {
        for scroll in window.children where scroll.role == "AXScrollArea" {
            if let area = scroll.children.first(where: { $0.role == "AXTextArea" }) { return area }
        }
        return nil
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
        guard let kakao = self.app else { throw BridgeError("not_running", "카카오톡이 실행 중이 아닙니다") }
        let (scroll, table) = try chatList()
        guard let index = findRow(named: name, hint: hint, scroll: scroll, table: table) else {
            throw BridgeError("not_found", "'\(name)' 채팅방을 찾을 수 없습니다")
        }

        let previous = NSWorkspace.shared.frontmostApplication
        let wasHidden = kakao.isHidden
        defer {
            if let previous, previous.processIdentifier != kakao.processIdentifier {
                let front = AXUIElementCreateApplication(previous.processIdentifier)
                if front.set(kAXFrontmostAttribute, kCFBooleanTrue) != .success { previous.activate() }
            }
            if wasHidden { app.set(kAXHiddenAttribute, kCFBooleanTrue) }
        }

        // Opening a room needs a real Return keypress in the chat list, so KakaoTalk has to
        // be frontmost with the list focused. Focus is verified before the key is sent so a
        // stray Return can never land in some chat's input field.
        let main = try mainWindow()
        app.set(kAXFrontmostAttribute, kCFBooleanTrue)
        main.perform(kAXRaiseAction)
        main.set(kAXMainAttribute, kCFBooleanTrue)
        table.set(kAXFocusedAttribute, kCFBooleanTrue)
        usleep(150_000)

        scrollIntoView(scroll: scroll, table: table, index: index)
        let rows = table.children
        guard index < rows.count, Parse.chatRow(rows[index], index: index)?.name == name else {
            throw BridgeError("not_found", "채팅 목록이 바뀌었습니다. 다시 시도해 주세요")
        }
        let row = rows[index]
        row.set(kAXSelectedAttribute, kCFBooleanTrue)
        table.set(kAXSelectedRowsAttribute, [row] as CFArray)
        usleep(80_000)

        let focusedWindow = app.attribute(kAXFocusedWindowAttribute).map { $0 as! AXUIElement }
        let focused = app.attribute(kAXFocusedUIElementAttribute).map { $0 as! AXUIElement }
        let selected = (table.attribute(kAXSelectedRowsAttribute) as? [AXUIElement]) ?? []
        guard focusedWindow?.same(main) == true,
              focused.map({ $0.same(table) || $0.role == "AXTable" }) == true,
              selected.contains(where: { $0.same(row) })
        else {
            throw BridgeError("focus_failed", "카카오톡 채팅 목록에 포커스를 줄 수 없습니다")
        }

        let source = CGEventSource(stateID: .privateState)
        CGEvent(keyboardEventSource: source, virtualKey: Self.returnKey, keyDown: true)?.postToPid(kakao.processIdentifier)
        CGEvent(keyboardEventSource: source, virtualKey: Self.returnKey, keyDown: false)?.postToPid(kakao.processIdentifier)

        for _ in 0..<40 {
            usleep(100_000)
            if try chatWindow(title: name) != nil { return ["title": name, "alreadyOpen": false] }
        }
        throw BridgeError("open_timeout", "'\(name)' 채팅창이 열리지 않았습니다")
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
        button.perform(kAXPressAction)
    }

    // MARK: messages

    func messages(title: String, limit: Int) throws -> (messages: [Message], rowCount: Int) {
        let window = try requireWindow(title)
        guard let (scroll, table) = messageTable(in: window) else {
            throw BridgeError("no_window", "메시지 목록을 찾을 수 없습니다")
        }
        let rows = table.children
        let start = max(0, rows.count - limit - 1)
        var parsed: [Int: Message] = [:]
        visitRows(scroll: scroll, table: table, indices: Array(start..<rows.count)) { index, row in
            if let m = Parse.messageRow(row, index: index) { parsed[index] = m }
            return false
        }
        var list = parsed.keys.sorted().compactMap { parsed[$0] }
        if list.count > limit { list = Array(list.suffix(limit)) }

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
        return (list, rows.count)
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

        guard input.set(kAXValueAttribute, text as CFString) == .success else {
            throw BridgeError("send_failed", "입력창에 메시지를 넣지 못했습니다")
        }
        // The send button only enables once KakaoTalk has processed the text change (~50–150ms).
        var enabled = false
        for _ in 0..<30 {
            usleep(50_000)
            if send.attribute(kAXEnabledAttribute) as? Bool == true { enabled = true; break }
        }
        guard enabled else {
            input.set(kAXValueAttribute, "" as CFString)
            throw BridgeError("send_failed", "전송 버튼이 활성화되지 않았습니다")
        }
        // KakaoTalk reports failure for AXPress even when it sends, so check the input instead.
        send.perform(kAXPressAction)
        for _ in 0..<40 {
            usleep(50_000)
            if (input.string ?? "").isEmpty { return }
        }
        input.set(kAXValueAttribute, "" as CFString)
        throw BridgeError("send_failed", "전송되지 않았습니다")
    }

    // MARK: app visibility

    func setHidden(_ hidden: Bool) throws {
        let app = try axApp()
        app.set(kAXHiddenAttribute, hidden ? kCFBooleanTrue : kCFBooleanFalse)
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
        let bar = scroll.children.first { $0.role == "AXScrollBar" && $0.frame.height > $0.frame.width }
        let original = bar?.number
        defer { if restore, let bar, let original { bar.set(kAXValueAttribute, original as CFNumber) } }
        // Walking upwards, park the next row at the bottom of the viewport instead of the top.
        let descending = (order.first ?? 0) > (order.last ?? 0)

        var attempts = 0
        while let next = order.first(where: { pending.contains($0) }), attempts < 400 {
            attempts += 1
            let before = pending.count
            if let bar, next < rows.count {
                let tableFrame = table.frame
                let viewport = scroll.frame.height
                let maxOffset = tableFrame.height - viewport
                let rowFrame = rows[next].frame
                let offset = descending ? rowFrame.maxY - tableFrame.minY - viewport : rowFrame.minY - tableFrame.minY
                let value = maxOffset > 0 ? min(1, max(0, offset / maxOffset)) : 0
                bar.set(kAXValueAttribute, value as CFNumber)
                usleep(30_000)
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
