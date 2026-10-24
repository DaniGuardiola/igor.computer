import AppKit

private let appDragType = NSPasteboard.PasteboardType("ai.igor.computer.app")

class AppPinButton: BrowserHoverButton, NSDraggingSource {
    var appID = ""
    var dockHovered = false
    var onHover: (() -> Void)?
    var onHoverExit: (() -> Void)?
    override func mouseEntered(with event: NSEvent) {
        super.mouseEntered(with: event); dockHovered = true; onHover?()
    }
    override func mouseExited(with event: NSEvent) {
        super.mouseExited(with: event); dockHovered = false; onHoverExit?()
    }
    override func rightMouseDown(with event: NSEvent) {
        if let menu = menu { NSMenu.popUpContextMenu(menu, with: event, for: self) }
    }
    var running = false { didSet { if oldValue != running { needsDisplay = true } } }
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        if running {
            NSColor.controlAccentColor.setFill()
            NSBezierPath(ovalIn: NSRect(x: bounds.midX - 1.5, y: isFlipped ? bounds.maxY - 3 : 0, width: 3, height: 3)).fill()
        }
    }
    var onRemove: (() -> Void)?
    override func mouseDown(with event: NSEvent) {
        onHoverExit?()
        guard isEnabled else { return }
        highlight(true)
        while let next = window?.nextEvent(matching: [.leftMouseDragged, .leftMouseUp]) {
            if next.type == .leftMouseUp {
                highlight(false)
                if bounds.contains(convert(next.locationInWindow, from: nil)) { performClick(nil) }
                return
            }
            if hypot(next.locationInWindow.x - event.locationInWindow.x, next.locationInWindow.y - event.locationInWindow.y) >= 4 {
                highlight(false)
                mouseDragged(with: next)
                return
            }
        }
        highlight(false)
    }
    override func mouseDragged(with event: NSEvent) {
        let pasteboard = NSPasteboardItem()
        pasteboard.setString(appID, forType: appDragType)
        let item = NSDraggingItem(pasteboardWriter: pasteboard)
        item.setDraggingFrame(bounds, contents: image)
        beginDraggingSession(with: [item], event: event, source: self)
    }
    func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation { .move }
    func draggingSession(_ session: NSDraggingSession, endedAt screenPoint: NSPoint, operation: NSDragOperation) {
        // Like a dock, dragging a pin away removes the shortcut, never the app.
        guard operation == [], let window = window, let strip = superview else { return }
        let point = strip.convert(window.convertPoint(fromScreen: screenPoint), from: nil)
        if !strip.bounds.insetBy(dx: -40, dy: -45).contains(point) { onRemove?() }
    }
}

// A desktop surface, contained by the viewer rather than a separate macOS popup.
class AppLauncherSurface: NSView {
    var onExit: (() -> Void)?
    private var tracking: NSTrackingArea?
    override func updateTrackingAreas() {
        if let tracking = tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(area); tracking = area
        super.updateTrackingAreas()
    }
    override func mouseExited(with event: NSEvent) { onExit?() }
    override func draw(_ dirtyRect: NSRect) {
        let dark = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        let shape = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 12, yRadius: 12)
        (dark ? NSColor(srgbRed: 0.14, green: 0.17, blue: 0.22, alpha: 1) : NSColor(srgbRed: 0.94, green: 0.96, blue: 0.99, alpha: 1)).setFill()
        shape.fill()
        NSColor.labelColor.withAlphaComponent(0.10).setStroke()
        shape.lineWidth = 1
        shape.stroke()
    }
    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        needsDisplay = true
    }
}

final class DockSurface: AppLauncherSurface {
    var onAppDrop: ((String, NSPoint) -> Void)?
    private var receivingDrop = false { didSet { needsDisplay = true } }
    override init(frame frameRect: NSRect) { super.init(frame: frameRect); registerForDraggedTypes([appDragType]) }
    required init?(coder: NSCoder) { super.init(coder: coder); registerForDraggedTypes([appDragType]) }
    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation { receivingDrop = true; return .move }
    override func draggingExited(_ sender: NSDraggingInfo?) { receivingDrop = false }
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        receivingDrop = false
        guard let id = sender.draggingPasteboard.string(forType: appDragType) else { return false }
        onAppDrop?(id, sender.draggingLocation)
        return true
    }
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        if receivingDrop {
            NSColor.controlAccentColor.withAlphaComponent(0.7).setStroke()
            let border = NSBezierPath(roundedRect: bounds.insetBy(dx: 1, dy: 1), xRadius: 12, yRadius: 12)
            border.lineWidth = 2; border.stroke()
        }
    }
}

