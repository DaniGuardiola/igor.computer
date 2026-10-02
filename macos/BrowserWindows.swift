import AppKit

private final class BrowserWindowChip: NSStackView {
    var selected = false {
        didSet { if selected != oldValue { needsDisplay = true } }
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        if selected {
            NSColor.controlAccentColor.withAlphaComponent(0.16).setFill()
            NSBezierPath(roundedRect: bounds.insetBy(dx: 0, dy: 1), xRadius: 7, yRadius: 7).fill()
        }
    }
}

private extension NSToolbarItem.Identifier {
    static let browserWindows = Self("browserWindows")
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
        [.browserWindows, .flexibleSpace, .restoreWindows, .hideBrowser, .returnToAgent]
    }

    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        toolbarDefaultItemIdentifiers(toolbar)
    }

    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier identifier: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        let item = NSToolbarItem(itemIdentifier: identifier)
        if identifier == .browserWindows {
            let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 650, height: 28))
            scroll.drawsBackground = false
            scroll.hasHorizontalScroller = true
            scroll.scrollerStyle = .overlay
            scroll.autohidesScrollers = true
            let stack = NSStackView()
            stack.orientation = .horizontal
            stack.spacing = 4
            stack.distribution = .fill
            stack.alignment = .centerY
            stack.frame = NSRect(x: 0, y: 0, width: 650, height: 28)
            scroll.documentView = stack
            windowStrip = scroll
            windowChips = stack
            item.view = scroll
            item.isBordered = false
            scroll.widthAnchor.constraint(greaterThanOrEqualToConstant: 180).isActive = true
            scroll.heightAnchor.constraint(equalToConstant: 28).isActive = true
            let preferredWidth = scroll.widthAnchor.constraint(equalToConstant: 650)
            preferredWidth.priority = .defaultLow
            preferredWidth.isActive = true
            item.label = "windows"
            renderBrowserWindows([])
        } else {
            let button: NSButton
            switch identifier {
            case .restoreWindows:
                button = NSButton(image: NSImage(systemSymbolName: "arrow.counterclockwise", accessibilityDescription: "restore windows")!, target: self, action: #selector(restoreBrowserWindows))
                button.toolTip = "bring all browser windows back and maximize them"
                configureBrowserIcon(button)
                item.label = "restore"
            case .hideBrowser:
                button = NSButton(image: NSImage(systemSymbolName: "pause", accessibilityDescription: "close & pause")!, target: self, action: #selector(hideBrowser))
                button.toolTip = "close this window and keep your agent paused"
                configureBrowserIcon(button)
                item.label = "close & pause"
            case .returnToAgent:
                button = NSButton(title: "done", image: NSImage(systemSymbolName: "arrow.right", accessibilityDescription: nil)!, target: self, action: #selector(finish))
                button.imagePosition = .imageTrailing
                button.font = .systemFont(ofSize: 12, weight: .medium)
                button.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 11, weight: .medium)
                button.setAccessibilityLabel("done & resume")
                button.toolTip = "close this window and let your agent use the browser"
                button.bezelStyle = .rounded
                button.bezelColor = .controlAccentColor
                item.label = "done & resume"
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

    func refreshBrowserWindows() {
        guard mode == "human", window?.isVisible == true, !windowListRunning, !windowActionRunning else { return }
        windowListRunning = true
        request("/windows") { result in
            self.windowListRunning = false
            guard self.mode == "human", self.window?.isVisible == true else { return }
            switch result {
            case .success(let data):
                self.windowGeneration = data["generation"] as? String ?? ""
                let windows = data["windows"] as? [[String: Any]] ?? []
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
            let label = NSTextField(labelWithString: unavailable ? "windows unavailable · retrying…" : "opening browser…")
            label.font = .systemFont(ofSize: 12)
            label.textColor = .secondaryLabelColor
            stack.addArrangedSubview(label)
            width = 230
        }
        for entry in windows {
            guard let id = entry["id"] as? String else { continue }
            let fullTitle = entry["title"] as? String ?? "browser"
            var title = fullTitle.hasSuffix(" - Chromium") ? String(fullTitle.dropLast(11)) : fullTitle
            if title == "about:blank" { title = "blank tab" }
            else if title == "New Tab" { title = "new tab" }
            let focus = NSButton(title: title, target: self, action: #selector(focusBrowserWindow(_:)))
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
            let close = NSButton(image: NSImage(systemSymbolName: "xmark", accessibilityDescription: "close " + title)!, target: self, action: #selector(closeBrowserWindow(_:)))
            close.identifier = NSUserInterfaceItemIdentifier(id + ":" + windowGeneration)
            close.bezelStyle = .inline
            close.isBordered = false
            close.toolTip = "close " + title
            close.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 9, weight: .medium)
            close.contentTintColor = .secondaryLabelColor
            close.widthAnchor.constraint(equalToConstant: 20).isActive = true
            let group = BrowserWindowChip(views: [focus, close])
            group.selected = entry["active"] as? Bool == true
            group.orientation = .horizontal
            group.alignment = .centerY
            group.distribution = .fill
            group.spacing = 1
            group.widthAnchor.constraint(equalToConstant: buttonWidth + 21).isActive = true
            group.heightAnchor.constraint(equalToConstant: 28).isActive = true
            stack.addArrangedSubview(group)
            if width > 0 { width += stack.spacing }
            width += buttonWidth + 21
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
