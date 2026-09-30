import AppKit
import ApplicationServices

/// Tracks the tail of one chat window so polling can report only new messages.
final class RoomWatch {
    let title: String
    var lastIndex = -1
    var lastSignature = ""
    var lastSender: String?
    var tail: [String] = []

    init(title: String, messages: [Message]) {
        self.title = title
        record(messages)
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
        for i in stride(from: rows.count - 1, through: max(0, rows.count - 4), by: -1) {
            if let m = Parse.messageRow(rows[i], index: i) { lastIndex = i; lastMessage = m; break }
        }
        guard let lastMessage else { return [] }
        if lastIndex == room.lastIndex && lastMessage.signature == room.lastSignature { return [] }

        var fresh: [Message] = []
        let appended = room.lastIndex >= 0 && lastIndex > room.lastIndex && room.lastIndex < rows.count
            && Parse.messageRow(rows[room.lastIndex], index: room.lastIndex)?.signature == room.lastSignature
        if appended {
            for i in (room.lastIndex + 1)...lastIndex {
                if let m = i == lastIndex ? lastMessage : Parse.messageRow(rows[i], index: i) { fresh.append(m) }
            }
        } else {
            // Rows shifted (older history loaded, a message deleted, …): line up by content.
            var parsed: [Int: Message] = [:]
            visitRows(scroll: scroll, table: table, indices: Array(max(0, lastIndex - 24)...lastIndex)) { index, row in
                if let m = Parse.messageRow(row, index: index) { parsed[index] = m }
                return false
            }
            let window = parsed.keys.sorted().compactMap { parsed[$0] }
            let known = RoomWatch.alignment(tail: room.tail, window: window.map(\.signature))
            fresh = Array(window[(known + 1)...])
        }
        Kakao.fillSenders(&fresh, carry: room.lastSender)
        Kakao.fillDividerDates(&fresh)
        room.record(fresh)
        room.lastIndex = lastIndex
        room.lastSignature = lastMessage.signature
        return fresh
    }
}