final class AppLauncherTile: AppPinButton {
    private var tileHovered = false
    override func mouseEntered(with event: NSEvent) { tileHovered = true; needsDisplay = true }
    override func mouseExited(with event: NSEvent) { tileHovered = false; needsDisplay = true }
    override func rightMouseDown(with event: NSEvent) {
        if let menu = menu { NSMenu.popUpContextMenu(menu, with: event, for: self) }
    }
    override func draw(_ dirtyRect: NSRect) {
        if tileHovered || isHighlighted {
            NSColor.labelColor.withAlphaComponent(isHighlighted ? 0.14 : 0.07).setFill()
            NSBezierPath(roundedRect: bounds.insetBy(dx: 2, dy: 2), xRadius: 8, yRadius: 8).fill()
        }
        let iconY = isFlipped ? CGFloat(14) : bounds.height - 50
        image?.draw(in: NSRect(x: bounds.midX - 18, y: iconY, width: 36, height: 36), from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        paragraph.lineBreakMode = .byTruncatingTail
        let label = NSAttributedString(string: title, attributes: [.font: NSFont.systemFont(ofSize: 12, weight: .medium), .foregroundColor: NSColor.labelColor, .paragraphStyle: paragraph])
        label.draw(in: NSRect(x: 6, y: isFlipped ? 60 : bounds.height - 76, width: bounds.width - 12, height: 18))
    }
}

final class AppPinStrip: NSStackView {
    var onDrop: ((String, Int) -> Void)?
    override init(frame frameRect: NSRect) { super.init(frame: frameRect); registerForDraggedTypes([appDragType]) }
    required init?(coder: NSCoder) { super.init(coder: coder); registerForDraggedTypes([appDragType]) }
    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation { .move }
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        guard let id = sender.draggingPasteboard.string(forType: appDragType) else { return false }
        let point = convert(sender.draggingLocation, from: nil)
        let index = arrangedSubviews.firstIndex(where: { point.x < $0.frame.midX }) ?? arrangedSubviews.count
        onDrop?(id, index)
        return true
    }
}

