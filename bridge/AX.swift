import AppKit
import ApplicationServices

extension AXUIElement {
    func attribute(_ name: String) -> AnyObject? {
        var value: AnyObject?
        return AXUIElementCopyAttributeValue(self, name as CFString, &value) == .success ? value : nil
    }

    var children: [AXUIElement] { attribute(kAXChildrenAttribute) as? [AXUIElement] ?? [] }
    var role: String { attribute(kAXRoleAttribute) as? String ?? "" }
    var identifier: String { attribute(kAXIdentifierAttribute) as? String ?? "" }
    var title: String { attribute(kAXTitleAttribute) as? String ?? "" }
    var number: Double? { (attribute(kAXValueAttribute) as? NSNumber)?.doubleValue }
    var string: String? { attribute(kAXValueAttribute) as? String }

    var frame: CGRect {
        var origin = CGPoint.zero, size = CGSize.zero
        if let v = attribute(kAXPositionAttribute) { AXValueGetValue(v as! AXValue, .cgPoint, &origin) }
        if let v = attribute(kAXSizeAttribute) { AXValueGetValue(v as! AXValue, .cgSize, &size) }
        return CGRect(origin: origin, size: size)
    }

    @discardableResult
    func set(_ name: String, _ value: CFTypeRef) -> AXError {
        AXUIElementSetAttributeValue(self, name as CFString, value)
    }

    @discardableResult
    func perform(_ action: String) -> AXError {
        AXUIElementPerformAction(self, action as CFString)
    }

    func same(_ other: AXUIElement) -> Bool { CFEqual(self, other) }
}

/// A snapshot of one element fetched in a single round trip.
///
/// KakaoTalk answers every AX call on an off-screen table row slowly (~10ms each),
/// so reading all attributes at once matters far more than it usually would.
struct Node {
    let element: AXUIElement
    let role: String
    let identifier: String
    let title: String
    let desc: String
    let value: String?
    let frame: CGRect
    let children: [AXUIElement]

    private static let names = [
        kAXRoleAttribute, kAXIdentifierAttribute, kAXTitleAttribute, kAXDescriptionAttribute,
        kAXValueAttribute, kAXPositionAttribute, kAXSizeAttribute, kAXChildrenAttribute,
    ] as CFArray

    init(_ element: AXUIElement) {
        self.element = element
        var out: CFArray?
        AXUIElementCopyMultipleAttributeValues(element, Node.names, AXCopyMultipleAttributeOptions(rawValue: 0), &out)
        let values = (out as? [AnyObject]) ?? []
        func at(_ i: Int) -> AnyObject? {
            guard i < values.count else { return nil }
            let v = values[i]
            if CFGetTypeID(v) == CFNullGetTypeID() { return nil }
            if CFGetTypeID(v) == AXValueGetTypeID(), AXValueGetType(v as! AXValue) == .axError { return nil }
            return v
        }
        role = at(0) as? String ?? ""
        identifier = at(1) as? String ?? ""
        title = at(2) as? String ?? ""
        desc = at(3) as? String ?? ""
        if let s = at(4) as? String { value = s } else if let n = at(4) as? NSNumber { value = n.stringValue } else { value = nil }
        var origin = CGPoint.zero, size = CGSize.zero
        if let v = at(5), CFGetTypeID(v) == AXValueGetTypeID() { AXValueGetValue(v as! AXValue, .cgPoint, &origin) }
        if let v = at(6), CFGetTypeID(v) == AXValueGetTypeID() { AXValueGetValue(v as! AXValue, .cgSize, &size) }
        frame = CGRect(origin: origin, size: size)
        children = at(7) as? [AXUIElement] ?? []
    }

    var text: String { value ?? "" }
}

extension CGRect {
    var area: CGFloat { width * height }
}
