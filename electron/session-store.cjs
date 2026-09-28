const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
class SessionStore {
  constructor(directory, origin, encryption) {
    this.file = path.join(directory, createHash('sha256').update(origin).digest('hex') + '.bin');
    this.encryption = encryption;
    this.queue = Promise.resolve();
  }
  async load() {
    try { return JSON.parse(this.encryption.decryptString(await fs.readFile(this.file))); }
    catch (error) { if (error.code === 'ENOENT') return null; throw new Error('STORAGE_ERROR'); }
  }
  async save(value) {
    if (!this.encryption.isEncryptionAvailable() || this.encryption.getSelectedStorageBackend?.() === 'basic_text') throw new Error('STORAGE_ERROR');
    const bytes = this.encryption.encryptString(JSON.stringify(value));
    const job = this.queue.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file + '.tmp', bytes, { mode: 0o600 });
      await fs.rename(this.file + '.tmp', this.file);
    });
    this.queue = job; return job;
  }
  async clear() {
    const job = this.queue.catch(() => {}).then(() => fs.rm(this.file, { force: true }));
    this.queue = job; return job;
  }
}
module.exports = { SessionStore };
