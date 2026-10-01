import AppKit
import ServiceManagement

@MainActor
final class SettingsGuide: NSObject, NSWindowDelegate {
    let panel: NSPanel
    let tracker = SettingsWindowTracker()
    let isComplete: () -> Bool
    let onComplete: () -> Void
    var deadline = Date().addingTimeInterval(300)

    init(kind: String, isComplete: @escaping () -> Bool, onComplete: @escaping () -> Void) {
        self.isComplete = isComplete
        self.onComplete = onComplete
        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 410, height: 155), styleMask: [.titled, .closable, .nonactivatingPanel], backing: .buffered, defer: false)
        super.init()
        panel.title = "Igor Browser"
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
        panel.delegate = self
        let title = NSTextField(labelWithString: kind == "login" ? "Allow Igor Browser at login" : "Allow requests for human help")
        title.font = .systemFont(ofSize: 15, weight: .semibold)
        let detail = NSTextField(wrappingLabelWithString: kind == "login" ? "Find Igor Browser under Open at Login or Allow in the Background, then turn it on. This helper closes when startup is enabled." : "Choose Igor Browser, turn on Allow Notifications, and choose Banners or Alerts. This helper closes when alerts are enabled.")
        detail.textColor = .secondaryLabelColor
        let stack = NSStackView(views: [title, detail]); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        panel.contentView?.addSubview(stack)
        if let view = panel.contentView {
            NSLayoutConstraint.activate([stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 16), stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 18), stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -18), stack.bottomAnchor.constraint(lessThanOrEqualTo: view.bottomAnchor, constant: -14)])
        }
        panel.center()
        tracker.onFrameChange = { [weak self] frame in self?.attach(to: frame) }
        tracker.onTrackingEnded = { [weak self] in self?.close() }
        tracker.startTracking(promptIfNeeded: false)
        panel.orderFrontRegardless()
    }

    func attach(to frame: CGRect) {
        guard let screen = NSScreen.screens.max(by: { $0.frame.intersection(frame).width * $0.frame.intersection(frame).height < $1.frame.intersection(frame).width * $1.frame.intersection(frame).height }) else { return }
        let visible = screen.visibleFrame
        var point = NSPoint(x: frame.maxX - panel.frame.width, y: frame.minY - panel.frame.height - 8)
        if point.y < visible.minY { point.y = min(visible.maxY - panel.frame.height, frame.maxY - panel.frame.height); point.x = frame.maxX + 8 }
        point.x = max(visible.minX, min(point.x, visible.maxX - panel.frame.width))
        point.y = max(visible.minY, min(point.y, visible.maxY - panel.frame.height))
        panel.setFrameOrigin(point)
        let front = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        if front == "com.apple.systempreferences" || front == Bundle.main.bundleIdentifier { panel.orderFrontRegardless() }
        else { panel.orderOut(nil) }
    }

    func refresh() {
        if isComplete() { close(); onComplete() }
        else if Date() > deadline { close() }
    }
    func close() { tracker.stopTracking(); panel.orderOut(nil); deadline = .distantPast }
    func windowShouldClose(_ sender: NSWindow) -> Bool { close(); return false }
}

extension AppDelegate {
    @MainActor func openSettingsGuide(_ kind: String) {
        settingsGuide?.close()
        setupWindow?.orderOut(nil)
        if kind == "login" { SMAppService.openSystemSettingsLoginItems() }
        else { NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension")!) }
        settingsGuide = SettingsGuide(kind: kind, isComplete: { [weak self] in
            kind == "login" ? SMAppService.mainApp.status == .enabled : self?.notificationReady == true
        }, onComplete: { [weak self] in
            self?.settingsGuide = nil
            self?.refreshSetup()
            // Return to setup only while another step remains unfinished.
            if self?.setupComplete == false { self?.showSetup() }
        })
    }
}
