import { randomUUID } from 'node:crypto';

const openFor = 24 * 3600 * 1000;
const keepResolved = 3600 * 1000;

// Help requests ask the person for something. They never pause or block the
// computer: agents keep working, and the person can help, dismiss or ignore them.
export class Control {
  mode = 'agent';
  requests = [];
  busy = false;
  busyWorkspaces = new Set();
  physicalBusy = false;
  humanBusy = false;
  automationPaused = false;
  viewerOpen = false;
  viewedWorkspace = 'shared';
  humanWorkspace = null;
  takeoverWaiting = null;

  openRequests() {
    const now = Date.now();
    for (const request of this.requests) if (!request.outcome && now - request.createdAt > openFor) Object.assign(request, { outcome: 'expired', resolvedAt: now });
    this.requests = this.requests.filter(request => !request.outcome || now - request.resolvedAt < keepResolved);
    return this.requests.filter(request => !request.outcome);
  }

  status() {
    const open = this.openRequests();
    return { mode: this.mode, request: open.at(-1) ?? null, requests: this.requests, busy: this.busy, automationPaused: this.automationPaused, viewerOpen: this.viewerOpen, viewedWorkspace: this.viewedWorkspace, humanWorkspace: this.humanWorkspace };
  }

  // One open request per workspace: a new one from the same agent replaces it.
  requestHuman(message, pageId, workspace = 'shared') {
    for (const request of this.openRequests()) if (request.workspace === workspace) this.resolve(request, 'replaced');
    const request = { id: randomUUID(), message, pageId, workspace, createdAt: Date.now(), outcome: null };
    this.requests.push(request);
    return request;
  }

  resolve(request, outcome) {
    Object.assign(request, { outcome, resolvedAt: Date.now() });
    return request;
  }

  // The person dismisses a request; the agent withdraws its own.
  dismiss(id) {
    const open = this.openRequests();
    const request = id ? open.find(item => item.id === id) : open.at(-1);
    if (!request) throw new Error('No open help request.');
    return this.resolve(request, 'dismissed');
  }

  withdraw(id, workspace) {
    const request = this.openRequests().find(item => item.id === id);
    if (!request || request.workspace !== workspace) throw new Error('No open help request with that ID from this workspace.');
    return this.resolve(request, 'withdrawn');
  }

  // Handing control back answers that workspace's open request.
  handBack(workspace) {
    for (const request of this.openRequests()) if (request.workspace === workspace) this.resolve(request, 'continued');
  }

  watch(workspace = this.viewedWorkspace) {
    if (this.humanBusy) throw new Error('Finishing a window action. Try again shortly.');
    if (this.mode === 'human') this.release();
    this.viewerOpen = true;
    this.viewedWorkspace = workspace;
    return this.status();
  }

  release() {
    if (this.humanBusy) throw new Error('Finishing a window action. Try again shortly.');
    if (this.humanWorkspace) this.handBack(this.humanWorkspace);
    this.humanWorkspace = null;
    this.mode = this.automationPaused ? 'paused' : 'agent';
    return this.status();
  }

  takeControl(workspace = this.viewedWorkspace) {
    if (this.humanBusy) throw new Error('Finishing a window action. Try again shortly.');
    if (this.isBusy(workspace)) throw new Error('Finishing a browser command. Try again shortly.');
    this.viewerOpen = true;
    this.viewedWorkspace = workspace;
    this.humanWorkspace = workspace;
    this.mode = 'human';
    return this.status();
  }

  pause() {
    if (this.mode !== 'agent') throw new Error('Browser is already paused or under human control.');
    this.automationPaused = true;
    this.mode = 'paused';
    return this.status();
  }

  setAutomationPaused(paused) {
    if (typeof paused !== 'boolean') throw new Error('Invalid pause setting.');
    if (!['agent', 'paused', 'human'].includes(this.mode)) throw new Error('Open the browser before changing automation.');
    if (this.mode !== 'human' && !paused && this.humanBusy) throw new Error('Finishing a window action. Try again shortly.');
    this.automationPaused = paused;
    if (this.mode !== 'human') this.mode = paused ? 'paused' : 'agent';
    return this.status();
  }

  closeViewer() {
    if (!this.viewerOpen && this.mode !== 'human') return this.status();
    if (this.humanBusy) throw new Error('Finishing a window action. Try again shortly.');
    if (this.humanWorkspace) this.handBack(this.humanWorkspace);
    this.viewerOpen = false;
    this.humanWorkspace = null;
    this.mode = this.automationPaused ? 'paused' : 'agent';
    return this.status();
  }

  resume() {
    if (this.humanBusy) throw new Error('Finishing a window action. Try again shortly.');
    if (!['human', 'paused'].includes(this.mode)) throw new Error('Take control before returning the browser.');
    if (this.humanWorkspace) this.handBack(this.humanWorkspace);
    this.automationPaused = false;
    this.humanWorkspace = null;
    this.mode = 'agent';
    return this.status();
  }

  async runHuman(fn) {
    if (this.mode !== 'human') throw new Error('Open the browser to manage windows.');
    if (this.humanBusy) throw new Error('Finishing a window action. Try again shortly.');
    this.humanBusy = true;
    try { return await fn(); } finally { this.humanBusy = false; }
  }

  isBusy(workspace) { return this.physicalBusy || this.busyWorkspaces.has(workspace); }

  async run(fn, workspace = 'shared', physical = false) {
    if ((this.takeoverWaiting && (workspace === this.takeoverWaiting || physical)) || this.automationPaused || this.mode === 'paused' || (this.mode === 'human' && (this.humanWorkspace === workspace || physical))) throw new Error('Browser is paused for human control. Wait for the user to return control.');
    if (this.isBusy(workspace) || (physical && (this.busy || this.humanBusy))) throw new Error('Browser is busy. Retry after the current command completes.');
    this.busyWorkspaces.add(workspace);
    if (physical) this.physicalBusy = true;
    this.busy = true;
    try { return await fn(); } finally {
      this.busyWorkspaces.delete(workspace);
      if (physical) this.physicalBusy = false;
      this.busy = this.busyWorkspaces.size > 0;
    }
  }
}
