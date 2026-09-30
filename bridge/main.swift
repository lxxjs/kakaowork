import AppKit
import ApplicationServices

// JSON-lines server over stdio.
//   request:  {"id": 1, "cmd": "chats", "limit": 30}
//   response: {"id": 1, "ok": true, "result": {...}}  |  {"id": 1, "ok": false, "error": {...}}
//   event:    {"event": "messages", ...}
// One-shot mode for debugging: kakao-bridge chats '{"limit": 5}'

func nullable(_ value: Any?) -> Any { value ?? NSNull() }

final class Output {
    private let lock = NSLock()

    func send(_ object: [String: Any]) {
        guard var data = try? JSONSerialization.data(withJSONObject: object, options: [.withoutEscapingSlashes]) else { return }
        data.append(0x0A)
        lock.lock()
        FileHandle.standardOutput.write(data)
        lock.unlock()
    }
}

final class Server {
    private let queue = DispatchQueue(label: "kakaowork.bridge")
    private let kakao = Kakao()
    private let out = Output()
    private var room: RoomWatch?
    private var watchChats = false
    private var chatSignature = ""
    private var unreadTotal: Int?
    private var wasRunning = true
    private var timer: DispatchSourceTimer?
    private var tick = 0

    func receive(_ line: String) {
        guard let data = line.data(using: .utf8),
              let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        let id = request["id"] ?? NSNull()
        queue.async {
            do {
                let result = try self.handle(request)
                self.out.send(["id": id, "ok": true, "result": result])
            } catch let error as BridgeError {
                self.out.send(["id": id, "ok": false, "error": ["code": error.code, "message": error.message]])
            } catch {
                self.out.send(["id": id, "ok": false, "error": ["code": "internal", "message": "\(error)"]])
            }
        }
    }

    func runOnce(_ request: [String: Any]) -> Int32 {
        var status: Int32 = 0
        queue.sync {
            do {
                out.send(["ok": true, "result": try handle(request)])
            } catch let error as BridgeError {
                out.send(["ok": false, "error": ["code": error.code, "message": error.message]]); status = 1
            } catch {
                out.send(["ok": false, "error": ["code": "internal", "message": "\(error)"]]); status = 1
            }
        }
        return status
    }

    private func handle(_ req: [String: Any]) throws -> Any {
        let cmd = req["cmd"] as? String ?? ""
        switch cmd {
        case "status":
            return status(prompt: req["prompt"] as? Bool ?? false)

        case "chats":
            let rooms = try kakao.chats(limit: req["limit"] as? Int ?? 30)
            return ["rooms": rooms.map(\.json), "totalUnread": nullable(kakao.totalUnread())]

        case "open":
            guard let name = req["name"] as? String else { throw BridgeError("bad_request", "name 이 필요합니다") }
            return try kakao.open(name: name, hint: req["index"] as? Int)

        case "messages":
            guard let title = req["title"] as? String else { throw BridgeError("bad_request", "title 이 필요합니다") }
            let (messages, rowCount) = try kakao.messages(title: title, limit: req["limit"] as? Int ?? 40)
            if req["watch"] as? Bool == true {
                room = RoomWatch(title: title, messages: messages)
                startTimer()
            }
            return ["messages": messages.map(\.json), "rowCount": rowCount]

        case "send":
            guard let title = req["title"] as? String, let text = req["text"] as? String, !text.isEmpty else {
                throw BridgeError("bad_request", "title, text 가 필요합니다")
            }
            try kakao.send(title: title, text: text)
            return ["sent": true]

        case "watch":
            if let chats = req["chats"] as? Bool { watchChats = chats; chatSignature = "" }
            if req.keys.contains("title"), req["title"] is NSNull { room = nil }
            startTimer()
            return ["watching": ["chats": watchChats, "title": nullable(room?.title)]]

        case "close":
            guard let title = req["title"] as? String else { throw BridgeError("bad_request", "title 이 필요합니다") }
            if room?.title == title { room = nil }
            try kakao.close(title: title)
            return ["closed": true]

        case "hide", "show":
            try kakao.setHidden(cmd == "hide")
            return ["hidden": cmd == "hide"]

        default:
            throw BridgeError("bad_request", "알 수 없는 명령: \(cmd)")
        }
    }

    private func status(prompt: Bool) -> [String: Any] {
        let trusted = prompt
            ? AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
            : AXIsProcessTrusted()
        let app = kakao.app
        var result: [String: Any] = ["trusted": trusted, "running": app != nil, "hidden": app?.isHidden ?? false]
        if let url = app?.bundleURL, let version = Bundle(url: url)?.infoDictionary?["CFBundleShortVersionString"] {
            result["version"] = version
        }
        if trusted && app != nil {
            result["me"] = nullable((try? kakao.myName()) ?? nil)
            result["totalUnread"] = nullable(kakao.totalUnread())
            result["openChats"] = (try? kakao.openChatTitles()) ?? []
        }
        return result
    }

    // MARK: polling

    private func startTimer() {
        guard timer == nil else { return }
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + .milliseconds(700), repeating: .milliseconds(700), leeway: .milliseconds(100))
        t.setEventHandler { [weak self] in self?.poll() }
        t.resume()
        timer = t
    }

    private func poll() {
        tick += 1
        let running = kakao.app != nil
        if running != wasRunning {
            wasRunning = running
            out.send(["event": "app", "running": running])
        }
        guard running else { return }

        if let room {
            do {
                if let fresh = try kakao.poll(room) {
                    if !fresh.isEmpty { out.send(["event": "messages", "title": room.title, "messages": fresh.map(\.json)]) }
                } else {
                    self.room = nil
                    out.send(["event": "closed", "title": room.title])
                }
            } catch {}
        }

        if watchChats && tick % 2 == 0, let rooms = try? kakao.visibleChats() {
            let total = kakao.totalUnread()
            let signature = rooms.map { "\($0.name)|\($0.unread)|\($0.time)|\($0.preview)" }.joined(separator: "\n") + "#\(total ?? -1)"
            if signature != chatSignature {
                chatSignature = signature
                out.send(["event": "chats", "rooms": rooms.map(\.json), "totalUnread": nullable(total)])
            }
        }
    }
}

setvbuf(stdout, nil, _IONBF, 0)
let server = Server()
let args = CommandLine.arguments

if args.count > 1 {
    var request: [String: Any] = ["cmd": args[1]]
    if args.count > 2, let data = args[2].data(using: .utf8),
       let extra = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
        request.merge(extra) { _, new in new }
    }
    exit(server.runOnce(request))
}

Thread {
    while let line = readLine(strippingNewline: true) {
        if !line.isEmpty { server.receive(line) }
    }
    exit(0)  // parent closed stdin
}.start()

RunLoop.main.run()