extension AppDelegate {
    func workspacePicture(_ workspace: [String: Any]) -> NSImage? {
        if workspace["personal"] as? Bool == true { return nil }
        let image: NSImage
        if let avatar = workspace["avatar"] as? String, let data = Data(base64Encoded: String(avatar.split(separator: ",").last ?? "")), let loaded = NSImage(data: data) {
            image = loaded
        } else {
            let label = workspace["label"] as? String ?? "user"
            image = NSImage(size: NSSize(width: 22, height: 22), flipped: false) { rect in
                NSColor.controlAccentColor.withAlphaComponent(0.18).setFill()
                NSBezierPath(ovalIn: rect).fill()
                let text = String(label.prefix(1)).uppercased() as NSString
                let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 11, weight: .semibold), .foregroundColor: NSColor.labelColor]
                let size = text.size(withAttributes: attrs)
                text.draw(at: NSPoint(x: (rect.width-size.width)/2, y: (rect.height-size.height)/2), withAttributes: attrs)
                return true
            }
        }
        let rounded = NSImage(size: NSSize(width: 22, height: 22), flipped: false) { rect in
            NSGraphicsContext.saveGraphicsState()
            NSBezierPath(ovalIn: rect).addClip()
            image.draw(in: rect)
            NSGraphicsContext.restoreGraphicsState()
            if let state = workspace["agentState"] as? String {
                let dot = NSRect(x: rect.maxX - 6, y: rect.minY, width: 6, height: 6)
                let color: NSColor = state == "active" ? .systemGreen : state == "controlled" ? .systemBlue : state == "paused" ? .systemOrange : .systemGray
                NSColor.windowBackgroundColor.setFill()
                NSBezierPath(ovalIn: dot.insetBy(dx: -1, dy: -1)).fill()
                color.setFill()
                NSBezierPath(ovalIn: dot).fill()
            }
            return true
        }
        return rounded
    }

    func appImage(_ app: [String: Any]) -> NSImage {
        if let icon = app["icon"] as? String, let data = Data(base64Encoded: String(icon.split(separator: ",").last ?? "")), let image = NSImage(data: data) {
            image.size = NSSize(width: 24, height: 24)
            return image
        }
        return NSImage(systemSymbolName: "app", accessibilityDescription: app["name"] as? String)!
    }

    func refreshApps() {
        guard !appsLoading else { return }
        appsLoading = true
        request("/apps") { result in
            self.appsLoading = false
            guard case .success(let data) = result else { return }
            let signature = (try? JSONSerialization.data(withJSONObject: data, options: [.sortedKeys]))?.base64EncodedString() ?? ""
            guard signature != self.appSignature else { return }
            self.appSignature = signature
            self.desktopApps = data["apps"] as? [[String: Any]] ?? []
            self.pinnedApps = data["pins"] as? [String] ?? []
            self.renderPins()
        }
    }

    func appWindows(_ id: String) -> [[String: Any]] {
        let key = id.hasPrefix("running:") ? String(id.dropFirst(8)) : id.replacingOccurrences(of: ".desktop", with: "")
        return currentDesktopWindows.filter { ($0["app"] as? String ?? "").lowercased().contains(key.lowercased()) }
    }

    func dockApps() -> [[String: Any]] {
        var apps = pinnedApps.compactMap { id in desktopApps.first { $0["id"] as? String == id } }
        for window in currentDesktopWindows {
            let name = window["app"] as? String ?? "app"
            let app = desktopApps.first { entry in name.lowercased().contains((entry["id"] as? String ?? "").replacingOccurrences(of: ".desktop", with: "").lowercased()) }
                ?? ["id": "running:" + name.lowercased(), "name": name.lowercased()]
            if !apps.contains(where: { $0["id"] as? String == app["id"] as? String }) { apps.append(app) }
        }
        return apps
    }

    func renderPins() {
        guard let strip = appPins else { return }
        let apps = dockApps()
        let signature = apps.compactMap { $0["id"] as? String }.joined(separator: "|") + ":" + pinnedApps.joined(separator: "|") + ":" + mode + ":" + currentDesktopWindows.compactMap { $0["id"] as? String }.joined(separator: "|")
        if signature == dockSignature {
            for button in strip.arrangedSubviews.compactMap({ $0 as? AppPinButton }) { button.running = !appWindows(button.appID).isEmpty }
            if !dockWindowApp.isEmpty, appWindows(dockWindowApp).isEmpty { dismissDockWindows() }
            return
        }
        dockSignature = signature
        dismissDockWindows()
        for view in strip.arrangedSubviews { strip.removeArrangedSubview(view); view.removeFromSuperview() }
        for app in apps {
            guard let id = app["id"] as? String else { continue }
            let pinned = pinnedApps.contains(id)
            let button = AppPinButton(image: appImage(app), target: self, action: #selector(openDockApp(_:)))
            button.appID = id
            button.running = !appWindows(id).isEmpty
            button.identifier = NSUserInterfaceItemIdentifier(id)
            button.isBordered = false
            button.imageScaling = .scaleProportionallyDown
            button.contentTintColor = nil
            button.widthAnchor.constraint(equalToConstant: 38).isActive = true
            button.heightAnchor.constraint(equalToConstant: 38).isActive = true
            let name = app["name"] as? String ?? id
            button.toolTip = name + (pinned ? " · drag to reorder · drag out to unpin" : " · running · drag to pin")
            button.setAccessibilityLabel("open " + name)
            if pinned { button.onRemove = { [weak self] in self?.setPins(self?.pinnedApps.filter { $0 != id } ?? []) } }
            button.onHover = { [weak self, weak button] in
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    guard let button = button, button.dockHovered else { return }
                    self?.showDockWindows(button)
                }
            }
            button.onHoverExit = { [weak self, weak button] in self?.scheduleDockDismiss(button) }
            let menu = NSMenu()
            menu.autoenablesItems = false
            let open = NSMenuItem(title: "open " + name, action: #selector(openAppMenu(_:)), keyEquivalent: "")
            open.target = self; open.representedObject = id; open.isEnabled = mode == "human"
            menu.addItem(open)
            if id == "chromium.desktop" {
                let fresh = NSMenuItem(title: "new window", action: #selector(openNewAppMenu(_:)), keyEquivalent: "")
                fresh.target = self; fresh.representedObject = id; fresh.isEnabled = mode == "human"; menu.addItem(fresh)
            }
            if !appWindows(id).isEmpty {
                let close = NSMenuItem(title: "close all windows", action: #selector(closeAppWindows(_:)), keyEquivalent: "")
                close.target = self; close.representedObject = id; close.isEnabled = mode == "human"; menu.addItem(close)
            }
            if !id.hasPrefix("running:") {
                menu.addItem(.separator())
                let pin = NSMenuItem(title: pinned ? "unpin from dock" : "pin to dock", action: #selector(togglePin(_:)), keyEquivalent: "")
                pin.target = self; pin.representedObject = id; menu.addItem(pin)
            }
            button.menu = menu
            strip.addArrangedSubview(button)
        }
        let width = CGFloat(max(1, apps.count)) * 38 + CGFloat(max(0, apps.count - 1)) * 6
        strip.setFrameSize(NSSize(width: width, height: 38))
        strip.layoutSubtreeIfNeeded()
        pinStripWidth?.constant = width
    }

    @objc func openDockApp(_ sender: AppPinButton) {
        if appWindows(sender.appID).count > 1 { showDockWindows(sender, sticky: true) }
        else { launchApp(sender.appID) }
    }

    func showDockWindows(_ sender: AppPinButton, sticky: Bool = false) {
        if dockWindowApp == sender.appID, dockWindowPanel != nil { dockPanelSticky = dockPanelSticky || sticky; return }
        let windows = appWindows(sender.appID)
        guard !windows.isEmpty, let container = window?.contentView, let bar = desktopBar else { return }
        dismissDockWindows(); dismissAppLauncher()
        dockWindowApp = sender.appID
        dockPanelSticky = sticky
        let panel = AppLauncherSurface()
        panel.translatesAutoresizingMaskIntoConstraints = false
        let rows = NSStackView()
        rows.orientation = .vertical; rows.alignment = .leading; rows.spacing = 4
        rows.translatesAutoresizingMaskIntoConstraints = false
        for entry in windows {
            guard let id = entry["id"] as? String else { continue }
            let title = (entry["title"] as? String ?? "untitled").replacingOccurrences(of: " - Chromium", with: "")
            let focus = BrowserHoverButton(title: title == "about:blank" ? "blank tab" : title, target: self, action: #selector(focusBrowserWindow(_:)))
            focus.isBordered = false; focus.font = .systemFont(ofSize: 12, weight: .medium)
            focus.alignment = .left; focus.lineBreakMode = .byTruncatingTail
            focus.identifier = NSUserInterfaceItemIdentifier(id + ":" + windowGeneration)
            focus.isEnabled = mode == "human"
            focus.widthAnchor.constraint(equalToConstant: 230).isActive = true
            focus.heightAnchor.constraint(equalToConstant: 32).isActive = true
            let close = BrowserHoverButton(image: NSImage(systemSymbolName: "xmark", accessibilityDescription: "close window")!, target: self, action: #selector(closeBrowserWindow(_:)))
            close.identifier = focus.identifier; close.isBordered = false; close.destructive = true
            close.isEnabled = mode == "human"; close.toolTip = "close " + title
            close.widthAnchor.constraint(equalToConstant: 30).isActive = true
            close.heightAnchor.constraint(equalToConstant: 32).isActive = true
            let row = NSStackView(views: [focus, close]); row.spacing = 4
            rows.addArrangedSubview(row)
        }
        let scroll = NSScrollView(); scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.drawsBackground = false; scroll.hasVerticalScroller = windows.count > 6; scroll.autohidesScrollers = true
        let height = CGFloat(windows.count) * 36 - 4
        rows.frame = NSRect(x: 0, y: 0, width: 264, height: height)
        scroll.documentView = rows
        panel.addSubview(scroll); container.addSubview(panel)
        let preferred = panel.centerXAnchor.constraint(equalTo: sender.centerXAnchor); preferred.priority = .defaultHigh
        NSLayoutConstraint.activate([
            panel.bottomAnchor.constraint(equalTo: bar.topAnchor, constant: -8),
            panel.widthAnchor.constraint(equalToConstant: 288), panel.heightAnchor.constraint(equalToConstant: min(212, height) + 24),
            panel.leadingAnchor.constraint(greaterThanOrEqualTo: container.leadingAnchor, constant: 12),
            panel.trailingAnchor.constraint(lessThanOrEqualTo: container.trailingAnchor, constant: -12), preferred,
            scroll.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 12), scroll.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -12),
            scroll.topAnchor.constraint(equalTo: panel.topAnchor, constant: 12), scroll.bottomAnchor.constraint(equalTo: panel.bottomAnchor, constant: -12)
        ])
        dockWindowPanel = panel
        dockPanelMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseDown, .rightMouseDown]) { [weak self, weak sender] event in
            guard let self = self, let panel = self.dockWindowPanel else { return event }
            if event.type == .keyDown, event.keyCode == 53 { self.dismissDockWindows(); return nil }
            if event.type != .keyDown, event.window === self.window,
               !panel.bounds.contains(panel.convert(event.locationInWindow, from: nil)),
               sender?.bounds.contains(sender!.convert(event.locationInWindow, from: nil)) != true { self.dismissDockWindows() }
            return event
        }
        panel.onExit = { [weak self, weak sender] in self?.scheduleDockDismiss(sender) }
    }

    func scheduleDockDismiss(_ sender: AppPinButton?) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self, weak sender] in
            guard let self = self, let panel = self.dockWindowPanel, let window = self.window, !self.dockPanelSticky else { return }
            let point = window.convertPoint(fromScreen: NSEvent.mouseLocation)
            if sender?.dockHovered == true || panel.bounds.contains(panel.convert(point, from: nil)) { return }
            self.dismissDockWindows()
        }
    }
    func dismissDockWindows() {
        dockWindowPanel?.removeFromSuperview(); dockWindowPanel = nil; dockWindowApp = ""; dockPanelSticky = false
        if let monitor = dockPanelMonitor { NSEvent.removeMonitor(monitor) }
        dockPanelMonitor = nil
    }

    @objc func closeAppWindows(_ sender: NSMenuItem) {
        guard let app = sender.representedObject as? String, mode == "human", !windowActionRunning else { return }
        let ids = appWindows(app).compactMap { $0["id"] as? String }
        let generation = windowGeneration
        dismissDockWindows()
        windowActionRunning = true
        func closeNext(_ remaining: ArraySlice<String>) {
            guard let id = remaining.first else { self.windowActionRunning = false; self.refreshBrowserWindows(); return }
            self.request("/windows", post: true, arguments: ["action": "close", "id": id, "generation": generation]) { result in
                if case .failure(let error) = result { self.windowActionRunning = false; self.showError(error.localizedDescription); self.refreshBrowserWindows(); return }
                closeNext(remaining.dropFirst())
            }
        }
        closeNext(ids[...])
    }

    @objc func showApps(_ sender: NSButton) {
        if appLauncher != nil { dismissAppLauncher(); return }
        dismissDockWindows()
        guard let container = window?.contentView, let bar = desktopBar else { return }
        let rows = max(1, (desktopApps.count + 2) / 3)
        let gridHeight = CGFloat(rows) * 100
        let visibleHeight = min(gridHeight, 340)
        let content = AppLauncherSurface(frame: NSRect(x: 0, y: 0, width: 336, height: visibleHeight + 52))
        let title = NSTextField(labelWithString: "apps")
        title.font = .systemFont(ofSize: 13, weight: .semibold)
        title.frame = NSRect(x: 18, y: visibleHeight + 24, width: 300, height: 18)
        content.addSubview(title)
        let scroll = NSScrollView(frame: NSRect(x: 16, y: 12, width: 304, height: visibleHeight))
        scroll.hasVerticalScroller = gridHeight > visibleHeight
        scroll.autohidesScrollers = true
        scroll.drawsBackground = false
        let grid = NSView(frame: NSRect(x: 0, y: 0, width: 304, height: gridHeight))
        for (index, app) in desktopApps.enumerated() {
            guard let id = app["id"] as? String else { continue }
            let name = app["name"] as? String ?? id
            let open = AppLauncherTile(title: name, target: self, action: #selector(openApp(_:)))
            open.appID = id
            open.identifier = NSUserInterfaceItemIdentifier(id)
            open.image = appImage(app).copy() as? NSImage
            open.image?.size = NSSize(width: 36, height: 36)
            open.imagePosition = .imageAbove
            open.imageScaling = .scaleProportionallyDown
            open.isBordered = false
            open.font = .systemFont(ofSize: 12, weight: .medium)
            open.alignment = .center
            open.frame = NSRect(x: CGFloat(index % 3) * 104, y: gridHeight - CGFloat(index / 3 + 1) * 100 + 4, width: 96, height: 92)
            open.toolTip = name + " · drag to dock to pin"
            open.setAccessibilityLabel("open " + name)
            let menu = NSMenu()
            let pin = NSMenuItem(title: pinnedApps.contains(id) ? "unpin from dock" : "pin to dock", action: #selector(togglePin(_:)), keyEquivalent: "")
            pin.target = self; pin.representedObject = id
            menu.addItem(pin)
            open.menu = menu
            grid.addSubview(open)
        }
        scroll.documentView = grid
        scroll.contentView.scroll(to: NSPoint(x: 0, y: max(0, gridHeight - visibleHeight)))
        content.addSubview(scroll)
        content.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(content, positioned: .above, relativeTo: webView)
        NSLayoutConstraint.activate([
            content.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            content.bottomAnchor.constraint(equalTo: bar.topAnchor, constant: -8),
            content.widthAnchor.constraint(equalToConstant: 336),
            content.heightAnchor.constraint(equalToConstant: visibleHeight + 52)
        ])
        content.wantsLayer = true
        content.layer?.shadowColor = NSColor.black.cgColor
        content.layer?.shadowOpacity = 0.18
        content.layer?.shadowRadius = 12
        content.layer?.shadowOffset = CGSize(width: 0, height: -3)
        appLauncher = content
        content.alphaValue = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 1 : 0
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.14
            content.animator().alphaValue = 1
        }
        appMenuKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseDown, .rightMouseDown]) { [weak self] event in
            guard let self = self, let panel = self.appLauncher else { return event }
            if event.type == .keyDown {
                if event.keyCode == 53 { self.dismissAppLauncher(); return nil }
            } else if event.window === self.window {
                let insidePanel = panel.bounds.contains(panel.convert(event.locationInWindow, from: nil))
                let insideButton = sender.bounds.contains(sender.convert(event.locationInWindow, from: nil))
                if !insidePanel && !insideButton { self.dismissAppLauncher() }
            }
            return event
        }
    }

    func dismissAppLauncher() {
        appLauncher?.removeFromSuperview()
        appLauncher = nil
        if let monitor = appMenuKeyMonitor { NSEvent.removeMonitor(monitor) }
        appMenuKeyMonitor = nil
    }
    @objc func pinAppButton(_ sender: NSButton) {
        guard let id = sender.identifier?.rawValue else { return }
        let pinned = pinnedApps.contains(id)
        sender.contentTintColor = pinned ? .secondaryLabelColor : .controlAccentColor
        sender.image = NSImage(systemSymbolName: pinned ? "pin" : "pin.fill", accessibilityDescription: "pin to dock")
        sender.toolTip = pinned ? "pin to dock" : "unpin from dock"
        setPins(pinned ? pinnedApps.filter { $0 != id } : pinnedApps + [id])
    }
    @objc func openApp(_ sender: NSButton) { if let id = sender.identifier?.rawValue { launchApp(id) } }
    @objc func openNewAppMenu(_ sender: NSMenuItem) { if let id = sender.representedObject as? String { launchApp(id, newWindow: true) } }
    @objc func openAppMenu(_ sender: NSMenuItem) { if let id = sender.representedObject as? String { launchApp(id) } }
    @objc func togglePin(_ sender: NSMenuItem) {
        dismissAppLauncher()
        guard let id = sender.representedObject as? String else { return }
        setPins(pinnedApps.contains(id) ? pinnedApps.filter { $0 != id } : pinnedApps + [id])
    }
    func movePin(_ id: String, to index: Int) {
        guard !id.hasPrefix("running:") else { return }
        dismissAppLauncher(); dismissDockWindows()
        var pins = pinnedApps.filter { $0 != id }
        let old = pinnedApps.firstIndex(of: id) ?? pinnedApps.count
        pins.insert(id, at: min(pins.count, max(0, index - (old < index ? 1 : 0))))
        setPins(pins)
    }
    func setPins(_ pins: [String]) {
        request("/apps", post: true, arguments: ["action": "pin", "pins": pins]) { result in
            if case .failure(let error) = result { self.showError(error.localizedDescription) }
            self.appSignature = ""; self.refreshApps()
        }
    }
    func launchApp(_ id: String, newWindow: Bool = false) {
        dismissAppLauncher(); dismissDockWindows()
        if let window = appWindows(id).first, let windowID = window["id"] as? String, !newWindow {
            browserWindowAction("focus", id: windowID)
            return
        }
        guard !id.hasPrefix("running:"), !windowActionRunning else { return }
        windowActionRunning = true
        request("/apps", post: true, arguments: ["action": "launch", "id": id, "newWindow": newWindow]) { result in
            self.windowActionRunning = false
            if case .failure(let error) = result { self.showError(error.localizedDescription) }
            self.refreshBrowserWindows()
            self.window?.makeFirstResponder(self.webView)
        }
    }
}
