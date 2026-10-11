import AppKit

private let appDragType = NSPasteboard.PasteboardType("ai.igor.vm.app")

final class AppPinButton: BrowserHoverButton, NSDraggingSource {
    var appID = ""
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

    func renderPins() {
        guard let strip = appPins else { return }
        for view in strip.arrangedSubviews { strip.removeArrangedSubview(view); view.removeFromSuperview() }
        for id in pinnedApps {
            guard let app = desktopApps.first(where: { $0["id"] as? String == id }) else { continue }
            let button = AppPinButton(image: appImage(app), target: self, action: #selector(openApp(_:)))
            button.appID = id
            button.running = currentDesktopWindows.contains { ($0["app"] as? String ?? "").lowercased().contains(String(id.dropLast(".desktop".count)).lowercased()) }
            button.identifier = NSUserInterfaceItemIdentifier(id)
            button.isBordered = false
            button.imageScaling = .scaleProportionallyDown
            button.contentTintColor = nil
            button.widthAnchor.constraint(equalToConstant: 34).isActive = true
            button.heightAnchor.constraint(equalToConstant: 34).isActive = true
            let name = app["name"] as? String ?? id
            button.toolTip = name + " · drag to reorder or away to unpin"
            button.setAccessibilityLabel("open " + name)
            button.onRemove = { [weak self] in self?.setPins(self?.pinnedApps.filter { $0 != id } ?? []) }
            let menu = NSMenu()
            let open = NSMenuItem(title: "open " + name, action: #selector(openAppMenu(_:)), keyEquivalent: "")
            open.target = self; open.representedObject = id
            let unpin = NSMenuItem(title: "unpin from taskbar", action: #selector(togglePin(_:)), keyEquivalent: "")
            unpin.target = self; unpin.representedObject = id
            menu.addItem(open)
            if id == "chromium.desktop" {
                let fresh = NSMenuItem(title: "new window", action: #selector(openNewAppMenu(_:)), keyEquivalent: "")
                fresh.target = self; fresh.representedObject = id; menu.addItem(fresh)
            }
            menu.addItem(.separator()); menu.addItem(unpin)
            button.menu = menu
            strip.addArrangedSubview(button)
        }
        pinStripWidth?.constant = CGFloat(max(1, strip.arrangedSubviews.count)) * 34 + CGFloat(max(0, strip.arrangedSubviews.count - 1)) * 4
    }

    @objc func showApps(_ sender: NSButton) {
        if appsPopover?.isShown == true { appsPopover?.close(); return }
        let controller = NSViewController()
        let rows = max(1, (desktopApps.count + 2) / 3)
        let gridHeight = CGFloat(rows) * 100
        let visibleHeight = min(gridHeight, 340)
        let content = NSView(frame: NSRect(x: 0, y: 0, width: 336, height: visibleHeight + 52))
        controller.view = content
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
            let open = AppPinButton(title: name, target: self, action: #selector(openApp(_:)))
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
            open.toolTip = name + " · drag to taskbar to pin"
            open.setAccessibilityLabel("open " + name)
            let menu = NSMenu()
            let pin = NSMenuItem(title: pinnedApps.contains(id) ? "unpin from taskbar" : "pin to taskbar", action: #selector(togglePin(_:)), keyEquivalent: "")
            pin.target = self; pin.representedObject = id
            menu.addItem(pin)
            open.menu = menu
            grid.addSubview(open)
        }
        scroll.documentView = grid
        scroll.contentView.scroll(to: NSPoint(x: 0, y: max(0, gridHeight - visibleHeight)))
        content.addSubview(scroll)
        let popover = NSPopover()
        popover.behavior = .transient
        popover.contentViewController = controller
        appsPopover = popover
        if appMenuKeyMonitor == nil {
            appMenuKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
                if event.keyCode == 53, self?.appsPopover?.isShown == true { self?.appsPopover?.close(); return nil }
                return event
            }
        }
        popover.show(relativeTo: sender.bounds, of: sender, preferredEdge: .minY)
    }
    @objc func pinAppButton(_ sender: NSButton) {
        guard let id = sender.identifier?.rawValue else { return }
        let pinned = pinnedApps.contains(id)
        sender.contentTintColor = pinned ? .secondaryLabelColor : .controlAccentColor
        sender.image = NSImage(systemSymbolName: pinned ? "pin" : "pin.fill", accessibilityDescription: "pin to taskbar")
        sender.toolTip = pinned ? "pin to taskbar" : "unpin from taskbar"
        setPins(pinned ? pinnedApps.filter { $0 != id } : pinnedApps + [id])
    }
    @objc func openApp(_ sender: NSButton) { if let id = sender.identifier?.rawValue { launchApp(id) } }
    @objc func openNewAppMenu(_ sender: NSMenuItem) { if let id = sender.representedObject as? String { launchApp(id, newWindow: true) } }
    @objc func openAppMenu(_ sender: NSMenuItem) { if let id = sender.representedObject as? String { launchApp(id) } }
    @objc func togglePin(_ sender: NSMenuItem) {
        appsPopover?.close()
        guard let id = sender.representedObject as? String else { return }
        setPins(pinnedApps.contains(id) ? pinnedApps.filter { $0 != id } : pinnedApps + [id])
    }
    func movePin(_ id: String, to index: Int) {
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
        appsPopover?.close()
        guard !windowActionRunning else { return }
        windowActionRunning = true
        request("/apps", post: true, arguments: ["action": "launch", "id": id, "newWindow": newWindow]) { result in
            self.windowActionRunning = false
            if case .failure(let error) = result { self.showError(error.localizedDescription) }
            self.refreshBrowserWindows()
            self.window?.makeFirstResponder(self.webView)
        }
    }
}
