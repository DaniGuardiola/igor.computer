// Capture the actual guest desktop, including browser chrome, dialogs and OS
// background. Never stream another workspace while its physical input runs.
export class DesktopView {
  constructor(computer) { this.computer = computer; this.frames = new Map(); }
  async frame(state, workspace, valid = () => true) {
    const desktop = state.workspaces.find(item => item.name === workspace)?.desktop;
    if (!Number.isInteger(desktop)) throw new Error('Unknown workspace.');
    const result = await this.computer('frame', { desktop });
    if (result.data && valid()) {
      this.frames.set(workspace, { ...result, generation: state.generation });
      if (this.frames.size > 8) this.frames.delete(this.frames.keys().next().value);
      return result;
    }
    const previous = this.frames.get(workspace);
    if (previous?.generation === state.generation) return { ...previous, waiting: true };
    return { waiting: true };
  }
}
