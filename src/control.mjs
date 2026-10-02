import { randomUUID } from 'node:crypto';

export class Control {
  mode = 'agent';
  request = null;
  busy = false;
  humanBusy = false;

  status() {
    return { mode: this.mode, request: this.request, busy: this.busy };
  }

  requestHuman(message, pageId) {
    if (this.mode !== 'agent') throw new Error('Browser is already paused or under human control.');
    this.mode = 'pending';
    this.request = { id: randomUUID(), message, pageId, outcome: null };
    return this.status();
  }

  takeControl() {
    if (this.busy) throw new Error('Finishing a browser command. Try again shortly.');
    this.mode = 'human';
    return this.status();
  }

  pause() {
    if (this.mode !== 'agent') throw new Error('Browser is already paused or under human control.');
    this.mode = 'paused';
    return this.status();
  }

  resume() {
    if (this.humanBusy) throw new Error('Finishing a window action. Try again shortly.');
    if (!['human', 'paused'].includes(this.mode)) throw new Error('Take control before returning the browser.');
    if (this.request && !this.request.outcome) this.request.outcome = 'continued';
    this.mode = 'agent';
    return this.status();
  }

  cancel() {
    if (this.mode === 'agent') return this.status();
    if (this.request && !this.request.outcome) this.request.outcome = 'cancelled';
    this.mode = 'paused';
    return this.status();
  }

  async runHuman(fn) {
    if (this.mode !== 'human') throw new Error('Open the browser to manage windows.');
    if (this.humanBusy) throw new Error('Finishing a window action. Try again shortly.');
    this.humanBusy = true;
    try { return await fn(); } finally { this.humanBusy = false; }
  }

  async run(fn) {
    if (this.mode !== 'agent') throw new Error('Browser is paused for human control. Wait for the user to return control.');
    if (this.busy) throw new Error('Browser is busy. Retry after the current command completes.');
    this.busy = true;
    try { return await fn(); } finally { this.busy = false; }
  }
}
