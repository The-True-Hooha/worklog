const LogCache = {
  dbName: 'worklog-cache',
  dbVersion: 3,
  storeName: 'logs',
  archiveStoreName: 'archives',
  dbPromise: null,

  isSupported() {
    return typeof window !== 'undefined' && 'indexedDB' in window;
  },

  async open() {
    if (!this.isSupported()) return null;
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = request.result;
        const oldVersion = event.oldVersion;

        // Create logs store with indexes
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'path' });
          // Phase 2: Add indexes for fast queries
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('project', 'project', { unique: false });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        } else if (oldVersion < 3) {
          // Upgrade existing store with indexes
          const transaction = event.target.transaction;
          const store = transaction.objectStore(this.storeName);

          // Add indexes if they don't exist
          if (!store.indexNames.contains('date')) {
            store.createIndex('date', 'date', { unique: false });
          }
          if (!store.indexNames.contains('project')) {
            store.createIndex('project', 'project', { unique: false });
          }
          if (!store.indexNames.contains('category')) {
            store.createIndex('category', 'category', { unique: false });
          }
          if (!store.indexNames.contains('createdAt')) {
            store.createIndex('createdAt', 'createdAt', { unique: false });
          }
        }

        // Create archives store for Phase 3
        if (!db.objectStoreNames.contains(this.archiveStoreName)) {
          db.createObjectStore(this.archiveStoreName, { keyPath: 'id', autoIncrement: true });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };

      request.onerror = () => {
        reject(request.error || new Error('Failed to open IndexedDB cache'));
      };

      request.onblocked = () => {
        reject(new Error('IndexedDB cache open blocked by another tab'));
      };
    });

    return this.dbPromise;
  },

  waitForTransaction(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  },

  async getAllLogs() {
    const db = await this.open();
    if (!db) return [];

    return await new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(Array.isArray(request.result) ? request.result : []);
      };
      request.onerror = () => {
        reject(request.error || new Error('Failed to read cached logs'));
      };
      tx.onabort = () => {
        reject(tx.error || new Error('IndexedDB transaction aborted'));
      };
    });
  },

  sanitizeLogs(logs) {
    return (logs || [])
      .filter(log => log && typeof log.path === 'string' && log.path.length > 0)
      .map(log => ({
        path: log.path,
        text: String(log.text || ''),
        date: log.date || '',
        time: log.time || '',
        username: log.username || 'local-user',
        durationMs: log.durationMs || 0,
        // Embedded metadata (Phase 1)
        project: log.project || null,
        category: log.category || null,
        energy: log.energy || null,
        createdAt: log.createdAt || new Date().toISOString()
      }));
  },

  async putLogs(logs) {
    const items = this.sanitizeLogs(logs);
    if (items.length === 0) return;

    const db = await this.open();
    if (!db) return;

    const tx = db.transaction(this.storeName, 'readwrite');
    const store = tx.objectStore(this.storeName);
    for (const item of items) {
      store.put(item);
    }
    await this.waitForTransaction(tx);
  },

  async replaceAllLogs(logs) {
    const items = this.sanitizeLogs(logs);
    const db = await this.open();
    if (!db) return;

    const tx = db.transaction(this.storeName, 'readwrite');
    const store = tx.objectStore(this.storeName);
    store.clear();
    for (const item of items) {
      store.put(item);
    }
    await this.waitForTransaction(tx);
  },

  async clear() {
    await this.replaceAllLogs([]);
  },

  // Phase 2: Indexed queries for fast lookups
  async getLogsByDate(date) {
    const db = await this.open();
    if (!db) return [];

    return await new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const index = store.index('date');
      const request = index.getAll(date);

      request.onsuccess = () => {
        resolve(Array.isArray(request.result) ? request.result : []);
      };
      request.onerror = () => {
        reject(request.error || new Error('Failed to query logs by date'));
      };
    });
  },

  async getLogsByDateRange(startDate, endDate) {
    const db = await this.open();
    if (!db) return [];

    return await new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const index = store.index('date');
      const range = IDBKeyRange.bound(startDate, endDate);
      const request = index.getAll(range);

      request.onsuccess = () => {
        resolve(Array.isArray(request.result) ? request.result : []);
      };
      request.onerror = () => {
        reject(request.error || new Error('Failed to query logs by date range'));
      };
    });
  },

  async getLogsByProject(projectId) {
    const db = await this.open();
    if (!db) return [];

    return await new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const index = store.index('project');
      const request = index.getAll(projectId);

      request.onsuccess = () => {
        resolve(Array.isArray(request.result) ? request.result : []);
      };
      request.onerror = () => {
        reject(request.error || new Error('Failed to query logs by project'));
      };
    });
  },

  async getLogsByCategory(category) {
    const db = await this.open();
    if (!db) return [];

    return await new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const index = store.index('category');
      const request = index.getAll(category);

      request.onsuccess = () => {
        resolve(Array.isArray(request.result) ? request.result : []);
      };
      request.onerror = () => {
        reject(request.error || new Error('Failed to query logs by category'));
      };
    });
  },

  async getOldLogs(daysAgo) {
    const db = await this.open();
    if (!db) return [];

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysAgo);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

    return await new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const index = store.index('date');
      const range = IDBKeyRange.upperBound(cutoffDateStr, true); // Exclusive
      const request = index.getAll(range);

      request.onsuccess = () => {
        resolve(Array.isArray(request.result) ? request.result : []);
      };
      request.onerror = () => {
        reject(request.error || new Error('Failed to query old logs'));
      };
    });
  },

  async deleteLogsByPaths(paths) {
    if (!paths || paths.length === 0) return;

    const db = await this.open();
    if (!db) return;

    const tx = db.transaction(this.storeName, 'readwrite');
    const store = tx.objectStore(this.storeName);

    for (const path of paths) {
      store.delete(path);
    }

    await this.waitForTransaction(tx);
  },

  // Phase 3: Archive management
  async saveArchive(archiveData) {
    const db = await this.open();
    if (!db) return;

    const tx = db.transaction(this.archiveStoreName, 'readwrite');
    const store = tx.objectStore(this.archiveStoreName);

    const archive = {
      createdAt: new Date().toISOString(),
      startDate: archiveData.startDate,
      endDate: archiveData.endDate,
      logCount: archiveData.logs.length,
      data: JSON.stringify(archiveData)
    };

    store.add(archive);
    await this.waitForTransaction(tx);
  },

  async getArchives() {
    const db = await this.open();
    if (!db) return [];

    return await new Promise((resolve, reject) => {
      const tx = db.transaction(this.archiveStoreName, 'readonly');
      const store = tx.objectStore(this.archiveStoreName);
      const request = store.getAll();

      request.onsuccess = () => {
        const archives = request.result || [];
        resolve(archives.map(a => ({
          id: a.id,
          createdAt: a.createdAt,
          startDate: a.startDate,
          endDate: a.endDate,
          logCount: a.logCount,
          data: JSON.parse(a.data)
        })));
      };
      request.onerror = () => {
        reject(request.error || new Error('Failed to get archives'));
      };
    });
  },

  async getLogCount() {
    const db = await this.open();
    if (!db) return 0;

    return await new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.count();

      request.onsuccess = () => {
        resolve(request.result || 0);
      };
      request.onerror = () => {
        reject(request.error || new Error('Failed to count logs'));
      };
    });
  }
};

// Make LogCache available globally
if (typeof window !== 'undefined') {
  window.LogCache = LogCache;
}
