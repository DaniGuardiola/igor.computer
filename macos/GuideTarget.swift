import AppKit
import ApplicationServices

// Read only with existing trust; never request Accessibility for this decoration.
enum GuideTarget {
    static func find(kind: String, step: NotificationGuideStep = .allow) -> CGRect? {
        guard AXIsProcessTrusted(),
              let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.systempreferences").first else { return nil }
        let root = AXUIElementCreateApplication(app.processIdentifier)
        let windows = attribute(root, kAXWindowsAttribute) as? [AXUIElement] ?? []
        // The same toggle identifier occurs on every app's notification page.
        // Match our page before pointing to a control.
        let matchingWindows = kind == "notifications" ? windows.filter { string($0, kAXTitleAttribute).lowercased() == "igor.computer" } : windows
        guard !matchingWindows.isEmpty else { return nil }
        var queue = matchingWindows
        var index = 0
        let deadline = Date().addingTimeInterval(0.75)
        while index < queue.count && index < 600 && Date() < deadline {
            let element = queue[index]; index += 1
            AXUIElementSetMessagingTimeout(element, 0.03)
            let identifier = string(element, kAXIdentifierAttribute)
            let role = string(element, kAXRoleAttribute)
            if role == "AXCheckBox" || role == "AXSwitch" || role == "AXRadioButton" {
                let description = string(element, kAXDescriptionAttribute).lowercased()
                let title = string(element, kAXTitleAttribute).lowercased()
                let notificationMatch: Bool
                switch step {
                case .persistent: notificationMatch = role == "AXRadioButton" && description == "persistent"
                case .desktop: notificationMatch = identifier == step.targetIdentifier || identifier == "notification-presence-desktop"
                default: notificationMatch = identifier == step.targetIdentifier
                }
                let matched = kind == "notifications" ? notificationMatch :
                    (identifier.contains("ai.igor.computer") || description.contains("igor.computer") || title.contains("igor.computer"))
                if matched, let frame = frame(element) { return frame }
            }
            if let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] { queue.append(contentsOf: children) }
        }
        return nil
    }

    private static func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
    }
    private static func string(_ element: AXUIElement, _ name: String) -> String { attribute(element, name) as? String ?? "" }
    private static func frame(_ element: AXUIElement) -> CGRect? {
        guard let position = attribute(element, kAXPositionAttribute), CFGetTypeID(position) == AXValueGetTypeID(),
              let sizeValue = attribute(element, kAXSizeAttribute), CFGetTypeID(sizeValue) == AXValueGetTypeID() else { return nil }
        var point = CGPoint.zero
        var size = CGSize.zero
        guard AXValueGetValue(position as! AXValue, .cgPoint, &point), AXValueGetValue(sizeValue as! AXValue, .cgSize, &size), size.width > 0, size.height > 0 else { return nil }
        return CGRect(origin: point, size: size)
    }

    static func appKitFrame(_ global: CGRect) -> CGRect? {
        let screens = NSScreen.screens.compactMap { screen -> (NSScreen, CGRect)? in
            guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else { return nil }
            return (screen, CGDisplayBounds(CGDirectDisplayID(number.uint32Value)))
        }
        guard let match = screens.max(by: { $0.1.intersection(global).width * $0.1.intersection(global).height < $1.1.intersection(global).width * $1.1.intersection(global).height }) else { return nil }
        return CGRect(x: match.0.frame.minX + global.minX - match.1.minX,
                      y: match.0.frame.maxY - (global.minY - match.1.minY) - global.height,
                      width: global.width, height: global.height)
    }
}
