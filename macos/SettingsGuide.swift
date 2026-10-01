import AppKit
import ServiceManagement
import SwiftUI

@MainActor
final class SettingsGuide: NSObject, NSWindowDelegate {
    let panel: NSPanel
    let tracker = SettingsWindowTracker()
    let isComplete: () -> Bool
    let notificationStep: () -> NotificationGuideStep
    let onComplete: () -> Void
    var deadline = Date().addingTimeInterval(300)
    let appearance = GuideAppearance()
    let kind: String
    var target: CGRect?
    var lastWindowFrame: CGRect?
    var targetCheckRunning = false
    var lastTargetCheck = Date.distantPast
    var timer: Timer?
    var closed = false

    init(kind: String, notificationStep: @escaping () -> NotificationGuideStep = { .allow }, isComplete: @escaping () -> Bool, onComplete: @escaping () -> Void) {
        self.kind = kind
        self.notificationStep = notificationStep
        self.isComplete = isComplete
        self.onComplete = onComplete
        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 330, height: 132), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        super.init()
        panel.title = "igor browser"
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
        panel.delegate = self
        panel.contentView = NSHostingView(rootView: GuideView(kind: kind, appearance: appearance, dismiss: { [weak self] in self?.close() }))
        panel.center()
        tracker.onFrameChange = { [weak self] frame in self?.attach(to: frame) }
        tracker.onTrackingEnded = { [weak self] in self?.close() }
        tracker.startTracking(promptIfNeeded: false)
        panel.orderFrontRegardless()
        timer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh() }
        }
        refresh()
    }

    func attach(to frame: CGRect) {
        if let previous = lastWindowFrame, previous != frame {
            if previous.size == frame.size {
                target = target?.offsetBy(dx: frame.minX - previous.minX, dy: frame.minY - previous.minY)
            } else { target = nil; lastTargetCheck = .distantPast }
        }
        lastWindowFrame = frame
        guard let screen = NSScreen.screens.max(by: { $0.frame.intersection(frame).width * $0.frame.intersection(frame).height < $1.frame.intersection(frame).width * $1.frame.intersection(frame).height }) else { return }
        let visible = screen.visibleFrame
        if let target = target, frame.insetBy(dx: -5, dy: -5).contains(target),
           let placement = GuidePlacement.nextTo(target, size: panel.frame.size, visible: visible) {
            appearance.side = placement.side
            appearance.pointerY = placement.pointerY
            appearance.targeted = true
            panel.setFrameOrigin(placement.frame.origin)
        } else if let placement = GuidePlacement.nextTo(frame, size: panel.frame.size, visible: visible) {
            // Without control access, point to the Settings window instead.
            appearance.side = placement.side
            appearance.pointerY = placement.pointerY
            appearance.targeted = false
            panel.setFrameOrigin(placement.frame.origin)
        } else {
            appearance.side = .none
            appearance.targeted = false
            var point = NSPoint(x: frame.maxX - panel.frame.width, y: frame.minY - panel.frame.height - 8)
            if point.y < visible.minY { point.y = min(visible.maxY - panel.frame.height, frame.maxY - panel.frame.height); point.x = frame.maxX + 8 }
            point.x = max(visible.minX, min(point.x, visible.maxX - panel.frame.width))
            point.y = max(visible.minY, min(point.y, visible.maxY - panel.frame.height))
            panel.setFrameOrigin(point)
        }
        let front = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        if front == "com.apple.systempreferences" || front == Bundle.main.bundleIdentifier { panel.orderFrontRegardless() }
        else { panel.orderOut(nil) }
    }

    func refresh() {
        guard !closed else { return }
        let step = notificationStep()
        if appearance.notificationStep != step {
            appearance.notificationStep = step
            target = nil
            lastTargetCheck = .distantPast
        }
        if isComplete() { close(); onComplete(); return }
        if Date() > deadline { close(); return }
        if let frame = tracker.currentFrame { attach(to: frame) }
        guard !targetCheckRunning, Date().timeIntervalSince(lastTargetCheck) > 1 else { return }
        lastTargetCheck = Date(); targetCheckRunning = true
        let kind = self.kind
        let windowFrameAtQuery = tracker.currentFrame
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let target = GuideTarget.find(kind: kind, step: step)
            DispatchQueue.main.async {
                guard let self = self, !self.closed else { return }
                self.targetCheckRunning = false
                guard step == self.notificationStep(), windowFrameAtQuery == self.tracker.currentFrame else { self.lastTargetCheck = .distantPast; return }
                self.target = target.flatMap { GuideTarget.appKitFrame($0) }
                if let frame = self.tracker.currentFrame { self.attach(to: frame) }
            }
        }
    }
    func close() { closed = true; timer?.invalidate(); timer = nil; tracker.stopTracking(); panel.orderOut(nil) }
    func windowShouldClose(_ sender: NSWindow) -> Bool { close(); return false }
}

extension AppDelegate {
    @MainActor func openSettingsGuide(_ kind: String) {
        settingsGuide?.close()
        setupKeepOpen = true
        settingsReturn?.stop()
        settingsReturn = SettingsReturnObserver { [weak self] in
            guard let self = self, let window = self.setupWindow, !window.isMiniaturized else { return }
            self.settingsGuide?.close()
            NSApp.unhide(nil)
            NSApp.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
        }
        if kind == "login" { SMAppService.openSystemSettingsLoginItems() }
        else {
            var destination = URLComponents(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension")!
            if let identifier = Bundle.main.bundleIdentifier {
                destination.queryItems = [URLQueryItem(name: "id", value: identifier)]
            }
            NSWorkspace.shared.open(destination.url!)
        }
        let needsGuide = kind == "login" ? SMAppService.mainApp.status != .enabled : notificationGuideStep != .ready
        guard needsGuide else { settingsGuide = nil; return }
        settingsGuide = SettingsGuide(kind: kind, notificationStep: { [weak self] in self?.notificationGuideStep ?? .ready }, isComplete: { [weak self] in
            kind == "login" ? SMAppService.mainApp.status == .enabled : self?.notificationGuideStep == .ready
        }, onComplete: { [weak self] in
            self?.settingsGuide = nil
            self?.refreshSetup()
            // Keep the settings window in place while the guide finishes.
        })
    }
}
