import AppKit
import CoreGraphics

// A menu-bar app is not reliably chosen by macOS when System Settings closes.
// Return only from the Settings window the user opened, not from unrelated work.
struct SettingsReturnState {
    var sawWindow = false
    var settingsWasForeground = false

    mutating func observe(hasWindow: Bool, settingsIsForeground: Bool) -> Bool? {
        if hasWindow {
            sawWindow = true
            settingsWasForeground = settingsIsForeground
            return nil
        }
        guard sawWindow else { return nil }
        return settingsWasForeground
    }
}

final class SettingsReturnObserver {
    private var timer: Timer?
    private var state = SettingsReturnState()
    private let started = Date()
    private let onReturn: () -> Void

    init(onReturn: @escaping () -> Void) {
        self.onReturn = onReturn
        timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in self?.observe() }
        timer?.tolerance = 0.05
    }

    func stop() { timer?.invalidate(); timer = nil }
    deinit { stop() }

    private func observe() {
        if !state.sawWindow && Date().timeIntervalSince(started) > 30 { stop(); return }
        let settings = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.systempreferences")
        let pids = Set(settings.map { $0.processIdentifier })
        // All spaces: changing desktops must not look like closing Settings.
        guard let windows = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return }
        let hasWindow = windows.contains { window in
            guard let pid = window[kCGWindowOwnerPID as String] as? Int32, pids.contains(pid),
                  (window[kCGWindowLayer as String] as? Int) == 0,
                  let bounds = window[kCGWindowBounds as String] as? NSDictionary,
                  let frame = CGRect(dictionaryRepresentation: bounds) else { return false }
            return frame.width > 320 && frame.height > 240
        }
        let isForeground = NSWorkspace.shared.frontmostApplication?.bundleIdentifier == "com.apple.systempreferences"
        if let shouldReturn = state.observe(hasWindow: hasWindow, settingsIsForeground: isForeground) {
            stop()
            if shouldReturn { onReturn() }
        }
    }
}
