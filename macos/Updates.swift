import AppKit
import Sparkle

// Relaunching after an update also replaces the bundled server, which stops it.
// Hold the install while a computer is in use; install at once if the server is unreachable.
final class UpdateGate: NSObject, SPUUpdaterDelegate {
    weak var app: AppDelegate?

    init(app: AppDelegate) { self.app = app }

    // One feed holds every channel. Stable items carry no channel, and each channel
    // also gets everything more stable than it, so switching never downgrades.
    static let channels = ["stable", "beta", "alpha", "canary"]
    var channel: String {
        get { UserDefaults.standard.string(forKey: "updateChannel") ?? Bundle.main.object(forInfoDictionaryKey: "IgorUpdateChannel") as? String ?? "stable" }
        set { UserDefaults.standard.set(newValue, forKey: "updateChannel") }
    }

    func allowedChannels(for updater: SPUUpdater) -> Set<String> {
        let index = Self.channels.firstIndex(of: channel) ?? 0
        return Set(Self.channels.prefix(index + 1).dropFirst())
    }

    @objc func selectChannel(_ sender: NSMenuItem) {
        guard let name = sender.representedObject as? String else { return }
        channel = name
        app?.updateMenu()
    }

    func updater(_ updater: SPUUpdater, shouldPostponeRelaunchForUpdate item: SUAppcastItem, untilInvokingBlock installHandler: @escaping () -> Void) -> Bool {
        waitUntilIdle(installHandler)
        return true
    }

    func waitUntilIdle(_ install: @escaping () -> Void) {
        guard let app = app else { install(); return }
        app.request("/computers") { result in
            guard case .success(let body) = result, let computers = body["computers"] as? [[String: Any]] else { install(); return }
            let busy = computers.contains { computer in
                computer["mode"] as? String == "human" || (computer["activeTurns"] as? Int ?? 0) > 0
                    || ["waking", "saving", "building"].contains(computer["state"] as? String ?? "")
            }
            if busy { DispatchQueue.main.asyncAfter(deadline: .now() + 30) { self.waitUntilIdle(install) } }
            else { install() }
        }
    }
}
