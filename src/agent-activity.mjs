// Activity is scoped to accepted agent commands, never viewer polling.
export class AgentActivity {
  constructor({ now = Date.now, idleAfter = 15000 } = {}) {
    this.now = now;
    this.idleAfter = idleAfter;
    this.workspaces = new Map();
  }
  begin(workspace) {
    const state = this.workspaces.get(workspace) || { running: 0, lastAction: 0 };
    state.running++;
    state.lastAction = this.now();
    this.workspaces.set(workspace, state);
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      state.running--;
      state.lastAction = this.now();
    };
  }
  state(workspace) {
    const state = this.workspaces.get(workspace);
    return state && (state.running > 0 || this.now() - state.lastAction < this.idleAfter) ? 'active' : 'idle';
  }
}
