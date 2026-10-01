import AppKit

extension AppDelegate {
    func prepareVisibleInterface() {
        if NSApp.activationPolicy() != .regular { NSApp.setActivationPolicy(.regular) }
    }

    func updateWindowMode() {
        let hasInterface = [setupWindow, window].compactMap { $0 }.contains { $0.isVisible || $0.isMiniaturized }
        let policy: NSApplication.ActivationPolicy = hasInterface ? .regular : .accessory
        if NSApp.activationPolicy() != policy { NSApp.setActivationPolicy(policy) }
    }

    func makeApplicationMenu() {
        let main = NSMenu()
        let applicationItem = NSMenuItem()
        let application = NSMenu(title: "igor browser")
        let settings = NSMenuItem(title: "settings…", action: #selector(showSetup), keyEquivalent: ",")
        settings.target = self
        application.addItem(settings)
        application.addItem(.separator())
        let quitItem = NSMenuItem(title: "quit igor browser", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        application.addItem(quitItem)
        applicationItem.submenu = application
        main.addItem(applicationItem)
        let windowItem = NSMenuItem(title: "window", action: nil, keyEquivalent: "")
        let windowMenu = NSMenu(title: "window")
        windowMenu.addItem(withTitle: "close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowItem.submenu = windowMenu
        main.addItem(windowItem)
        NSApp.mainMenu = main
        NSApp.windowsMenu = windowMenu
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if shutdownComplete { return .terminateNow }
        terminationPending = true
        quit()
        return .terminateLater
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if let browser = window, browser.isVisible || browser.isMiniaturized {
            browser.deminiaturize(nil)
            browser.makeKeyAndOrderFront(nil)
        } else { showSetup() }
        return true
    }
}
