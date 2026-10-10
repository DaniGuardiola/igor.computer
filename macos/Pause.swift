import AppKit

extension AppDelegate {
    @objc func togglePause() {
        guard !pauseChangeRunning, ["agent", "paused", "human"].contains(mode) else { return }
        pauseChangeRunning = true
        updateAutomationControl()
        request("/automation-pause", post: true, arguments: ["paused": !automationPaused]) { result in
            self.pauseChangeRunning = false
            switch result {
            case .failure(let error): self.showError(error.localizedDescription)
            case .success(let status):
                self.mode = status["mode"] as? String ?? self.mode
                self.automationPaused = status["automationPaused"] as? Bool ?? false
                self.updateAutomationControl()
                if !self.automationPaused { self.pauseTip?.close() }
            }
            self.updateAutomationControl()
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

    func schedulePauseTip(force: Bool = false) {
        guard mode == "paused", force || !UserDefaults.standard.bool(forKey: "pauseTipShown") else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            guard let self = self, self.mode == "paused", !self.statusMenuOpen,
                  (force || !UserDefaults.standard.bool(forKey: "pauseTipShown")),
                  self.pauseTip?.isShown != true,
                  let button = self.item.button, button.window?.isVisible == true else { return }
            self.showPauseTip(relativeTo: button)
        }
    }

    func showPauseTip(relativeTo button: NSStatusBarButton) {
        let controller = NSViewController()
        let view = NSView(frame: NSRect(x: 0, y: 0, width: 300, height: 150))
        controller.view = view
        let title = NSTextField(labelWithString: "vm paused")
        title.font = .systemFont(ofSize: 14, weight: .semibold)
        let detail = NSTextField(wrappingLabelWithString: "the computer is hidden and automation is still paused. choose resume automation from this menu when you're ready.")
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
