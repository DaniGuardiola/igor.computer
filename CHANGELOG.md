# igor-computer

## 0.4.0

### Minor Changes

- 49bf621: The base image adds a terminal (Xfce Terminal, opening bash in `/workspace`) and an app store (GNOME Software with Flathub). Store apps install per user without root and survive rebuilds; agents can install them with `flatpak install --user`. The terminal and app store are pinned to the dock on new computers.

## 0.3.0

### Minor Changes

- 6fec8b7: Signed, notarized releases with automatic updates for the app and its server, on stable, beta, alpha and canary channels.
