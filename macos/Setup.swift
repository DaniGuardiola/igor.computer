import AppKit
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
                self.notificationReady = settings.authorizationStatus == .authorized && settings.alertSetting == .enabled
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
        let directory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Igor Browser")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let data = try JSONSerialization.data(withJSONObject: [
                "checkedAt": Date().timeIntervalSince1970 * 1000,
                "notifications": notificationReady && notificationError == nil,
                "login": loginReady
            ])
            let url = directory.appendingPathComponent("app-status.json")
            try data.write(to: url, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        } catch { startupError = "Could not save app readiness: " + error.localizedDescription }
    }

    @objc func showSetup(_ sender: Any? = nil) {
        setupKeepOpen = (sender as? NSMenuItem)?.title == "Settings…" || CommandLine.arguments.contains("--setup")
        if setupWindow == nil { makeSetupWindow() }
        renderSetup()
        NSApp.activate(ignoringOtherApps: true)
        setupWindow?.makeKeyAndOrderFront(nil)
    }

    func makeSetupWindow() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 610, height: 570), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Igor Browser Setup"
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.center()
        let view = NSView()
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        window.contentView = view
        let title = NSTextField(labelWithString: "A browser that stays out of your way.")
        title.font = .systemFont(ofSize: 23, weight: .semibold)
        let subtitle = NSTextField(wrappingLabelWithString: "Complete setup once. Your browser stays in the background until you choose to open it.")
        subtitle.textColor = .secondaryLabelColor
        let stack = NSStackView(views: [title, subtitle])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 22
        let rows: [(String, String, Selector)] = [
            ("install", "Install the app", #selector(openApplications)),
            ("runtime", "Browser runtime", #selector(retryRuntime)),
            ("notifications", "Human help notifications", #selector(enableNotifications)),
            ("login", "Start at login", #selector(toggleLogin))
        ]
        for (key, name, action) in rows {
            let heading = NSTextField(labelWithString: name)
            heading.font = .systemFont(ofSize: 14, weight: .semibold)
            let detail = NSTextField(wrappingLabelWithString: "Checking…")
            detail.font = .systemFont(ofSize: 12)
            detail.textColor = .secondaryLabelColor
            let text = NSStackView(views: [heading, detail])
            text.orientation = .vertical; text.alignment = .leading; text.spacing = 5
            let button = NSButton(title: "Continue", target: self, action: action)
            button.bezelStyle = .rounded
            button.widthAnchor.constraint(equalToConstant: 125).isActive = true
            let row = NSStackView(views: [text, button])
            row.spacing = 16; row.alignment = .centerY
            stack.addArrangedSubview(row)
            row.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
            setupLabels[key] = detail; setupButtons[key] = button
        }
        let summary = NSTextField(wrappingLabelWithString: "")
        summary.textColor = .secondaryLabelColor
        let done = NSButton(title: "Close", target: self, action: #selector(closeSetup))
        done.bezelStyle = .rounded
        let logs = NSButton(title: "Open Log", target: self, action: #selector(openLog))
        logs.bezelStyle = .rounded
        let footer = NSStackView(views: [logs, done]); footer.spacing = 12
        stack.addArrangedSubview(summary); stack.addArrangedSubview(footer)
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 28),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -28),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: view.bottomAnchor, constant: -24)
        ])
        setupSummary = summary
        setupWindow = window
        if let index = CommandLine.arguments.firstIndex(of: "--capture-setup"), index + 1 < CommandLine.arguments.count {
            let path = CommandLine.arguments[index + 1]
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
                view.cacheDisplay(in: view.bounds, to: bitmap)
                try? bitmap.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
            }
        }
    }

    func renderSetup() {
        if setupComplete && !wasSetupComplete && !setupKeepOpen { setupWindow?.orderOut(nil) }
        wasSetupComplete = setupComplete
        let hasRuntime = FileManager.default.isExecutableFile(atPath: "/opt/homebrew/bin/colima") && FileManager.default.isExecutableFile(atPath: "/opt/homebrew/bin/docker")
        setupLabels["install"]?.stringValue = installedCorrectly ? "Installed in Applications." : "Move Igor Browser to Applications, then open it there."
        setupButtons["install"]?.isHidden = installedCorrectly
        setupButtons["install"]?.title = "Applications"
        setupLabels["runtime"]?.stringValue = startupError ?? runtimeIssues.first ?? (runtimeReady ? "Browser and display are ready." : "Starting the private browser. First setup may take a few minutes.")
        setupButtons["runtime"]?.title = hasRuntime ? "Retry" : "Install Runtime"
        setupButtons["runtime"]?.isHidden = runtimeReady && runtimeIssues.isEmpty && startupError == nil
        setupButtons["runtime"]?.isEnabled = worker?.isRunning != true || mode != "starting"
        setupLabels["notifications"]?.stringValue = notificationError ?? (notificationReady ? "Allowed. Requests appear without opening a window." : (notificationDetermined ? "Allow notifications and enable alerts in System Settings." : "Allow alerts so your AI can ask for your help."))
        setupButtons["notifications"]?.title = notificationReady || notificationDetermined ? "Open Settings" : "Allow"
        switch SMAppService.mainApp.status {
        case .enabled:
            setupLabels["login"]?.stringValue = "Enabled. Your browser will be available after login."
            setupButtons["login"]?.title = "Turn Off"
        case .requiresApproval:
            setupLabels["login"]?.stringValue = "Approve Igor Browser in Login Items in System Settings."
            setupButtons["login"]?.title = "Open Settings"
        default:
            setupLabels["login"]?.stringValue = loginReady ? "Automatic startup is off by choice. Open the app when needed." : "Enable automatic startup to keep the browser available."
            setupButtons["login"]?.title = "Enable"
        }
        if let error = loginError { setupLabels["login"]?.stringValue = "Could not change startup: " + error }
        setupSummary?.stringValue = setupComplete ? "All set. You can close this window. Open the browser anytime from the menu bar." : (mode == "pending" ? "Your AI is waiting for help. Finish setup, then choose Show Browser from the menu bar." : "You can close this window and finish later from the menu bar. No Accessibility or Screen Recording permission is needed.")
    }

    @objc func closeSetup() { setupWindow?.orderOut(nil) }
    @objc func openApplications() { NSWorkspace.shared.open(URL(fileURLWithPath: "/Applications")) }
    @objc func openLog() {
        NSWorkspace.shared.open(FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Igor Browser/service.log"))
    }
    @objc func retryRuntime() {
        guard worker?.isRunning != true || mode != "starting" else { return }
        if !FileManager.default.isExecutableFile(atPath: "/opt/homebrew/bin/colima") || !FileManager.default.isExecutableFile(atPath: "/opt/homebrew/bin/docker") {
            let brew = "/opt/homebrew/bin/brew"
            guard FileManager.default.isExecutableFile(atPath: brew) else {
                NSWorkspace.shared.open(URL(string: "https://brew.sh")!)
                startupError = "Install Homebrew first, then choose Install Runtime."
                renderSetup(); return
            }
            let process = Process()
            process.executableURL = URL(fileURLWithPath: brew)
            process.arguments = ["install", "colima", "docker"]
            process.environment = ProcessInfo.processInfo.environment.merging(["PATH": "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin", "HOMEBREW_NO_AUTO_UPDATE": "1"]) { _, new in new }
            let directory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Igor Browser")
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let log = directory.appendingPathComponent("service.log")
            if !FileManager.default.fileExists(atPath: log.path) { FileManager.default.createFile(atPath: log.path, contents: nil) }
            let handle = try? FileHandle(forWritingTo: log); handle?.seekToEndOfFile()
            process.standardOutput = handle; process.standardError = handle
            process.terminationHandler = { [weak self] process in
                DispatchQueue.main.async {
                    self?.startupError = process.terminationStatus == 0 ? nil : "Runtime installation failed. Check the log, then retry."
                    self?.worker = nil
                    self?.startService(); self?.refreshSetup()
                }
            }
            do { try process.run(); worker = process; mode = "starting"; startupError = "Installing the browser runtime…" }
            catch { startupError = error.localizedDescription }
        } else {
            worker?.terminationHandler = nil; worker?.terminate(); worker = nil; startupError = nil; runtimeIssues = []; startupStarted = nil
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.startService() }
        }
        renderSetup()
    }
}
