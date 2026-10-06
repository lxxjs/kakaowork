import AppKit
import ApplicationServices

/// Tracks the tail of one chat window so polling can report only new messages.
final class RoomWatch {
    let title: String
    var lastIndex = -1
    var lastSignature = ""
    var lastSender: String?
    var tail: [String] = []
    /// Rows between the oldest message the CLI holds and the newest one reported, so older
    /// history can be read from where it left off however the rows get renumbered.
    /// Nil once that can no longer be told (the CLI then reads the room again).
    var span: Int?
    /// Whether the typing bubble was at the end of the chat at the last poll.
    var typing = false

    init(title: String, messages: [Message]) {
        self.title = title
        record(messages)
        if let first = messages.first, let last = messages.last { span = last.row - first.row }
    }

    func record(_ messages: [Message]) {
        guard let last = messages.last else { return }
        lastIndex = last.row
        lastSignature = last.signature
        tail = Array((tail + messages.map(\.signature)).suffix(60))
        for m in messages {
            if m.mine || m.kind == "divider" || m.kind == "system" { lastSender = nil } else if let s = m.sender { lastSender = s }
        }
    }

    /// Index in `window` of the last row already reported, or -1 if none line up.
    static func alignment(tail: [String], window: [String]) -> Int {
        guard !tail.isEmpty else { return -1 }
        for j in stride(from: window.count - 1, through: 0, by: -1) {
            let length = min(j + 1, tail.count)
            if Array(window[(j + 1 - length)...j]) == Array(tail.suffix(length)) { return j }
        }
        return -1
    }
}

extension Kakao {
    /// New messages since the last poll, or nil if the chat window is gone.
    func poll(_ room: RoomWatch) throws -> [Message]? {
        guard let window = try chatWindow(title: room.title), let (scroll, table) = messageTable(in: window) else { return nil }
        let rows = table.children

        var lastIndex = -1
        var lastMessage: Message?
        var typing = false
        for i in stride(from: rows.count - 1, through: max(0, rows.count - 5), by: -1) {
            if let m = Parse.messageRow(rows[i], index: i) { lastIndex = i; lastMessage = m; break }
            if Parse.isTypingRow(rows[i]) { typing = true }
        }
        room.typing = typing
        guard let lastMessage else { return [] }
        if lastIndex == room.lastIndex && lastMessage.signature == room.lastSignature { return [] }

        let viewport = scroll.frame
        func parse(_ i: Int) -> Message? { parseWithImage(rows[i], index: i, window: window, viewport: viewport) }

        var fresh: [Message] = []
        let appended = room.lastIndex >= 0 && lastIndex > room.lastIndex && room.lastIndex < rows.count
            && Parse.messageRow(rows[room.lastIndex], index: room.lastIndex)?.signature == room.lastSignature
        if appended {
            for i in (room.lastIndex + 1)...lastIndex {
                if let m = parse(i) { fresh.append(m) }
            }
            room.span = room.span.map { $0 + lastIndex - room.lastIndex }
        } else {
            // Rows shifted (older history loaded, a message deleted, …): line up by content.
            var parsed: [Int: Message] = [:]
            visitRows(scroll: scroll, table: table, indices: Array(max(0, lastIndex - 24)...lastIndex)) { index, row in
                if let m = parseWithImage(row, index: index, window: window, viewport: viewport) { parsed[index] = m }
                return false
            }
            let window = parsed.keys.sorted().compactMap { parsed[$0] }
            let known = RoomWatch.alignment(tail: room.tail, window: window.map(\.signature))
            fresh = Array(window[(known + 1)...])
            room.span = known >= 0 ? room.span.map { $0 + lastIndex - window[known].row } : nil
        }
        Kakao.fillSenders(&fresh, carry: room.lastSender)
        Kakao.fillDividerDates(&fresh)
        room.record(fresh)
        room.lastIndex = lastIndex
        room.lastSignature = lastMessage.signature
        return fresh
    }

    /// The `count` rows before the oldest one the CLI holds, loading more of the conversation
    /// into KakaoTalk's window if need be. `shift` is how far that moved the rows already read.
    func older(_ room: RoomWatch, count: Int) throws -> (messages: [Message], rowCount: Int, shift: Int, exhausted: Bool) {
        guard let window = try chatWindow(title: room.title), let (scroll, table) = messageTable(in: window) else {
            throw BridgeError("no_window", "'\(room.title)' 채팅창이 열려 있지 않습니다")
        }
        guard let span = room.span, room.lastIndex >= span else {
            throw BridgeError("resync", "이전 메시지의 위치를 알 수 없습니다")
        }
        var oldest = room.lastIndex - span
        // Row 0 is where KakaoTalk's loaded history starts, so ask for enough rows to cover the request.
        let shift = oldest < count ? loadHistory(scroll: scroll, table: table, rows: table.children.count + count - oldest) : 0
        oldest += shift
        room.lastIndex += shift
        // Everything below counts on the newest reported row being where the sums say it is.
        func inPlace() -> Bool {
            let rows = table.children
            return room.lastIndex < rows.count && Parse.messageRow(rows[room.lastIndex], index: room.lastIndex)?.signature == room.lastSignature
        }
        guard inPlace() else {
            room.span = nil
            throw BridgeError("resync", "이전 메시지의 위치를 알 수 없습니다")
        }

        let start = max(0, oldest - count)
        var list = read(window: window, scroll: scroll, table: table, indices: Array(start..<oldest))
        complete(&list, scroll: scroll, table: table)
        guard inPlace() else {
            room.span = nil
            throw BridgeError("resync", "읽는 동안 메시지 목록이 바뀌었습니다")
        }
        // A separator closing the run is dated by a message the CLI already has.
        if let last = list.indices.last, list[last].kind == "divider", list[last].date == nil {
            let rows = table.children
            for index in oldest..<min(rows.count, oldest + 20) {
                guard let m = Parse.messageRow(rows[index], index: index), m.kind != "divider" else { break }
                if let date = m.date { list[last].date = date; break }
            }
        }
        room.span = room.lastIndex - start
        return (list, table.children.count, shift, start == 0 && oldest < count)
    }
}
