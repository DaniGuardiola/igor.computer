enum NotificationGuideStep: Equatable {
    case allow, desktop, notificationCenter, persistent, ready

    static func current(allowed: Bool, desktop: Bool, notificationCenter: Bool = true, style: String) -> Self {
        if !allowed { return .allow }
        if !desktop { return .desktop }
        if !notificationCenter { return .notificationCenter }
        return style == "persistent" ? .ready : .persistent
    }

    var title: String {
        switch self {
        case .allow: return "allow notifications"
        case .desktop, .notificationCenter: return "where requests appear"
        case .persistent: return "keep requests visible"
        case .ready: return "notifications ready"
        }
    }
    var instruction: String {
        switch self {
        case .allow: return "turn on allow notifications so your agent can ask for help."
        case .desktop, .notificationCenter: return "desktop + notification center recommended. optional · close settings to skip."
        case .persistent: return "persistent keeps requests visible until dismissed. optional · close settings to skip."
        case .ready: return "your agent can ask for help without opening a window."
        }
    }
    var targetIdentifier: String? {
        switch self {
        case .allow: return "allow-notifications"
        // System Settings currently exposes this misspelled accessibility identifier.
        case .desktop: return "notification-presence-dektop"
        case .notificationCenter: return "notification-presence-notificationCenter"
        default: return nil
        }
    }
}
