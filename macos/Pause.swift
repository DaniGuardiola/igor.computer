import AppKit

extension AppDelegate {
    @objc func togglePause() {
        guard !pauseChangeRunning, ["agent", "paused", "human"].contains(mode) else { return }
        pauseChangeRunning = true
        let path = mode == "agent" ? "/pause" : "/resume"
        request(path, post: true) { result in
            self.pauseChangeRunning = false
            switch result {
            case .failure(let error): self.showError(error.localizedDescription)
            case .success(let status):
                self.mode = status["mode"] as? String ?? self.mode
                if self.mode == "agent" { self.hideWindow() }
            }
            self.updateMenu()
            self.poll()
        }
    }

    func menuWillOpen(_ menu: NSMenu) {
        statusMenuOpen = true
        pauseTip?.close()
    }

    func menuDidClose(_ menu: NSMenu) {
        statusMenuOpen = false
        schedulePauseTip()
    }

    func schedulePauseTip() {
        guard mode == "paused", !UserDefaults.standard.bool(forKey: "pauseTipShown") else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            guard let self = self, self.mode == "paused", !self.statusMenuOpen,
                  !UserDefaults.standard.bool(forKey: "pauseTipShown"),
                  let button = self.item.button, button.window?.isVisible == true else { return }
            self.showPauseTip(relativeTo: button)
        }
    }

    func showPauseTip(relativeTo button: NSStatusBarButton) {
        let controller = NSViewController()
        let view = NSView(frame: NSRect(x: 0, y: 0, width: 300, height: 150))
        controller.view = view
        let title = NSTextField(labelWithString: "browser paused")
        title.font = .systemFont(ofSize: 14, weight: .semibold)
        let detail = NSTextField(wrappingLabelWithString: "your agent can't use the browser while paused. choose resume automation from this menu when you're ready.")
        detail.font = .systemFont(ofSize: 13)
        detail.textColor = .secondaryLabelColor
        let done = NSButton(title: "got it", target: self, action: #selector(dismissPauseTip))
        done.bezelStyle = .rounded
        let stack = NSStackView(views: [title, detail, done])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 18),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -18),
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 18),
            detail.widthAnchor.constraint(equalTo: stack.widthAnchor)
        ])
        let popover = NSPopover()
        popover.contentViewController = controller
        popover.contentSize = view.frame.size
        // Keep the explanation visible without activating a background app.
        // Opening the menu, resuming, or choosing "got it" dismisses it.
        popover.behavior = .applicationDefined
        popover.animates = !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        pauseTip = popover
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        if popover.isShown { UserDefaults.standard.set(true, forKey: "pauseTipShown") }
    }

    @objc func dismissPauseTip() { pauseTip?.close() }
}
