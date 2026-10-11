import AppKit

// Keep native popup interaction, with one shared center for its contents.
class WorkspacePicker: NSPopUpButton {
    var workspaceTitles: [String: String] = [:]
    override var alignmentRectInsets: NSEdgeInsets { NSEdgeInsetsZero }
}

class WorkspacePickerCell: NSPopUpButtonCell {
    override func draw(withFrame frame: NSRect, in controlView: NSView) {
        drawBezel(withFrame: frame, in: controlView)
        drawInterior(withFrame: frame, in: controlView)
    }

    override func drawBezel(withFrame frame: NSRect, in controlView: NSView) {
        let outline = NSBezierPath(roundedRect: frame.insetBy(dx: 0.5, dy: 0.5), xRadius: 14, yRadius: 14)
        NSColor.labelColor.withAlphaComponent(isHighlighted ? 0.16 : 0.09).setFill()
        outline.fill()
        NSColor.labelColor.withAlphaComponent(0.12).setStroke()
        outline.lineWidth = 1
        outline.stroke()
    }

    override func drawInterior(withFrame frame: NSRect, in controlView: NSView) {
        let centerY = frame.midY
        var titleX = frame.minX + 12
        if let avatar = selectedItem?.image {
            let avatarFrame = NSRect(x: frame.minX + (frame.height - 22) / 2, y: centerY - 11, width: 22, height: 22)
            avatar.draw(in: avatarFrame, from: .zero, operation: .sourceOver,
                        fraction: isEnabled ? 1 : 0.5, respectFlipped: true, hints: nil)
            titleX = avatarFrame.maxX + 8
        }
        let color = isEnabled ? NSColor.labelColor : NSColor.secondaryLabelColor
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byTruncatingTail
        let title = (controlView as? WorkspacePicker)?.workspaceTitles[selectedItem?.representedObject as? String ?? ""] ?? selectedItem?.title ?? ""
        let label = NSAttributedString(string: title, attributes: [
            .font: font ?? NSFont.systemFont(ofSize: 12, weight: .medium),
            .foregroundColor: color, .paragraphStyle: paragraph,
        ])
        let height = label.size().height
        label.draw(in: NSRect(x: titleX, y: centerY - height / 2,
                              width: max(0, frame.maxX - 26 - titleX), height: height))
        let arrowX = frame.maxX - 16
        let arrows = NSBezierPath()
        arrows.move(to: NSPoint(x: arrowX - 3, y: centerY + 2))
        arrows.line(to: NSPoint(x: arrowX, y: centerY + 5))
        arrows.line(to: NSPoint(x: arrowX + 3, y: centerY + 2))
        arrows.move(to: NSPoint(x: arrowX - 3, y: centerY - 2))
        arrows.line(to: NSPoint(x: arrowX, y: centerY - 5))
        arrows.line(to: NSPoint(x: arrowX + 3, y: centerY - 2))
        arrows.lineWidth = 1.5
        arrows.lineCapStyle = .round
        arrows.lineJoinStyle = .round
        color.setStroke()
        arrows.stroke()
    }
}

class WorkspaceControlGroup: NSStackView {
    override var alignmentRectInsets: NSEdgeInsets { NSEdgeInsetsZero }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.labelColor.withAlphaComponent(0.045).setFill()
        NSBezierPath(roundedRect: bounds, xRadius: 8, yRadius: 8).fill()
        super.draw(dirtyRect)
    }
}

class BrowserHoverButton: NSButton {
    var destructive = false
    var feedbackColor = NSColor.labelColor
    var restingColor: NSColor?
    var showsCompletionMark = false
    private var hovered = false
    private var hoverTracking: NSTrackingArea?

    override var alignmentRectInsets: NSEdgeInsets { NSEdgeInsetsZero }

    override func updateTrackingAreas() {
        if let tracking = hoverTracking { removeTrackingArea(tracking) }
        let tracking = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
        addTrackingArea(tracking)
        hoverTracking = tracking
        super.updateTrackingAreas()
    }

