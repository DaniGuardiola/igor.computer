import AppKit

private final class BrowserHoverButton: NSButton {
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
            let color = selected ? NSColor.controlAccentColor : NSColor.labelColor
            let opacity: CGFloat = selected ? (pressed ? 0.30 : (hovered ? 0.24 : 0.16)) : (pressed ? 0.14 : 0.08)
            color.withAlphaComponent(opacity).setFill()
            NSBezierPath(roundedRect: bounds.insetBy(dx: 0, dy: 1), xRadius: 7, yRadius: 7).fill()
        }
    }
}

private extension NSToolbarItem.Identifier {
    static let workspaces = Self("workspaces")
    static let browserWindows = Self("browserWindows")
    static let browserActions = Self("browserActions")
    static let restoreWindows = Self("restoreWindows")
    static let hideBrowser = Self("hideBrowser")
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
        [.workspaces, .browserWindows, .flexibleSpace, .browserActions]
    }

    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        toolbarDefaultItemIdentifiers(toolbar)
    }

    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier identifier: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        let item = NSToolbarItem(itemIdentifier: identifier)
        if identifier == .workspaces {
            let picker = NSPopUpButton(frame: .zero, pullsDown: false)
            picker.bezelStyle = .rounded
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
        } else if identifier == .browserActions {
            let controls: [NSToolbarItem.Identifier] = [.restoreWindows, .hideBrowser, .returnToAgent]
            let views = controls.compactMap { self.toolbar(toolbar, itemForItemIdentifier: $0, willBeInsertedIntoToolbar: false)?.view }
            let group = NSStackView(views: views)
            group.orientation = .horizontal
            group.alignment = .centerY
            group.distribution = .fill
            group.spacing = 10
            // The reset glyph sits inside a wider hit target; compensate visually.
            if let reset = views.first { group.setCustomSpacing(4, after: reset) }
            group.heightAnchor.constraint(equalToConstant: 28).isActive = true
            item.view = group
            item.isBordered = false
            item.label = "computer controls"
        } else if identifier == .browserWindows {
            let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 460, height: 28))
            scroll.drawsBackground = false
            scroll.hasHorizontalScroller = true
            scroll.scrollerStyle = .overlay
            scroll.autohidesScrollers = true
            let stack = NSStackView()
            stack.orientation = .horizontal
            stack.spacing = 4
            stack.distribution = .fill
            stack.alignment = .centerY
            stack.frame = NSRect(x: 0, y: 0, width: 460, height: 28)
            scroll.documentView = stack
            windowStrip = scroll
            windowChips = stack
            item.view = scroll
            item.isBordered = false
            scroll.widthAnchor.constraint(greaterThanOrEqualToConstant: 180).isActive = true
            scroll.heightAnchor.constraint(equalToConstant: 28).isActive = true
            let preferredWidth = scroll.widthAnchor.constraint(equalToConstant: 460)
            preferredWidth.priority = .defaultLow
            preferredWidth.isActive = true
            item.label = "windows"
            renderBrowserWindows([])
        } else {
            let button: NSButton
            switch identifier {
            case .restoreWindows:
                button = BrowserHoverButton(image: NSImage(systemSymbolName: "arrow.counterclockwise", accessibilityDescription: "restore windows")!, target: self, action: #selector(restoreBrowserWindows))
                button.toolTip = "restore and maximize windows"
                configureBrowserIcon(button)
                item.label = "restore"
            case .hideBrowser:
                let toggle = NSSwitch()
                toggle.target = self
                toggle.action = #selector(togglePause)
                toggle.controlSize = .mini
                toggle.setAccessibilityLabel("automation")
                let label = NSTextField(labelWithString: "automation")
                label.font = .systemFont(ofSize: 11, weight: .medium)
                label.textColor = .secondaryLabelColor
                let group = NSStackView(views: [label, toggle])
                group.orientation = .horizontal
                group.alignment = .centerY
                group.spacing = 5
                automationSwitch = toggle
                updateAutomationControl()
                item.view = group
                item.isBordered = false
                item.label = "automation"
                return item
            case .returnToAgent:
                let done = BrowserHoverButton(title: "done", target: self, action: #selector(finish))
                done.showsCompletionMark = true
                done.feedbackColor = .systemGreen
                done.restingColor = .systemGreen
                done.contentTintColor = .systemGreen
                done.isBordered = false
                done.widthAnchor.constraint(equalToConstant: 78).isActive = true
                done.heightAnchor.constraint(equalToConstant: 28).isActive = true
                button = done
                button.font = .systemFont(ofSize: 12, weight: .medium)
                button.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 11, weight: .medium)
                button.setAccessibilityLabel("done")
                button.toolTip = "close this window and let your agent use the computer"
                button.bezelStyle = .inline
                item.label = "done"
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

    func configureAutomationBanner(_ window: NSWindow) {
        let label = NSTextField(labelWithString: "automation is paused while this window is open")
        label.font = .systemFont(ofSize: 11)
        label.textColor = .secondaryLabelColor
        label.alignment = .center
        let view = NSView(frame: NSRect(x: 0, y: 0, width: 600, height: 26))
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 16),
            label.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -16)
        ])
        let accessory = NSTitlebarAccessoryViewController()
        accessory.view = view
        accessory.layoutAttribute = .bottom
        window.addTitlebarAccessoryViewController(accessory)
        automationBanner = label
        updateAutomationControl()
    }

    func updateAutomationControl() {
        automationSwitch?.state = automationPaused ? .off : .on
        automationSwitch?.isEnabled = !pauseChangeRunning
        automationSwitch?.toolTip = automationPaused ? "automation stays paused after you close this window" : "automation resumes after you close this window"
        automationBanner?.stringValue = automationPaused ? "automation is paused · stays paused after closing" : "automation is paused while this window is open"
        if let group = window?.toolbar?.items.first(where: { $0.itemIdentifier == .browserActions })?.view as? NSStackView,
           let done = group.arrangedSubviews.last as? NSButton {
            done.toolTip = automationPaused ? "close this window · keep automation paused" : "close this window · resume automation"
        }
    }

    func refreshBrowserWindows() {
        guard mode == "human", window?.isVisible == true, !windowListRunning, !windowActionRunning else { return }
        windowListRunning = true
        request("/workspaces") { result in
            self.windowListRunning = false
            guard self.mode == "human", self.window?.isVisible == true, !self.windowActionRunning else { return }
            switch result {
            case .success(let data):
                self.windowGeneration = data["generation"] as? String ?? ""
                let workspaces = data["workspaces"] as? [[String: Any]] ?? []
                self.renderWorkspaces(workspaces)
                let desktop = workspaces.first(where: { $0["active"] as? Bool == true })?["desktop"] as? Int ?? 0
                let windows = (data["windows"] as? [[String: Any]] ?? []).filter { ($0["desktop"] as? Int) == desktop || ($0["desktop"] as? Int) == -1 }
                self.renderBrowserWindows(windows)
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
        let signature = String(describing: workspaces)
        guard signature != workspaceListSignature else { return }
        workspaceListSignature = signature
        picker.removeAllItems()
        for workspace in workspaces {
            let name = workspace["name"] as? String ?? "shared"
            picker.addItem(withTitle: workspace["label"] as? String ?? name)
            picker.lastItem?.representedObject = name
            if workspace["active"] as? Bool == true { picker.select(picker.lastItem); selectedWorkspace = name }
        }
        picker.menu?.addItem(.separator())
        picker.addItem(withTitle: "open browser window")
        picker.lastItem?.representedObject = "__browser"
        picker.addItem(withTitle: "new workspace…")
        picker.lastItem?.representedObject = "__new"
        picker.isEnabled = true
    }

    @objc func selectWorkspace(_ sender: NSPopUpButton) {
        guard let name = sender.selectedItem?.representedObject as? String, !windowActionRunning else { return }
        var args: [String: Any] = ["action": "select", "name": name]
        if name == "__browser" {
            args = ["action": "open_browser"]
        }
        if name == "__new" {
            let alert = NSAlert()
            alert.messageText = "new workspace"
            let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
            input.placeholderString = "workspace name"
            alert.accessoryView = input
            alert.addButton(withTitle: "create")
            alert.addButton(withTitle: "cancel")
            guard alert.runModal() == .alertFirstButtonReturn else { workspaceListSignature = ""; refreshBrowserWindows(); return }
            let label = input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !label.isEmpty else { workspaceListSignature = ""; refreshBrowserWindows(); return }
            args = ["action": "create", "name": "workspace-" + UUID().uuidString.lowercased(), "label": label]
        }
        windowActionRunning = true
        sender.isEnabled = false
        request("/workspaces", post: true, arguments: args) { result in
            self.windowActionRunning = false
            self.workspaceListSignature = ""
            if case .failure(let error) = result { self.showError(error.localizedDescription) }
            self.refreshBrowserWindows()
        }
    }

    func renderBrowserWindows(_ windows: [[String: Any]], unavailable: Bool = false) {
        let signature = String(describing: windows.map { [$0["id"] ?? "", $0["title"] ?? ""] }) + String(unavailable) + windowGeneration
        guard let stack = windowChips else { return }
        if signature == windowListSignature {
            updateBrowserWindowSelection(windows)
            return
        }
        windowListSignature = signature
        for view in stack.arrangedSubviews { stack.removeArrangedSubview(view); view.removeFromSuperview() }
        var width: CGFloat = 0
        if windows.isEmpty {
            let label = NSTextField(labelWithString: unavailable ? "windows unavailable · retrying…" : "no windows in this workspace")
            label.font = .systemFont(ofSize: 12)
            label.textColor = .secondaryLabelColor
            stack.addArrangedSubview(label)
            width = 230
        }
        for entry in windows {
            guard let id = entry["id"] as? String else { continue }
            let fullTitle = entry["title"] as? String ?? "untitled"
            var title = fullTitle.hasSuffix(" - Chromium") ? String(fullTitle.dropLast(11)) : fullTitle
            if title == "about:blank" { title = "blank tab" }
            else if title == "New Tab" { title = "new tab" }
            let focus = BrowserHoverButton(title: title, target: self, action: #selector(focusBrowserWindow(_:)))
            focus.bezelStyle = .inline
            focus.isBordered = false
            focus.setButtonType(.momentaryChange)
            focus.state = entry["active"] as? Bool == true ? .on : .off
            focus.font = .systemFont(ofSize: 12, weight: .medium)
            focus.contentTintColor = .labelColor
            focus.lineBreakMode = .byTruncatingTail
            focus.identifier = NSUserInterfaceItemIdentifier(id + ":" + windowGeneration)
            focus.toolTip = title
            let buttonWidth = ceil(min(180, max(64, (title as NSString).size(withAttributes: [.font: focus.font!]).width + 22)))
            focus.widthAnchor.constraint(equalToConstant: buttonWidth).isActive = true
            focus.heightAnchor.constraint(equalToConstant: 28).isActive = true
            let close = BrowserHoverButton(image: NSImage(systemSymbolName: "xmark", accessibilityDescription: "close " + title)!, target: self, action: #selector(closeBrowserWindow(_:)))
            close.identifier = NSUserInterfaceItemIdentifier(id + ":" + windowGeneration)
            close.bezelStyle = .inline
            close.isBordered = false
            close.toolTip = "close " + title
            close.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 10, weight: .semibold)
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
        guard mode == "human", !windowActionRunning else { return }
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
