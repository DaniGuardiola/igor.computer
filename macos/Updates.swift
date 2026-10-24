import Foundation
import Sparkle

// Relaunching after an update also replaces the bundled server, which stops it.
// Hold the install while a computer is in use; install at once if the server is unreachable.
final class UpdateGate: NSObject, SPUUpdaterDelegate {
    weak var app: AppDelegate?

    init(app: AppDelegate) { self.app = app }

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