    override func mouseEntered(with event: NSEvent) {
        hovered = true
        if destructive { contentTintColor = .white }
        needsDisplay = true
    }
    override func mouseExited(with event: NSEvent) {
        hovered = false
        if destructive { contentTintColor = isHighlighted ? .white : .secondaryLabelColor }
        needsDisplay = true
    }
    override func highlight(_ flag: Bool) {
        super.highlight(flag)
        if destructive { contentTintColor = (hovered || flag) ? .white : .secondaryLabelColor }
        if !destructive { (superview as? BrowserWindowChip)?.pressed = flag }
    }

    override func draw(_ dirtyRect: NSRect) {
        let interactive = isEnabled && (hovered || isHighlighted)
        if let color = restingColor, !interactive {
            color.withAlphaComponent(0.12).setFill()
            NSBezierPath(roundedRect: bounds.insetBy(dx: 1, dy: 1), xRadius: 7, yRadius: 7).fill()
        }
        if interactive && (destructive || !(superview is BrowserWindowChip)) {
            let color = destructive ? NSColor.systemRed : feedbackColor
            let opacity: CGFloat = destructive ? (isHighlighted ? 0.65 : 0.85) : (restingColor != nil ? (isHighlighted ? 0.30 : 0.20) : (isHighlighted ? 0.22 : 0.12))
            color.withAlphaComponent(opacity).setFill()
            let inset: CGFloat = destructive ? 3 : 1
            NSBezierPath(roundedRect: bounds.insetBy(dx: inset, dy: inset), xRadius: 6, yRadius: 6).fill()
        }
        if showsCompletionMark {
            let attributes: [NSAttributedString.Key: Any] = [
                .font: font ?? NSFont.systemFont(ofSize: 12, weight: .medium),
                .foregroundColor: contentTintColor ?? NSColor.labelColor
            ]
            let textSize = (title as NSString).size(withAttributes: attributes)
            let markWidth: CGFloat = 10
            let gap: CGFloat = 6
            let left = (bounds.width - markWidth - gap - textSize.width) / 2
            let bottom = bounds.midY - 5
            let markY: (CGFloat) -> CGFloat = { self.isFlipped ? self.bounds.midY + 5 - $0 : bottom + $0 }
            let mark = NSBezierPath()
            mark.move(to: NSPoint(x: left, y: markY(4)))
            mark.line(to: NSPoint(x: left + 3.5, y: markY(1)))
            mark.line(to: NSPoint(x: left + markWidth, y: markY(9)))
            mark.lineWidth = 1.5
            mark.lineCapStyle = .round
            mark.lineJoinStyle = .round
            (contentTintColor ?? .labelColor).setStroke()
            mark.stroke()
            (title as NSString).draw(in: NSRect(x: left + markWidth + gap, y: bounds.midY - textSize.height / 2,
                                               width: textSize.width, height: textSize.height), withAttributes: attributes)
        } else {
            super.draw(dirtyRect)
        }
    }
}

private final class BrowserWindowChip: NSStackView {
    private var hovered = false
    private var hoverTracking: NSTrackingArea?
    var pressed = false {
        didSet { if pressed != oldValue { needsDisplay = true } }
    }
    var selected = false {
        didSet { if selected != oldValue { needsDisplay = true } }
    }

    override func updateTrackingAreas() {
        if let tracking = hoverTracking { removeTrackingArea(tracking) }
        let tracking = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
        addTrackingArea(tracking)
        hoverTracking = tracking
        super.updateTrackingAreas()
    }

    override func mouseEntered(with event: NSEvent) { hovered = true; needsDisplay = true }
    override func mouseExited(with event: NSEvent) { hovered = false; needsDisplay = true }
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        if selected || hovered || pressed {
            let color = NSColor.labelColor
            let opacity: CGFloat = pressed ? 0.16 : (hovered ? 0.10 : 0.05)
            color.withAlphaComponent(opacity).setFill()
            NSBezierPath(roundedRect: bounds.insetBy(dx: 0, dy: 1), xRadius: 7, yRadius: 7).fill()
            if selected {
                NSColor.controlAccentColor.setFill()
                NSBezierPath(roundedRect: NSRect(x: bounds.midX - 10, y: isFlipped ? bounds.maxY - 3 : 1, width: 20, height: 2), xRadius: 1, yRadius: 1).fill()
            }
        }
    }
}

private extension NSToolbarItem.Identifier {
    static let browserLauncher = Self("browserLauncher")
    static let workspaces = Self("workspaces")
    static let browserWindows = Self("browserWindows")
    static let browserActions = Self("browserActions")
    static let returnToAgent = Self("returnToAgent")
}

