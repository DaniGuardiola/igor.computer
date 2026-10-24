import AppKit
import ApplicationServices
import UserNotifications
import ServiceManagement

extension AppDelegate {
    func refreshSetup() {
        guard !permissionCheckRunning else { return }
        permissionCheckRunning = true
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            DispatchQueue.main.async {
                self.permissionCheckRunning = false
                self.permissionsChecked = true
                self.notificationDetermined = settings.authorizationStatus != .notDetermined
                self.notificationAllowed = settings.authorizationStatus == .authorized
                // Alert authorization stays enabled when Desktop is unchecked; style becomes .none.
                self.notificationDesktop = settings.alertSetting == .enabled && settings.alertStyle != .none
                self.notificationCenterEnabled = settings.notificationCenterSetting == .enabled
                switch settings.alertStyle {
                case .banner: self.notificationStyle = "temporary"
                case .alert: self.notificationStyle = "persistent"
                case .none: self.notificationStyle = "off"
                @unknown default: self.notificationStyle = "unknown"
                }
                self.notificationReady = self.notificationAllowed
                self.writeAppStatus()
                self.settingsGuide?.refresh()
                if !self.startupInspected {
                    self.startupInspected = true
                    if !self.notificationReady || !self.loginReady || !self.installedCorrectly { self.showSetup() }
                }
                self.renderSetup()
                self.updateMenu()
            }
        }
    }

    func writeAppStatus() {
        let directory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/igor.computer")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let data = try JSONSerialization.data(withJSONObject: [
                "checkedAt": Date().timeIntervalSince1970 * 1000,
                "notifications": notificationReady && notificationError == nil,
                "notificationSettings": ["allowed": notificationAllowed, "desktop": notificationDesktop, "notificationCenter": notificationCenterEnabled, "style": notificationStyle],
                "login": loginReady,
                "guide": ["accessibilityTrusted": AXIsProcessTrusted(), "targetFound": settingsGuide?.target != nil, "targeted": settingsGuide?.appearance.targeted == true, "estimated": settingsGuide?.estimated == true, "pointer": String(describing: settingsGuide?.appearance.side ?? .none), "step": String(describing: notificationGuideStep)]
            ])
            let url = directory.appendingPathComponent("app-status.json")
            try data.write(to: url, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        } catch { startupError = "could not save app readiness: " + error.localizedDescription }
    }

    @objc func showSetup(_ sender: Any? = nil) {
        setupKeepOpen = (sender as? NSMenuItem)?.title == "settings…" || CommandLine.arguments.contains("--setup")
        if setupWindow == nil { makeSetupWindow() }
        renderSetup()
        prepareVisibleInterface()
        NSApp.activate(ignoringOtherApps: true)
        setupWindow?.makeKeyAndOrderFront(nil)
    }

    func makeSetupWindow() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 440), styleMask: [.titled, .closable, .fullSizeContentView], backing: .buffered, defer: false)
        window.title = "igor.computer"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        for button in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
            window.standardWindowButton(button)?.isHidden = true
        }
        window.hidesOnDeactivate = false
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.center()
        let view = AppearanceSurface()
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        window.contentView = view

        let globe = NSImageView(image: NSImage(systemSymbolName: "globe", accessibilityDescription: nil)!)
        globe.contentTintColor = .controlAccentColor
        globe.symbolConfiguration = .init(pointSize: 32, weight: .regular)
        globe.widthAnchor.constraint(equalToConstant: 42).isActive = true
        let title = NSTextField(labelWithString: "igor.computer")
        title.font = .systemFont(ofSize: 22, weight: .semibold)
        let subtitle = NSTextField(wrappingLabelWithString: "a computer for your agent.")
        subtitle.font = .systemFont(ofSize: 13)
        subtitle.textColor = .secondaryLabelColor
        let headerText = NSStackView(views: [title, subtitle])
        headerText.orientation = .vertical; headerText.alignment = .leading; headerText.spacing = 6
        let header = NSStackView(views: [globe, headerText]); header.spacing = 14

        let card = AppearanceCard()
        card.orientation = .vertical; card.alignment = .leading; card.spacing = 0
        card.wantsLayer = true
        card.layer?.cornerRadius = 12
        card.layer?.borderWidth = 1
        card.layer?.borderColor = NSColor.separatorColor.cgColor
        card.layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
        let rows: [(String, String, Selector)] = [
            ("install", "applications", #selector(openApplications)),
            ("runtime", "computer", #selector(retryRuntime)),
            ("notifications", "help notifications", #selector(enableNotifications)),
            ("login", "start at login", #selector(toggleLogin))
        ]
        for (key, name, action) in rows {
            let row = NSView()
            let icon = NSImageView(image: NSImage(systemSymbolName: "circle", accessibilityDescription: "checking")!)
            icon.symbolConfiguration = .init(pointSize: 17, weight: .medium)
            let heading = NSTextField(labelWithString: name)
            heading.font = .systemFont(ofSize: 13, weight: .medium)
            let detail = NSTextField(wrappingLabelWithString: "checking…")
            detail.font = .systemFont(ofSize: 12)
            detail.textColor = .secondaryLabelColor
            let text = NSStackView(views: [heading, detail])
            text.orientation = .vertical; text.alignment = .leading; text.spacing = 4
            let button = NSButton(title: "continue", target: self, action: action)
            button.bezelStyle = .rounded; button.controlSize = .small
            for subview in [icon, text, button] { subview.translatesAutoresizingMaskIntoConstraints = false; row.addSubview(subview) }
            NSLayoutConstraint.activate([
                row.heightAnchor.constraint(equalToConstant: 76),
                icon.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 16),
                icon.centerYAnchor.constraint(equalTo: row.centerYAnchor),
                icon.widthAnchor.constraint(equalToConstant: 22),
                text.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 12),
                text.centerYAnchor.constraint(equalTo: row.centerYAnchor),
                text.trailingAnchor.constraint(lessThanOrEqualTo: button.leadingAnchor, constant: -12),
                button.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -16),
                button.centerYAnchor.constraint(equalTo: row.centerYAnchor),
                button.widthAnchor.constraint(equalToConstant: 98)
            ])
            if key == "login" {
                let toggle = NSSwitch()
                toggle.target = self; toggle.action = #selector(toggleLogin)
                toggle.translatesAutoresizingMaskIntoConstraints = false; row.addSubview(toggle)
                NSLayoutConstraint.activate([toggle.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -16), toggle.centerYAnchor.constraint(equalTo: row.centerYAnchor)])
                setupLoginSwitch = toggle
            }
            card.addArrangedSubview(row)
            row.widthAnchor.constraint(equalTo: card.widthAnchor).isActive = true
            setupRows[key] = row; setupIcons[key] = icon
            setupLabels[key] = detail; setupButtons[key] = button
        }
        let summary = NSTextField(wrappingLabelWithString: "")
        summary.font = .systemFont(ofSize: 12)
        summary.textColor = .secondaryLabelColor
        let done = NSButton(title: "done", target: self, action: #selector(closeSetup))
        done.bezelStyle = .rounded
        let primary = NSButton(title: "open computer", target: self, action: #selector(openBrowserFromSetup))
        primary.bezelStyle = .rounded; primary.keyEquivalent = "\r"
        primary.bezelColor = .controlAccentColor
        let logs = NSButton(title: "view log", target: self, action: #selector(openLog))
        logs.bezelStyle = .rounded; logs.controlSize = .small
        let spacer = NSView()
        let footer = NSStackView(views: [logs, spacer, done, primary]); footer.spacing = 10
        let appearanceTitle = NSTextField(labelWithString: "appearance")
        appearanceTitle.font = .systemFont(ofSize: 13, weight: .medium)
        let theme = NSSegmentedControl(labels: ["system", "light", "dark"], trackingMode: .selectOne, target: self, action: #selector(changeAppearance(_:)))
        theme.selectedSegment = ["system", "light", "dark"].firstIndex(of: appearanceMode) ?? 0
        theme.toolTip = "system follows your Mac's appearance"
        theme.setAccessibilityLabel("appearance")
        for index in 0..<3 { theme.setWidth(62, forSegment: index) }
        appearancePicker = theme
        let appearanceRow = NSStackView(views: [appearanceTitle, NSView(), theme])
        appearanceRow.alignment = .centerY
        let stack = NSStackView(views: [header, card, appearanceRow, summary, footer])
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 20
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 24),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            card.widthAnchor.constraint(equalTo: stack.widthAnchor),
            appearanceRow.widthAnchor.constraint(equalTo: stack.widthAnchor),
            summary.widthAnchor.constraint(equalTo: stack.widthAnchor),
            footer.widthAnchor.constraint(equalTo: stack.widthAnchor)
        ])
        setupHeading = title; setupDescription = subtitle
        setupPrimary = primary; setupLog = logs
        setupSummary = summary; setupWindow = window
        if let index = CommandLine.arguments.firstIndex(of: "--capture-setup"), index + 1 < CommandLine.arguments.count {
            let path = CommandLine.arguments[index + 1]
            DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
                view.layoutSubtreeIfNeeded()
                guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
                view.cacheDisplay(in: view.bounds, to: bitmap)
                try? bitmap.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
            }
        }
    }

    @objc func openBrowserFromSetup() {
        settingsReturn?.stop()
        setupWindow?.orderOut(nil)
        // Keep regular mode during the handoff to the browser window.
        showBrowser()
    }

    func renderSetup() {
        if setupComplete && !wasSetupComplete && !setupKeepOpen {
            setupWindow?.orderOut(nil)
            updateWindowMode()
        }
        wasSetupComplete = setupComplete
        let hasRuntime = origin != "http://127.0.0.1:18420" || FileManager.default.isExecutableFile(atPath: "/opt/homebrew/bin/limactl") && FileManager.default.isExecutableFile(atPath: "/opt/homebrew/bin/docker") && FileManager.default.isExecutableFile(atPath: "/opt/homebrew/bin/qemu-system-aarch64")
        setupLabels["install"]?.stringValue = installedCorrectly ? "installed in applications." : "move igor.computer to applications, then open it there."
        setupButtons["install"]?.isHidden = installedCorrectly
        setupButtons["install"]?.title = "applications"
        setupLabels["runtime"]?.stringValue = startupError ?? runtimeIssues.first ?? (runtimeReady ? "computer is ready." : "starting the computer. first setup may take a few minutes.")
        setupButtons["runtime"]?.title = hasRuntime ? "retry" : "install runtime"
        setupButtons["runtime"]?.isHidden = runtimeReady && runtimeIssues.isEmpty && startupError == nil
        setupButtons["runtime"]?.isEnabled = worker?.isRunning != true || mode != "starting"
        setupLabels["notifications"]?.stringValue = notificationError ?? (notificationReady ? "allowed. requests appear without opening a window." : (notificationDetermined ? "allow notifications in system settings." : "allow alerts so your ai can ask for your help."))
        setupButtons["notifications"]?.title = notificationReady || notificationDetermined ? "open settings" : "allow"
        switch SMAppService.mainApp.status {
        case .enabled:
            setupLabels["login"]?.stringValue = "enabled. human help will be available after login."
            setupButtons["login"]?.title = "turn off"
        case .requiresApproval:
            setupLabels["login"]?.stringValue = "approve igor.computer in login items in system settings."
            setupButtons["login"]?.title = "open settings"
        default:
            setupLabels["login"]?.stringValue = "off · open the app manually after login"
            setupButtons["login"]?.title = "enable"
        }
        if let error = loginError { setupLabels["login"]?.stringValue = "could not change startup: " + error }
        let checks = ["install": installedCorrectly, "runtime": runtimeReady && runtimeIssues.isEmpty && startupError == nil, "notifications": notificationReady && notificationError == nil, "login": SMAppService.mainApp.status == .enabled && loginError == nil]
        for (key, ready) in checks {
            setupIcons[key]?.image = NSImage(systemSymbolName: ready ? "checkmark.circle.fill" : "exclamationmark.circle", accessibilityDescription: ready ? "ready" : "needs attention")
            setupIcons[key]?.contentTintColor = ready ? .systemGreen : .systemOrange
        }
        setupRows["install"]?.isHidden = installedCorrectly
        let loginNeedsApproval = SMAppService.mainApp.status == .requiresApproval
        setupLoginSwitch?.isHidden = loginNeedsApproval
        setupLoginSwitch?.state = SMAppService.mainApp.status == .enabled ? .on : .off
        setupButtons["login"]?.isHidden = !loginNeedsApproval
        setupButtons["notifications"]?.title = notificationDetermined ? "settings…" : "allow"
        if runtimeReady && runtimeIssues.isEmpty && startupError == nil { setupLabels["runtime"]?.stringValue = "ready in the background" }
        if notificationError == nil {
            setupLabels["notifications"]?.stringValue = notificationReady ? (notificationGuideStep == .ready ? "allowed · recommendations enabled" : "allowed · optional settings available") : notificationGuideStep.instruction
        }
        if SMAppService.mainApp.status == .enabled { setupLabels["login"]?.stringValue = "available whenever you log in" }
        setupDescription?.stringValue = "a computer for your agent."
        setupSummary?.isHidden = setupComplete && appearanceError == nil
        setupSummary?.stringValue = appearanceError ?? (mode == "pending" ? "your ai is waiting. finish the steps above to help." : "finish setup now, or come back from the menu bar.")
        setupPrimary?.isEnabled = runtimeReady
        setupLog?.isHidden = startupError == nil && runtimeIssues.isEmpty
        if let window = setupWindow, let view = window.contentView {
            view.layoutSubtreeIfNeeded()
            let height: CGFloat = (installedCorrectly ? (setupComplete ? 446 : 480) : 556) + (appearanceError == nil ? 0 : 34)
            if abs(view.frame.height - height) > 1 {
                var frame = window.frame
                let difference = height - view.frame.height
                frame.origin.y -= difference; frame.size.height += difference
                window.setFrame(frame, display: true)
            }
        }
    }

    @objc func closeSetup() {
        settingsReturn?.stop()
        settingsGuide?.close()
        settingsGuide = nil
        setupWindow?.orderOut(nil)
        updateWindowMode()
    }
    @objc func openApplications() { NSWorkspace.shared.open(URL(fileURLWithPath: "/Applications")) }
    @objc func openLog() {
        NSWorkspace.shared.open(FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/igor.computer/server.log"))
    }
    @objc func retryRuntime() {
        guard worker?.isRunning != true || mode != "starting" else { return }
        if origin == "http://127.0.0.1:18420" && (!FileManager.default.isExecutableFile(atPath: "/opt/homebrew/bin/limactl") || !FileManager.default.isExecutableFile(atPath: "/opt/homebrew/bin/docker") || !FileManager.default.isExecutableFile(atPath: "/opt/homebrew/bin/qemu-system-aarch64")) {
            let brew = "/opt/homebrew/bin/brew"
            guard FileManager.default.isExecutableFile(atPath: brew) else {
                NSWorkspace.shared.open(URL(string: "https://brew.sh")!)
                startupError = "install homebrew first, then choose install runtime."
                renderSetup(); return
            }
            let process = Process()
            process.executableURL = URL(fileURLWithPath: brew)
            process.arguments = ["install", "lima", "qemu", "docker", "docker-buildx"]
            process.environment = ProcessInfo.processInfo.environment.merging(["PATH": "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin", "HOMEBREW_NO_AUTO_UPDATE": "1"]) { _, new in new }
            let directory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/igor.computer")
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let log = directory.appendingPathComponent("server.log")
            if !FileManager.default.fileExists(atPath: log.path) { FileManager.default.createFile(atPath: log.path, contents: nil) }
            let handle = try? FileHandle(forWritingTo: log); handle?.seekToEndOfFile()
            process.standardOutput = handle; process.standardError = handle
            process.terminationHandler = { [weak self] process in
                DispatchQueue.main.async {
                    self?.startupError = process.terminationStatus == 0 ? nil : "runtime installation failed. check the log, then retry."
                    self?.worker = nil
                    self?.startService(); self?.refreshSetup()
                }
            }
            do { try process.run(); worker = process; mode = "starting"; startupError = "installing the computer runtime…" }
            catch { startupError = error.localizedDescription }
        } else {
            worker?.terminationHandler = nil; worker?.terminate(); worker = nil; startupError = nil; runtimeIssues = []; startupStarted = nil
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.startService() }
        }
        renderSetup()
    }
}
