import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export class Desktop {
  constructor(directory, operations = {}) { this.operations = operations; this.file = join(directory, 'desktop.json'); this.writes = Promise.resolve(); }
  async preferences() {
    try { return JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return { pins: ['chromium.desktop'], profiles: {} }; }
  }
  async update(change) {
    const next = this.writes.then(async () => {
      const value = await this.preferences();
      change(value);
      await writeFile(this.file + '.tmp', JSON.stringify(value), { mode: 0o600 });
      await rename(this.file + '.tmp', this.file);
      return value;
    });
    this.writes = next.catch(() => {});
    return next;
  }
  async catalog() {
    if (!this.cached || Date.now() - this.cached.at > 30000) {
      this.cached = { at: Date.now(), apps: (await this.operations.computer('apps')).apps };
    }
    return { apps: this.cached.apps, pins: (await this.preferences()).pins };
  }
  async pin(ids) {
    const { apps } = await this.catalog();
    if (!Array.isArray(ids) || ids.length > 24 || new Set(ids).size !== ids.length || ids.some(id => !apps.some(app => app.id === id))) throw new Error('Choose installed applications.');
    await this.update(value => { value.pins = ids; });
    return this.catalog();
  }
  async launch(id, newWindow = false) {
    const { apps } = await this.catalog();
    if (!apps.some(app => app.id === id)) throw new Error('Application no longer installed.');
    const state = await this.operations.computer('workspace_list');
    const workspace = state.workspaces.find(item => item.active);
    if (id === 'chromium.desktop') return this.operations.computer('workspace_open_browser', { name: workspace.name, reuse: !newWindow });
    await this.operations.computer('apps_launch', { id, desktop: workspace.desktop }).catch(() => { throw new Error('The app did not open a window in this workspace.'); });
    return this.operations.computer('workspace_list');
  }
  validateProfile(name, profile) {
    if (!/^[a-zA-Z0-9_-]{1,60}$/.test(name) || typeof profile.label !== 'string' || !profile.label.trim() || profile.label.length > 80) throw new Error('Invalid workspace profile.');
    const avatar = profile.avatar ?? null;
    if (avatar !== null && (typeof avatar !== 'string' || avatar.length > 14 * 1024 * 1024 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(avatar))) throw new Error('Use a PNG, JPEG or WebP workspace picture.');
  }
  async profile(name, profile) {
    this.validateProfile(name, profile);
    await this.update(value => { value.profiles ??= {}; value.profiles[name] = { label: profile.label.trim(), avatar: profile.avatar ?? null }; });
    return { ok: true };
  }
  async reconcile(owner, profiles) {
    if (typeof owner !== 'string' || !/^[a-f0-9]{64}$/.test(owner) || !Array.isArray(profiles) || profiles.length > 31) throw new Error('Invalid agent roster.');
    const ids = profiles.map(profile => profile?.id);
    if (new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,60}$/.test(id) || ['shared', 'user'].includes(id))) throw new Error('Invalid agent workspace IDs.');
    // Validate the entire roster before creating or retiring any workspace.
    for (const profile of profiles) this.validateProfile(profile.id, profile);
    const rosters = (await this.preferences()).rosters || {};
    const previous = rosters[owner] || [];
    const elsewhere = Object.entries(rosters).filter(([key]) => key !== owner).flatMap(([, names]) => names);
    const removed = previous.filter(id => !ids.includes(id) && !elsewhere.includes(id));
    await this.operations.computer('roster', { removed, profiles: profiles.map(({ id, label }) => ({ id, label })) });
    await this.update(value => {
      value.profiles ??= {};
      for (const profile of profiles) value.profiles[profile.id] = { label: profile.label.trim(), avatar: profile.avatar ?? null };
      for (const name of removed) delete value.profiles[name];
      value.rosters ??= {};
      value.rosters[owner] = ids;
    });
    return { removed };
  }
  async workspaces(state) {
    const { profiles = {} } = await this.preferences();
    return { ...state, workspaces: state.workspaces.map(item => (item.name === 'shared' ? { ...item, label: 'your desktop', avatar: null, personal: true } : { ...item, ...profiles[item.name], personal: false })) };
  }
}