extension AppDelegate: NSToolbarDelegate {
    func configureBrowserToolbar(_ window: NSWindow) {
        let toolbar = NSToolbar(identifier: "browserControls")
        toolbar.delegate = self
        toolbar.displayMode = .iconOnly
        toolbar.allowsUserCustomization = false
        window.toolbar = toolbar
        window.toolbarStyle = .unifiedCompact
        window.titleVisibility = .hidden
    }

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [.workspaces, .flexibleSpace, .browserActions]
    }

    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        toolbarDefaultItemIdentifiers(toolbar)
    }

    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier identifier: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        let item = NSToolbarItem(itemIdentifier: identifier)
        if identifier == .workspaces {
            let picker = WorkspacePicker(frame: .zero, pullsDown: false)
            picker.cell = WorkspacePickerCell(textCell: "", pullsDown: false)
            picker.bezelStyle = .rounded
            picker.isBordered = false
            picker.font = .systemFont(ofSize: 12, weight: .medium)
            picker.target = self
            picker.action = #selector(selectWorkspace(_:))
            picker.addItem(withTitle: "user")
            picker.isEnabled = false
            picker.widthAnchor.constraint(equalToConstant: 150).isActive = true
            picker.heightAnchor.constraint(equalToConstant: 28).isActive = true
            workspacePicker = picker
            item.view = picker
            item.label = "workspace"
            item.isBordered = false
        } else if identifier == .browserLauncher {
            let button = BrowserHoverButton(image: desktopAppIcon("chromium"), target: self, action: #selector(launchBrowser))
            configureBrowserIcon(button)
            button.imageScaling = .scaleProportionallyDown
            button.contentTintColor = nil
            button.setAccessibilityLabel("open chromium")
            button.toolTip = "open or focus chromium in this workspace"
            item.view = button
            item.label = "browser"
            item.isBordered = false
        } else if identifier == .browserActions {
            let controls: [NSToolbarItem.Identifier] = [.returnToAgent]
            let views = controls.compactMap { self.toolbar(toolbar, itemForItemIdentifier: $0, willBeInsertedIntoToolbar: false)?.view }
            let group = NSStackView(views: views)
            group.orientation = .horizontal
            group.alignment = .centerY
            group.distribution = .fill
            group.spacing = 10
            group.heightAnchor.constraint(equalToConstant: 28).isActive = true
            item.view = group
            item.isBordered = false
            item.label = "computer controls"
        } else if identifier == .browserWindows {
            let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 420, height: 28))
            scroll.drawsBackground = false
            scroll.hasHorizontalScroller = true
            scroll.scrollerStyle = .overlay
            scroll.autohidesScrollers = true
            let stack = NSStackView()
            stack.orientation = .horizontal
            stack.spacing = 4
            stack.distribution = .fill
            stack.alignment = .centerY
            stack.frame = NSRect(x: 0, y: 0, width: 420, height: 28)
            scroll.documentView = stack
            windowStrip = scroll
            windowChips = stack
            item.view = scroll
            item.isBordered = false
            scroll.widthAnchor.constraint(greaterThanOrEqualToConstant: 180).isActive = true
            scroll.heightAnchor.constraint(equalToConstant: 28).isActive = true
            let preferredWidth = scroll.widthAnchor.constraint(equalToConstant: 420)
            preferredWidth.priority = .defaultLow
            preferredWidth.isActive = true
            item.label = "windows"
            renderBrowserWindows([])
        } else {
            let button: NSButton
            switch identifier {
            case .returnToAgent:
                let done = BrowserHoverButton(title: "done", target: self, action: #selector(finish))
                done.showsCompletionMark = true
                done.feedbackColor = .systemGreen
                done.restingColor = .systemGreen
                done.contentTintColor = .systemGreen
                done.isBordered = false
                done.widthAnchor.constraint(equalToConstant: 124).isActive = true
                done.heightAnchor.constraint(equalToConstant: 28).isActive = true
                controlButton = done
                button = done
                button.font = .systemFont(ofSize: 12, weight: .medium)
                button.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 11, weight: .medium)
                button.setAccessibilityLabel("done")
                button.toolTip = "close this window and let your agent use the computer"
                button.bezelStyle = .inline
                let icon = NSImageView()
                icon.image = NSImage(systemSymbolName: "eye", accessibilityDescription: nil)
                icon.contentTintColor = .secondaryLabelColor
                icon.widthAnchor.constraint(equalToConstant: 14).isActive = true
                icon.heightAnchor.constraint(equalToConstant: 14).isActive = true
                let state = NSTextField(labelWithString: "watching")
                state.font = .systemFont(ofSize: 12, weight: .medium)
                state.textColor = .secondaryLabelColor
                state.setContentCompressionResistancePriority(.required, for: .horizontal)
                let group = WorkspaceControlGroup(views: [icon, state, done])
                group.orientation = .horizontal
                group.alignment = .centerY
                group.spacing = 7
                group.edgeInsets = NSEdgeInsets(top: 0, left: 10, bottom: 0, right: 0)
                group.setCustomSpacing(12, after: state)
                group.heightAnchor.constraint(equalToConstant: 28).isActive = true
                controlModeLabel = state
                controlModeIcon = icon
                item.view = group
                item.isBordered = false
                item.label = "workspace control"
                updateAutomationControl()
                return item
            default: return nil
            }
            item.view = button
            item.isBordered = false
        }
        return item
    }

    private func configureBrowserIcon(_ button: NSButton) {
        button.bezelStyle = .inline
        button.isBordered = false
        button.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 13, weight: .medium)
        button.contentTintColor = .secondaryLabelColor
        button.widthAnchor.constraint(equalToConstant: 28).isActive = true
        button.heightAnchor.constraint(equalToConstant: 28).isActive = true
    }

    private func desktopAppIcon(_ app: String) -> NSImage {
        if app.lowercased().contains("chromium"),
           let resources = Bundle.main.resourceURL,
           let image = NSImage(contentsOf: resources.appendingPathComponent("runtime/src/assets/chromium.png")) {
            image.size = NSSize(width: 20, height: 20)
            return image
        }
        return NSImage(systemSymbolName: "app", accessibilityDescription: app)!
    }

    func configureAutomationBanner(_ window: NSWindow) {
        guard let toolbar = window.toolbar, let content = window.contentView,
              let tasks = self.toolbar(toolbar, itemForItemIdentifier: .browserWindows, willBeInsertedIntoToolbar: false)?.view else { return }
        let menu = BrowserHoverButton(image: NSImage(systemSymbolName: "square.grid.2x2", accessibilityDescription: "apps")!, target: self, action: #selector(showApps(_:)))
        configureBrowserIcon(menu)
        menu.toolTip = "apps · open or pin to taskbar"
        appMenuButton = menu
        let pins = AppPinStrip()
        pins.orientation = .horizontal
        pins.alignment = .centerY
        pins.spacing = 4
        pins.setContentHuggingPriority(.required, for: .horizontal)
        pins.onDrop = { [weak self] id, index in self?.movePin(id, to: index) }
        pinStripWidth = pins.widthAnchor.constraint(equalToConstant: 34)
        pinStripWidth?.isActive = true
        appPins = pins
        let label = NSTextField(labelWithString: "automation paused while open")
        label.font = .systemFont(ofSize: 11)
        label.textColor = .secondaryLabelColor
        label.alignment = .right
        label.setContentHuggingPriority(.required, for: .horizontal)
        let separator = NSBox()
        separator.boxType = .separator
        separator.widthAnchor.constraint(equalToConstant: 1).isActive = true
        separator.heightAnchor.constraint(equalToConstant: 20).isActive = true
        let row = NSStackView(views: [menu, pins, separator, tasks, label])
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 10
        label.setContentCompressionResistancePriority(.required, for: .horizontal)
        let view = NSVisualEffectView()
        view.material = .headerView
        view.blendingMode = .withinWindow
        view.state = .active
        view.translatesAutoresizingMaskIntoConstraints = false
        row.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(view)
        view.addSubview(row)
        NSLayoutConstraint.activate([
            view.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            view.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            view.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            view.heightAnchor.constraint(equalToConstant: 48),
            row.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            row.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -14),
            row.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
        desktopBar = view
        automationBanner = label
        updateAutomationControl()
        refreshApps()
    }

    func updateAutomationControl() {
        window?.title = selectedWorkspace == "shared" ? "igor vm · your desktop" : mode == "human" ? "igor vm · you have control" : "igor vm · watching"
        automationBanner?.isHidden = selectedWorkspace != "shared"
        let agentState = workspaceData.first(where: { $0["name"] as? String == selectedWorkspace })?["agentState"] as? String ?? "idle"
        controlModeLabel?.stringValue = selectedWorkspace == "shared" ? "your desktop" : mode == "human" ? "you have control" : "watching · " + agentState
        controlModeIcon?.contentTintColor = mode == "human" ? .systemGreen : agentState == "active" ? .systemGreen : .secondaryLabelColor
        controlModeLabel?.textColor = .labelColor
        controlModeIcon?.image = NSImage(systemSymbolName: mode == "human" ? "cursorarrow" : "eye", accessibilityDescription: nil)
        controlModeLabel?.toolTip = mode == "human" ? "this agent is paused while you control its workspace" : "live view · take control to interact"
        automationBanner?.stringValue = selectedWorkspace == "shared" ? (automationPaused ? "your desktop · automation is paused" : "your desktop · use it freely") : automationPaused ? "automation is paused" : mode == "human" ? "this workspace is paused · you have control" : "watching"
        controlButton?.isEnabled = !opening
        controlButton?.title = selectedWorkspace == "shared" ? "done" : mode == "human" ? (automationPaused ? "release control" : "resume agent") : "take control"
        controlButton?.setAccessibilityLabel(controlButton?.title ?? "take control")
        if let button = controlButton as? BrowserHoverButton {
            button.showsCompletionMark = mode == "human"
            button.restingColor = mode == "human" ? .systemGreen : .systemBlue
            button.feedbackColor = mode == "human" ? .systemGreen : .systemBlue
            button.contentTintColor = mode == "human" ? .systemGreen : .systemBlue
            button.needsDisplay = true
        }
        controlButton?.toolTip = selectedWorkspace == "shared" ? "close your desktop" : mode == "human" ? "resume this agent · keep watching" : "control this workspace · pause its agent"
    }

    func refreshBrowserWindows() {
        guard viewerOpen, window?.isVisible == true, !windowListRunning, !windowActionRunning else { return }
        windowListRunning = true
        request("/workspaces") { result in
            self.windowListRunning = false
            guard self.viewerOpen, self.window?.isVisible == true, !self.windowActionRunning else { return }
            switch result {
            case .success(let data):
                self.windowGeneration = data["generation"] as? String ?? ""
                let workspaces = data["workspaces"] as? [[String: Any]] ?? []
                self.renderWorkspaces(workspaces)
                self.updateAutomationControl()
                self.refreshApps()
                let desktop = workspaces.first(where: { $0["active"] as? Bool == true })?["desktop"] as? Int ?? 0
                let windows = (data["windows"] as? [[String: Any]] ?? []).filter { ($0["desktop"] as? Int) == desktop || ($0["desktop"] as? Int) == -1 }
                self.currentDesktopWindows = windows
                self.renderBrowserWindows(windows)
                for button in self.appPins?.arrangedSubviews.compactMap({ $0 as? AppPinButton }) ?? [] {
                    let key = String(button.appID.dropLast(".desktop".count)).lowercased()
                    button.running = windows.contains { ($0["app"] as? String ?? "").lowercased().contains(key) }
                }
                if self.browserNeedsFocus, let target = windows.first(where: { $0["active"] as? Bool == true }) ?? windows.first,
                   let id = target["id"] as? String {
                    self.browserNeedsFocus = false
                    self.browserWindowAction("focus", id: id)
                }
                self.windowStrip?.toolTip = nil
            case .failure(let error):
                self.windowStrip?.toolTip = error.localizedDescription
                self.renderBrowserWindows([], unavailable: true)
            }
        }
    }

    func renderWorkspaces(_ workspaces: [[String: Any]]) {
        guard let picker = workspacePicker else { return }
        workspaceData = workspaces
        let signature = ((try? JSONSerialization.data(withJSONObject: workspaces, options: [.sortedKeys]))?.base64EncodedString() ?? "") + mode
        guard signature != workspaceListSignature else { return }
        workspaceListSignature = signature
        (picker as? WorkspacePicker)?.workspaceTitles = [:]
        picker.removeAllItems()
        for workspace in workspaces {
            if workspace["personal"] as? Bool != true, picker.numberOfItems == 1 {
                picker.menu?.addItem(.separator())
            }
            let name = workspace["name"] as? String ?? "shared"
            (picker as? WorkspacePicker)?.workspaceTitles[name] = workspace["label"] as? String ?? name
            picker.addItem(withTitle: workspace["label"] as? String ?? name)
            if let agentState = workspace["agentState"] as? String {
                let suffix = agentState == "controlled" ? "your control" : agentState
                let label = workspace["label"] as? String ?? name
                let title = NSMutableAttributedString(string: label, attributes: [.foregroundColor: NSColor.labelColor])
                title.append(NSAttributedString(string: "  · " + suffix, attributes: [.foregroundColor: agentState == "active" ? NSColor.systemGreen : NSColor.secondaryLabelColor]))
                picker.lastItem?.attributedTitle = title
            }
            picker.lastItem?.representedObject = name
            picker.lastItem?.image = workspacePicture(workspace)
            if workspace["active"] as? Bool == true { picker.select(picker.lastItem); selectedWorkspace = name }
        }
        picker.isEnabled = true
    }

    @objc func selectWorkspace(_ sender: NSPopUpButton) {
        guard let name = sender.selectedItem?.representedObject as? String, !windowActionRunning else { return }
        let args: [String: Any] = ["action": "select", "name": name]
        if name == selectedWorkspace { return }
        if let workspace = workspaceData.first(where: { $0["name"] as? String == name }),
           let data = try? JSONSerialization.data(withJSONObject: workspace), let json = String(data: data, encoding: .utf8) {
            webView?.evaluateJavaScript("window.workspaceTransition?.begin(" + json + ")")
        } else { webView?.evaluateJavaScript("window.workspaceTransition?.begin()") }
        windowActionRunning = true
        sender.isEnabled = false
        request("/workspaces", post: true, arguments: args) { result in
            self.windowActionRunning = false
            self.workspaceListSignature = ""
            self.webView?.evaluateJavaScript("window.refreshOwnership?.(); window.workspaceTransition?.end()")
            self.poll()
            if case .failure(let error) = result { self.showError(error.localizedDescription) }
            self.refreshBrowserWindows()
        }
    }

    @objc func launchBrowser() {
        guard mode == "human", !windowActionRunning else { return }
        windowActionRunning = true
        request("/workspaces", post: true, arguments: ["action": "open_browser", "reuse": true]) { result in
            self.windowActionRunning = false
            if case .failure(let error) = result { self.showError(error.localizedDescription) }
            self.refreshBrowserWindows()
            self.window?.makeFirstResponder(self.webView)
            self.webView?.evaluateJavaScript("document.querySelector('canvas')?.focus()")
        }
    }

    func renderBrowserWindows(_ windows: [[String: Any]], unavailable: Bool = false) {
        let signature = String(describing: windows.map { [$0["id"] ?? "", $0["title"] ?? "", $0["app"] ?? ""] }) + String(unavailable) + windowGeneration + mode
        guard let stack = windowChips else { return }
        if signature == windowListSignature {
            updateBrowserWindowSelection(windows)
            return
        }
        windowListSignature = signature
        for view in stack.arrangedSubviews { stack.removeArrangedSubview(view); view.removeFromSuperview() }
        var width: CGFloat = 0
        if windows.isEmpty {
            let label = NSTextField(labelWithString: unavailable ? "windows unavailable · retrying…" : "no open windows")
            label.font = .systemFont(ofSize: 12)
            label.textColor = .secondaryLabelColor
            stack.addArrangedSubview(label)
            width = 170
        }
        for entry in windows {
            guard let id = entry["id"] as? String else { continue }
            let fullTitle = entry["title"] as? String ?? "untitled"
            var title = fullTitle.hasSuffix(" - Chromium") ? String(fullTitle.dropLast(11)) : fullTitle
            if title == "about:blank" { title = "blank tab" }
            else if title == "New Tab" { title = "new tab" }
            let focus = BrowserHoverButton(title: title, target: self, action: #selector(focusBrowserWindow(_:)))
            focus.image = desktopAppIcon(entry["app"] as? String ?? "")
            focus.imagePosition = .imageLeading
            focus.imageScaling = .scaleProportionallyDown
            focus.bezelStyle = .inline
            focus.isBordered = false
            focus.isEnabled = mode == "human"
            focus.setButtonType(.momentaryChange)
            focus.state = entry["active"] as? Bool == true ? .on : .off
            focus.font = .systemFont(ofSize: 12, weight: .medium)
            focus.contentTintColor = nil
            focus.lineBreakMode = .byTruncatingTail
            focus.identifier = NSUserInterfaceItemIdentifier(id + ":" + windowGeneration)
            focus.toolTip = title
            let buttonWidth = ceil(min(180, max(64, (title as NSString).size(withAttributes: [.font: focus.font!]).width + 48)))
            focus.widthAnchor.constraint(equalToConstant: buttonWidth).isActive = true
            focus.heightAnchor.constraint(equalToConstant: 28).isActive = true
            let close = BrowserHoverButton(image: NSImage(systemSymbolName: "xmark", accessibilityDescription: "close " + title)!, target: self, action: #selector(closeBrowserWindow(_:)))
            close.identifier = NSUserInterfaceItemIdentifier(id + ":" + windowGeneration)
            close.bezelStyle = .inline
            close.isBordered = false
            close.toolTip = "close " + title
            close.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 10, weight: .semibold)
            close.isEnabled = mode == "human"
            close.destructive = true
            close.contentTintColor = .secondaryLabelColor
            close.widthAnchor.constraint(equalToConstant: 28).isActive = true
            close.heightAnchor.constraint(equalToConstant: 28).isActive = true
            let group = BrowserWindowChip(views: [focus, close])
            group.selected = entry["active"] as? Bool == true
            group.orientation = .horizontal
            group.alignment = .centerY
            group.distribution = .fill
            group.spacing = 1
            group.widthAnchor.constraint(equalToConstant: buttonWidth + 29).isActive = true
            group.heightAnchor.constraint(equalToConstant: 28).isActive = true
            stack.addArrangedSubview(group)
            if width > 0 { width += stack.spacing }
            width += buttonWidth + 29
        }
        stack.setFrameSize(NSSize(width: max(width, 1), height: 28))
        stack.layoutSubtreeIfNeeded()
    }

    func updateBrowserWindowSelection(_ windows: [[String: Any]]) {
        guard let stack = windowChips else { return }
        let active = Set(windows.filter { $0["active"] as? Bool == true }.compactMap { $0["id"] as? String })
        for group in stack.arrangedSubviews.compactMap({ $0 as? NSStackView }) {
            guard let focus = group.arrangedSubviews.first as? NSButton,
                  let id = focus.identifier?.rawValue.split(separator: ":").first else { continue }
            let selected = active.contains(String(id))
            focus.state = selected ? .on : .off
            (group as? BrowserWindowChip)?.selected = selected
        }
    }

    @objc func focusBrowserWindow(_ sender: NSButton) { browserWindowButtonAction("focus", sender: sender) }
    @objc func closeBrowserWindow(_ sender: NSButton) { browserWindowButtonAction("close", sender: sender) }
    func browserWindowButtonAction(_ action: String, sender: NSButton) {
        guard let parts = sender.identifier?.rawValue.split(separator: ":"), parts.count == 2 else { return }
        browserWindowAction(action, id: String(parts[0]), generation: String(parts[1]))
    }
    @objc func restoreBrowserWindows() { browserWindowAction("restore") }

    func browserWindowAction(_ action: String, id: String? = nil, generation: String? = nil) {
        guard viewerOpen, mode == "human", !windowActionRunning else { return }
        windowActionRunning = true
        var arguments: [String: Any] = ["action": action, "generation": generation ?? windowGeneration]
        if let id = id { arguments["id"] = id }
        request("/windows", post: true, arguments: arguments) { result in
            self.windowActionRunning = false
            if case .failure(let error) = result { self.showError(error.localizedDescription) }
            if case .success = result, self.mode == "human", self.window?.isKeyWindow == true {
                self.window?.makeFirstResponder(self.webView)
                self.webView?.evaluateJavaScript("document.querySelector('canvas')?.focus()")
            }
            self.refreshBrowserWindows()
        }
    }
}
