import AppKit

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
            stack.spacing = 6
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
                button = NSButton(image: NSImage(systemSymbolName: "arrow.up.left.and.arrow.down.right", accessibilityDescription: "restore windows")!, target: self, action: #selector(restoreBrowserWindows))
                button.toolTip = "restore all browser windows"
                button.bezelStyle = .texturedRounded
                item.label = "restore"
            case .hideBrowser:
                button = NSButton(title: "hide", target: self, action: #selector(hideBrowser))
                button.toolTip = "hide browser · keep automation paused"
                button.bezelStyle = .texturedRounded
                item.label = "hide"
            case .returnToAgent:
                button = NSButton(title: "done", target: self, action: #selector(finish))
                button.toolTip = "return browser to your agent"
                button.bezelStyle = .rounded
                button.bezelColor = .controlAccentColor
                item.label = "done"
            default: return nil
            }
            item.view = button
        }
        return item
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
        let signature = String(describing: windows.map { [$0["id"] ?? "", $0["title"] ?? "", $0["active"] ?? false] }) + String(unavailable) + windowGeneration
        guard signature != windowListSignature, let stack = windowChips else { return }
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
            focus.bezelStyle = .rounded
            focus.setButtonType(.pushOnPushOff)
            focus.state = entry["active"] as? Bool == true ? .on : .off
            focus.font = .systemFont(ofSize: 12)
            focus.lineBreakMode = .byTruncatingTail
            focus.identifier = NSUserInterfaceItemIdentifier(id + ":" + windowGeneration)
            focus.toolTip = title
            let buttonWidth = min(180, max(64, (title as NSString).size(withAttributes: [.font: focus.font!]).width + 22))
            focus.widthAnchor.constraint(equalToConstant: buttonWidth).isActive = true
            let close = NSButton(image: NSImage(systemSymbolName: "xmark", accessibilityDescription: "close " + title)!, target: self, action: #selector(closeBrowserWindow(_:)))
            close.identifier = NSUserInterfaceItemIdentifier(id + ":" + windowGeneration)
            close.bezelStyle = .inline
            close.isBordered = false
            close.toolTip = "close " + title
            close.widthAnchor.constraint(equalToConstant: 20).isActive = true
            let group = NSStackView(views: [focus, close])
            group.spacing = 1
            stack.addArrangedSubview(group)
            width += buttonWidth + 21 + 6
        }
        stack.setFrameSize(NSSize(width: max(width, 1), height: 28))
        stack.layoutSubtreeIfNeeded()
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
            self.windowListSignature = ""
            self.refreshBrowserWindows()
        }
    }
}
