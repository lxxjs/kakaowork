import AppKit
import ApplicationServices

struct ChatRoom {
    let index: Int
    var name = ""
    var members: Int?
    var time = ""
    var preview = ""
    var unread = 0
    var muted = false
    var kind = "direct"  // direct | group | me | open

    var json: [String: Any] {
        var d: [String: Any] = [
            "index": index, "name": name, "time": time, "preview": preview,
            "unread": unread, "muted": muted, "kind": kind,
        ]
        if let members { d["members"] = members }
        return d
    }
}

struct Message {
    let row: Int
    var kind = "text"  // text | photo | emoticon | file | system | divider
    var mine = false
    var sender: String?
    var hasProfile = false
    var text = ""
    var detail: String?
    var time: String?
    var unread: Int?

    /// Identity used to line up re-read rows with ones already reported.
    /// Time and unread counts are left out because KakaoTalk moves the time label
    /// to the newest message of a minute and clears the "1" once read.
    var signature: String { "\(kind)|\(mine ? 1 : 0)|\(text)" }

    var json: [String: Any] {
        var d: [String: Any] = ["row": row, "kind": kind, "mine": mine, "text": text]
        if let sender { d["sender"] = sender }
        if let detail { d["detail"] = detail }
        if let time { d["time"] = time }
        if let unread { d["unread"] = unread }
        return d
    }
}

enum Parse {
    private static let timePattern = try! NSRegularExpression(
        pattern: #"^((오전|오후) ?\d{1,2}:\d{2}|\d{1,2}:\d{2}( ?[AaPp][Mm])?)$"#)
    private static let countPattern = try! NSRegularExpression(pattern: #"^\d+\+?$"#)
    private static let fileActions: Set<String> = ["저장", "열기", "Finder에서 보기", "다른 이름으로 저장", "Save", "Open", "Show in Finder", "Save As"]
    private static let profileLabels: Set<String> = ["프로필", "Profile"]

    static func isTime(_ s: String) -> Bool { matches(timePattern, s) }
    static func isCount(_ s: String) -> Bool { matches(countPattern, s) }
    static func count(_ s: String) -> Int { Int(s.filter(\.isNumber)) ?? 0 }

    private static func matches(_ re: NSRegularExpression, _ s: String) -> Bool {
        re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
    }

    // MARK: chat list

    static func chatRow(_ row: AXUIElement, index: Int) -> ChatRoom? {
        guard let cellElement = row.children.first else { return nil }
        let cell = Node(cellElement)
        var room = ChatRoom(index: index)
        var top: [Node] = []
        var hasMembers = false
        for kid in cell.children.map(Node.init) {
            switch kid.role {
            case "AXStaticText":
                let v = kid.text
                if kid.identifier == "Count Label" {
                    room.members = count(v); hasMembers = true
                } else if kid.identifier == "_NS:40" {
                    room.name = v
                } else if kid.identifier == "_NS:69" {
                    room.time = v
                } else if kid.frame.midY > cell.frame.midY, isCount(v) {
                    room.unread = count(v)
                } else {
                    top.append(kid)
                }
            case "AXImage":
                switch kid.desc {
                case "badge me": room.kind = "me"
                case "badge openchat room": room.kind = "open"
                default: if kid.desc.contains("notioff") { room.muted = true }
                }
            case "AXScrollArea":
                if let area = kid.children.first { room.preview = Node(area).text }
            case "AXTextArea":
                room.preview = kid.text
            default:
                break
            }
        }
        // Fall back to layout when KakaoTalk renames its auto-generated identifiers.
        let byX = top.sorted { $0.frame.minX < $1.frame.minX }
        if room.name.isEmpty, let first = byX.first { room.name = first.text }
        if room.time.isEmpty, byX.count > 1, let last = byX.last { room.time = last.text }
        if room.kind == "direct" && hasMembers { room.kind = "group" }
        room.preview = room.preview.replacingOccurrences(of: "\n", with: " ")
        return room.name.isEmpty ? nil : room
    }

    // MARK: messages

    static func messageRow(_ row: AXUIElement, index: Int) -> Message? {
        guard let cellElement = row.children.first else { return nil }
        let cell = Node(cellElement)
        if cell.children.isEmpty { return nil }  // trailing spacer row
        let kids = cell.children.map(Node.init)

        var msg = Message(row: index)
        var statics: [Node] = [], areas: [Node] = [], images: [Node] = [], buttons: [Node] = []
        for kid in kids {
            switch kid.role {
            case "AXButton":
                if profileLabels.contains(kid.desc) { msg.hasProfile = true } else { buttons.append(kid) }
            case "AXStaticText":
                let v = kid.text
                if isTime(v) {
                    msg.time = v
                } else if isCount(v) && kid.frame.width < 30 {
                    msg.unread = count(v)
                } else {
                    statics.append(kid)
                }
            case "AXTextArea":
                areas.append(kid)
            case "AXImage":
                images.append(kid)
            case "AXScrollArea", "AXGroup":
                areas.append(contentsOf: kid.children.map(Node.init).filter { $0.role == "AXTextArea" })
            default:
                break
            }
        }

        if msg.hasProfile, let name = statics.min(by: { $0.frame.minY < $1.frame.minY }) {
            msg.sender = name.text
            statics.removeAll { $0.element.same(name.element) }
        }

        let fileButtons = buttons.filter { fileActions.contains($0.desc) }
        let primary: Node?
        if !areas.isEmpty {
            msg.kind = "text"
            msg.text = areas.map(\.text).joined(separator: "\n")
            primary = areas.first
        } else if !fileButtons.isEmpty || statics.count >= 2 {
            msg.kind = "file"
            msg.text = statics.first?.text ?? "파일"
            let rest = statics.dropFirst().map(\.text).filter { !$0.isEmpty }
            msg.detail = rest.isEmpty ? nil : rest.joined(separator: " · ")
            primary = statics.first
        } else if let image = images.max(by: { $0.frame.area < $1.frame.area }) {
            let shared = buttons.contains { $0.desc == "공유" || $0.desc == "Share" }
            msg.kind = shared || image.frame.width > 150 ? "photo" : "emoticon"
            msg.text = msg.kind == "photo" ? "사진" : "이모티콘"
            primary = image
        } else if !statics.isEmpty {
            msg.kind = "system"
            msg.text = statics.map(\.text).joined(separator: " ")
            primary = nil
        } else if !buttons.isEmpty {
            // Date separators are text-less buttons; KakaoTalk exposes no label for them.
            msg.kind = "divider"
            msg.text = buttons.first?.title ?? ""
            primary = nil
        } else {
            return nil
        }

        if let primary, !msg.hasProfile {
            // My bubbles hug the right edge, everyone else's the left.
            let leftGap = primary.frame.minX - cell.frame.minX
            let rightGap = cell.frame.maxX - primary.frame.maxX
            msg.mine = rightGap < leftGap
        }
        return msg
    }
}
