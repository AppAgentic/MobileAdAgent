/* Asset lake abstraction for job media.

   Production target is Cloudflare R2 (same putObject/getObject contract);
   this local adapter maps tenant-scoped storage keys onto a directory so the
   dev runner, tests, and the generation canary exercise the exact key
   discipline a hosted worker will use. Asset records persisted to the tenant
   store carry the storageKey only — never local paths or signed URLs. */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertSafeStorageKey(storageKey) {
  const key = String(storageKey || '');
  if (!key || key.startsWith('/') || key.includes('..') || key.includes('\\')) {
    throw new Error(`Unsafe storage key: ${JSON.stringify(storageKey)}`);
  }
  return key;
}

export function createLocalAssetStore({ rootDir } = {}) {
  if (!rootDir) throw new Error('Local asset store needs a rootDir.');

  function resolvePath(storageKey) {
    return path.join(rootDir, assertSafeStorageKey(storageKey));
  }

  return {
    kind: 'local_directory',
    rootDir,

    resolvePath,

    async putObject({ storageKey, bytes, contentType }) {
      if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
        throw new Error('putObject needs bytes as a Buffer.');
      }
      const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      const filePath = resolvePath(storageKey);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, buffer);
      return {
        storageKey: assertSafeStorageKey(storageKey),
        contentType: contentType || 'application/octet-stream',
        bytes: buffer.byteLength,
        checksum: sha256(buffer),
      };
    },

    async putObjectIfAbsent({ storageKey, bytes, contentType }) {
      if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
        throw new Error('putObjectIfAbsent needs bytes as a Buffer.');
      }
      const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      const filePath = resolvePath(storageKey);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      let handle = null;
      try {
        handle = await fs.open(filePath, 'wx');
        await handle.writeFile(buffer);
        return {
          created: true,
          storageKey: assertSafeStorageKey(storageKey),
          contentType: contentType || 'application/octet-stream',
          bytes: buffer.byteLength,
          checksum: sha256(buffer),
        };
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const existing = await fs.readFile(filePath);
        return {
          created: false,
          storageKey: assertSafeStorageKey(storageKey),
          contentType: contentType || 'application/octet-stream',
          bytes: existing.byteLength,
          checksum: sha256(existing),
        };
      } finally {
        await handle?.close();
      }
    },

    async putFile({ storageKey, fromPath, contentType }) {
      const buffer = await fs.readFile(fromPath);
      return this.putObject({ storageKey, bytes: buffer, contentType });
    },

    async getObject(storageKey) {
      return fs.readFile(resolvePath(storageKey));
    },

    async exists(storageKey) {
      try {
        await fs.access(resolvePath(storageKey));
        return true;
      } catch {
        return false;
      }
    },
  };
}
