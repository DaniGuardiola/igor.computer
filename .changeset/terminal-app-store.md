---
"igor-computer": minor
---

The base image adds a terminal (Xfce Terminal, opening bash in `/workspace`) and an app store (GNOME Software with Flathub). Store apps install per user without root and survive rebuilds; agents can install them with `flatpak install --user`. The terminal and app store are pinned to the dock on new computers.
