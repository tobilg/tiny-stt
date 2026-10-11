/** Hash-keyed persistence. Transactions finish before a worker may be retired. */
/** Open the optional hash-keyed IndexedDB byte cache; callers handle storage denial with uncached loading. */
export async function openAssetCache(): Promise<{
  /** Read complete bytes by SHA-256; the caller must reverify their contents. */
  get(key: string): Promise<Uint8Array | undefined>;
  /** Persist a complete verified asset and await transaction completion. */
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** Remove a corrupt or obsolete hash entry. */
  delete(key: string): Promise<void>;
  /** Release the database connection after the current load. */
  close(): void;
}> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('tiny-stt-whistle-v1', 1);
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(new Error('Asset cache open timed out.'));
    }, 1500);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('assets');
    };
    request.onerror = () => {
      clearTimeout(timer);
      reject(request.error);
    };
    request.onblocked = () => {
      clearTimeout(timer);
      expired = true;
      reject(new Error('Asset cache blocked.'));
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (expired) request.result.close();
      else resolve(request.result);
    };
  });
  db.onversionchange = () => db.close();
  const transaction = <T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> =>
    new Promise((resolve, reject) => {
      const tx = db.transaction('assets', mode),
        request = operation(tx.objectStore('assets'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () =>
        reject(tx.error ?? new Error('Asset cache transaction failed.'));
    });
  return {
    async get(key) {
      const value = await transaction('readonly', (s) => s.get(key));
      return value instanceof ArrayBuffer ? new Uint8Array(value) : undefined;
    },
    async put(key, bytes) {
      await transaction('readwrite', (s) => s.put(new Uint8Array(bytes).buffer, key));
    },
    async delete(key) {
      await transaction('readwrite', (s) => s.delete(key));
    },
    close() {
      db.close();
    },
  };
}
