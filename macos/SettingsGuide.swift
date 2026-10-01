import AppKit
import ServiceManagement
import SwiftUI
import QuartzCore

@MainActor
final class SettingsGuide: NSObject, NSWindowDelegate {
    let panel: NSPanel
    let tracker = SettingsWindowTracker()
    let isComplete: () -> Bool
    let notificationStep: () -> NotificationGuideStep
    let onComplete: () -> Void
    let appearance = GuideAppearance()
    let kind: String
    var target: CGRect?
    var estimated = false
    var lastWindowFrame: CGRect?
    var targetCheckRunning = false
    var lastTargetCheck = Date.distantPast
    var timer: Timer?
    var closed = false
    var hasPresented = false
    var stepChanged = false
    var frameStableSince = Date()
    let started = Date()

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
        panel.contentView = NSHostingView(rootView: GuideView(kind: kind, appearance: appearance))
        panel.alphaValue = 0
        panel.animationBehavior = .none
        appearance.notificationStep = notificationStep()
        tracker.onFrameChange = { [weak self] frame in self?.attach(to: frame) }
        tracker.onTrackingEnded = { [weak self] in self?.close() }
        tracker.startTracking(promptIfNeeded: false)
        timer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh() }
        }
        refresh()
    }

    func attach(to frame: CGRect) {
        guard !closed else { return }
        if lastWindowFrame != frame { frameStableSince = Date() }
        if let previous = lastWindowFrame, previous != frame {
            if previous.size == frame.size {
                target = target?.offsetBy(dx: frame.minX - previous.minX, dy: frame.minY - previous.minY)
            } else { target = nil; lastTargetCheck = .distantPast }
        }
        lastWindowFrame = frame
        guard let screen = NSScreen.screens.max(by: { $0.frame.intersection(frame).width * $0.frame.intersection(frame).height < $1.frame.intersection(frame).width * $1.frame.intersection(frame).height }) else { return }
        let visible = screen.visibleFrame
        let estimate = kind == "notifications" && ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 26 ? GuideEstimate.notification(notificationStep(), in: frame) : nil
        let pointerTarget = target ?? estimate
        estimated = target == nil && estimate != nil
        if let target = pointerTarget, frame.insetBy(dx: -5, dy: -5).contains(target),
           let placement = GuidePlacement.besideWindow(frame, pointingAt: target, size: panel.frame.size, visible: visible) {
            appearance.side = placement.side
            appearance.pointerY = placement.pointerY
            appearance.targeted = !estimated
            move(to: placement.frame.origin)
        } else if let placement = GuidePlacement.nextTo(frame, size: panel.frame.size, visible: visible) {
            // Without control access, point to the Settings window instead.
            appearance.side = placement.side
            appearance.pointerY = placement.pointerY
            appearance.targeted = false
            move(to: placement.frame.origin)
        } else {
            appearance.side = .none
            appearance.targeted = false
            var point = NSPoint(x: frame.maxX - panel.frame.width, y: frame.minY - panel.frame.height - 8)
            if point.y < visible.minY { point.y = min(visible.maxY - panel.frame.height, frame.maxY - panel.frame.height); point.x = frame.maxX + 8 }
            point.x = max(visible.minX, min(point.x, visible.maxX - panel.frame.width))
            point.y = max(visible.minY, min(point.y, visible.maxY - panel.frame.height))
            move(to: point)
        }
        let front = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        // Never reveal the panel at a provisional location before Settings opens.
        if !hasPresented {
            guard GuidePresentation.canReveal(settingsForeground: front == "com.apple.systempreferences", elapsed: Date().timeIntervalSince(started), stableFor: Date().timeIntervalSince(frameStableSince)) else { return }
        }
        if front == "com.apple.systempreferences" || (hasPresented && front == Bundle.main.bundleIdentifier) {
            let entering = !panel.isVisible
            panel.orderFrontRegardless()
            if entering || stepChanged { callAttention(entering: entering) }
            hasPresented = true
            stepChanged = false
        } else { panel.orderOut(nil) }
    }

    private func move(to point: NSPoint) {
        guard panel.frame.origin != point else { return }
        if hasPresented && panel.isVisible && stepChanged && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.18
                context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
                panel.animator().setFrame(NSRect(origin: point, size: panel.frame.size), display: true)
            }
        } else { panel.setFrameOrigin(point) }
    }

    private func callAttention(entering: Bool) {
        guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else { panel.alphaValue = 1; return }
        panel.alphaValue = entering ? 0 : 0.86
        NSAnimationContext.runAnimationGroup { context in
            context.duration = entering ? 0.2 : 0.18
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            panel.animator().alphaValue = 1
        }
    }

    func refresh() {
        guard !closed else { return }
        let step = notificationStep()
        if appearance.notificationStep != step {
            stepChanged = hasPresented
            appearance.notificationStep = step
            target = nil
            lastTargetCheck = .distantPast
        }
        if isComplete() { close(); onComplete(); return }
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
        let initiatedSettings = SettingsReturnObserver.windowCount() == 0
        settingsReturn = SettingsReturnObserver { [weak self] in
            self?.settingsGuide?.close()
            self?.settingsGuide = nil
            // Regular app mode lets macOS restore activation on a manual close.
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
            self?.settingsReturn?.stop()
            let foreground = NSWorkspace.shared.frontmostApplication?.bundleIdentifier == "com.apple.systempreferences"
            if SettingsCompletionPolicy.shouldClose(initiated: initiatedSettings, windowCount: SettingsReturnObserver.windowCount(), foreground: foreground) {
                NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.systempreferences").first?.terminate()
            }
            if foreground || NSWorkspace.shared.frontmostApplication?.bundleIdentifier == Bundle.main.bundleIdentifier {
                self?.returnToBrowserSettings()
            }
        })
    }

    @MainActor func returnToBrowserSettings() {
        guard let window = setupWindow, !window.isMiniaturized else { return }
        prepareVisibleInterface()
        NSApp.unhide(nil)
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

}
