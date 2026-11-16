/**
 * Guitar Score & Preset Vault: IndexedDB Storage Module
 * 
 * Provides robust offline client-side persistence with IndexedDB for:
 * 1. pedal_presets: Effects rack configurations, stompbox chains, and knob parameters
 * 2. custom_tunings: Open, drop, altered, and custom 6/7/8 string guitar tunings
 * 3. recorded_sessions: Captured audio/MIDI takes, tablature transcriptions, and metadata
 * 
 * Includes single-file JSON backup export/import and browser download/upload helpers.
 * Runs 100% client-side with zero external dependencies, and includes an in-memory
 * fallback for headless or non-IDB environments.
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        const exports = factory();
        root.GuitarVault = exports.GuitarVault;
        root.PresetVault = exports.PresetVault;
        root.guitarVault = exports.guitarVault;
        root.guitarStorage = exports.guitarStorage;
    }
}(typeof self !== 'undefined' ? self : this, function () {

    const DB_NAME = 'GuitarVisionVault';
    const DB_VERSION = 1;
    const STORES = {
        PRESETS: 'pedal_presets',
        TUNINGS: 'custom_tunings',
        SESSIONS: 'recorded_sessions'
    };

    /**
     * Generates a unique identifier.
     */
    function generateId(prefix = 'id') {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return `${prefix}_${crypto.randomUUID()}`;
        }
        return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    }

    /**
     * In-memory storage fallback for environments without IndexedDB (e.g. Node.js unit tests).
     */
    class MemoryStorageFallback {
        constructor() {
            this.stores = {
                [STORES.PRESETS]: new Map(),
                [STORES.TUNINGS]: new Map(),
                [STORES.SESSIONS]: new Map()
            };
        }

        async get(storeName, id) {
            const store = this.stores[storeName];
            if (!store) return null;
            const item = store.get(id);
            return item ? JSON.parse(JSON.stringify(item)) : null;
        }

        async getAll(storeName) {
            const store = this.stores[storeName];
            if (!store) return [];
            return Array.from(store.values()).map(item => JSON.parse(JSON.stringify(item)));
        }

        async put(storeName, item) {
            const store = this.stores[storeName];
            if (!store) throw new Error(`Unknown store: ${storeName}`);
            const record = JSON.parse(JSON.stringify(item));
            if (!record.id) {
                record.id = generateId(storeName.slice(0, 3));
            }
            const now = new Date().toISOString();
            if (!record.createdAt) record.createdAt = now;
            record.updatedAt = now;
            store.set(record.id, record);
            return record;
        }

        async delete(storeName, id) {
            const store = this.stores[storeName];
            if (store) {
                store.delete(id);
            }
            return true;
        }

        async clear(storeName) {
            const store = this.stores[storeName];
            if (store) {
                store.clear();
            }
            return true;
        }

        async count(storeName) {
            const store = this.stores[storeName];
            return store ? store.size : 0;
        }
    }

    /**
     * Robust IndexedDB Vault Wrapper managing pedal_presets, custom_tunings, and recorded_sessions.
     */
    class GuitarVault {
        constructor(options = {}) {
            this.dbName = options.dbName || DB_NAME;
            this.version = options.version || DB_VERSION;
            this.idbFactory = options.indexedDB || (typeof indexedDB !== 'undefined' ? indexedDB : null);
            this.db = null;
            this.useMemoryFallback = !this.idbFactory;
            this.memoryFallback = this.useMemoryFallback ? new MemoryStorageFallback() : null;
        }

        /**
         * Opens or verifies the IndexedDB connection and ensures object stores exist.
         * @returns {Promise<IDBDatabase|MemoryStorageFallback>}
         */
        async open() {
            if (this.useMemoryFallback) {
                return this.memoryFallback;
            }

            if (this.db) {
                return this.db;
            }

            return new Promise((resolve, reject) => {
                const request = this.idbFactory.open(this.dbName, this.version);

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;

                    // 1. pedal_presets store
                    if (!db.objectStoreNames.contains(STORES.PRESETS)) {
                        const presetStore = db.createObjectStore(STORES.PRESETS, { keyPath: 'id' });
                        presetStore.createIndex('name', 'name', { unique: false });
                        presetStore.createIndex('category', 'category', { unique: false });
                        presetStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                    }

                    // 2. custom_tunings store
                    if (!db.objectStoreNames.contains(STORES.TUNINGS)) {
                        const tuningStore = db.createObjectStore(STORES.TUNINGS, { keyPath: 'id' });
                        tuningStore.createIndex('name', 'name', { unique: false });
                        tuningStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                    }

                    // 3. recorded_sessions store
                    if (!db.objectStoreNames.contains(STORES.SESSIONS)) {
                        const sessionStore = db.createObjectStore(STORES.SESSIONS, { keyPath: 'id' });
                        sessionStore.createIndex('title', 'title', { unique: false });
                        sessionStore.createIndex('bpm', 'bpm', { unique: false });
                        sessionStore.createIndex('createdAt', 'createdAt', { unique: false });
                        sessionStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                    }
                };

                request.onsuccess = (event) => {
                    this.db = event.target.result;
                    this.db.onversionchange = () => {
                        this.db.close();
                        this.db = null;
                    };
                    resolve(this.db);
                };

                request.onerror = (event) => {
                    // In restricted browser environments (private mode), fallback to in-memory store
                    console.warn('IndexedDB open error, falling back to in-memory vault:', event.target.error);
                    this.useMemoryFallback = true;
                    this.memoryFallback = new MemoryStorageFallback();
                    resolve(this.memoryFallback);
                };

                request.onblocked = () => {
                    console.warn('IndexedDB database upgrade blocked by other active tab connections.');
                };
            });
        }

        /**
         * Closes the active database connection.
         */
        close() {
            if (this.db) {
                this.db.close();
                this.db = null;
            }
        }

        /**
         * Deletes the entire IndexedDB database.
         */
        async deleteDatabase() {
            this.close();
            if (this.useMemoryFallback) {
                this.memoryFallback = new MemoryStorageFallback();
                return true;
            }

            return new Promise((resolve, reject) => {
                const request = this.idbFactory.deleteDatabase(this.dbName);
                request.onsuccess = () => resolve(true);
                request.onerror = (e) => reject(e.target.error);
                request.onblocked = () => resolve(true);
            });
        }

        // =====================================================================
        // Generic Store Operations
        // =====================================================================

        async _getStore(storeName, mode = 'readonly') {
            await this.open();
            if (this.useMemoryFallback) {
                return null;
            }
            const tx = this.db.transaction(storeName, mode);
            return tx.objectStore(storeName);
        }

        /**
         * Retrieves a single item by ID from a given store.
         */
        async get(storeName, id) {
            if (this.useMemoryFallback) {
                return this.memoryFallback.get(storeName, id);
            }
            const store = await this._getStore(storeName, 'readonly');
            return new Promise((resolve, reject) => {
                const req = store.get(id);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            });
        }

        /**
         * Retrieves all items from a given store.
         */
        async getAll(storeName) {
            if (this.useMemoryFallback) {
                return this.memoryFallback.getAll(storeName);
            }
            const store = await this._getStore(storeName, 'readonly');
            return new Promise((resolve, reject) => {
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            });
        }

        /**
         * Saves or updates an item in a given store. Auto-generates ID and timestamps.
         */
        async save(storeName, item) {
            if (!item || typeof item !== 'object') {
                throw new Error(`Invalid item passed to save in store: ${storeName}`);
            }

            const record = { ...item };
            if (!record.id) {
                record.id = generateId(storeName.slice(0, 3));
            }
            const now = new Date().toISOString();
            if (!record.createdAt) {
                record.createdAt = now;
            }
            record.updatedAt = now;

            if (this.useMemoryFallback) {
                return this.memoryFallback.put(storeName, record);
            }

            const store = await this._getStore(storeName, 'readwrite');
            return new Promise((resolve, reject) => {
                const req = store.put(record);
                req.onsuccess = () => resolve(record);
                req.onerror = () => reject(req.error);
            });
        }

        /**
         * Alias for save()
         */
        async put(storeName, item) {
            return this.save(storeName, item);
        }

        /**
         * Deletes an item by ID from a given store.
         */
        async delete(storeName, id) {
            if (this.useMemoryFallback) {
                return this.memoryFallback.delete(storeName, id);
            }
            const store = await this._getStore(storeName, 'readwrite');
            return new Promise((resolve, reject) => {
                const req = store.delete(id);
                req.onsuccess = () => resolve(true);
                req.onerror = () => reject(req.error);
            });
        }

        /**
         * Clears all items from a given store.
         */
        async clear(storeName) {
            if (this.useMemoryFallback) {
                return this.memoryFallback.clear(storeName);
            }
            const store = await this._getStore(storeName, 'readwrite');
            return new Promise((resolve, reject) => {
                const req = store.clear();
                req.onsuccess = () => resolve(true);
                req.onerror = () => reject(req.error);
            });
        }

        /**
         * Counts items in a given store.
         */
        async count(storeName) {
            if (this.useMemoryFallback) {
                return this.memoryFallback.count(storeName);
            }
            const store = await this._getStore(storeName, 'readonly');
            return new Promise((resolve, reject) => {
                const req = store.count();
                req.onsuccess = () => resolve(req.result || 0);
                req.onerror = () => reject(req.error);
            });
        }

        // =====================================================================
        // Store 1: Pedal Presets (pedal_presets)
        // =====================================================================

        async savePreset(preset) {
            return this.save(STORES.PRESETS, preset);
        }

        async getPreset(id) {
            return this.get(STORES.PRESETS, id);
        }

        async getAllPresets() {
            return this.getAll(STORES.PRESETS);
        }

        async deletePreset(id) {
            return this.delete(STORES.PRESETS, id);
        }

        async clearPresets() {
            return this.clear(STORES.PRESETS);
        }

        // =====================================================================
        // Store 2: Custom Tunings (custom_tunings)
        // =====================================================================

        async saveTuning(tuning) {
            return this.save(STORES.TUNINGS, tuning);
        }

        async getTuning(id) {
            return this.get(STORES.TUNINGS, id);
        }

        async getAllTunings() {
            return this.getAll(STORES.TUNINGS);
        }

        async deleteTuning(id) {
            return this.delete(STORES.TUNINGS, id);
        }

        async clearTunings() {
            return this.clear(STORES.TUNINGS);
        }

        // =====================================================================
        // Store 3: Recorded Sessions & Takes (recorded_sessions)
        // =====================================================================

        async saveSession(session) {
            return this.save(STORES.SESSIONS, session);
        }

        async getSession(id) {
            return this.get(STORES.SESSIONS, id);
        }

        async getAllSessions() {
            return this.getAll(STORES.SESSIONS);
        }

        async deleteSession(id) {
            return this.delete(STORES.SESSIONS, id);
        }

        async clearSessions() {
            return this.clear(STORES.SESSIONS);
        }

        // =====================================================================
        // Backup & Restore: Single-File Vault JSON Export & Import
        // =====================================================================

        /**
         * Exports all stores from the vault as a unified backup payload.
         * @param {Object} options
         * @param {boolean} options.asString Whether to return a formatted JSON string (default: true)
         * @returns {Promise<string|Object>}
         */
        async exportVault(options = { asString: true }) {
            const [presets, tunings, sessions] = await Promise.all([
                this.getAll(STORES.PRESETS),
                this.getAll(STORES.TUNINGS),
                this.getAll(STORES.SESSIONS)
            ]);

            const payload = {
                vaultFormat: 'GuitarVisionVault',
                schemaVersion: '1.0',
                exportedAt: new Date().toISOString(),
                stats: {
                    pedal_presets_count: presets.length,
                    custom_tunings_count: tunings.length,
                    recorded_sessions_count: sessions.length,
                    total_items: presets.length + tunings.length + sessions.length
                },
                stores: {
                    [STORES.PRESETS]: presets,
                    [STORES.TUNINGS]: tunings,
                    [STORES.SESSIONS]: sessions
                }
            };

            return options.asString ? JSON.stringify(payload, null, 2) : payload;
        }

        /**
         * Imports vault data from a JSON string or parsed object into the object stores.
         * @param {string|Object} jsonData
         * @param {Object} options
         * @param {boolean} options.clearExisting If true, empties stores before importing
         * @returns {Promise<{success: boolean, imported: Object, total: number}>}
         */
        async importVault(jsonData, options = { clearExisting: false }) {
            let data = jsonData;
            if (typeof data === 'string') {
                try {
                    data = JSON.parse(data);
                } catch (e) {
                    throw new Error(`Invalid JSON format provided for vault import: ${e.message}`);
                }
            }

            if (!data || typeof data !== 'object') {
                throw new Error('Vault import payload must be a non-null object.');
            }

            // Locate stores structure
            const sourceStores = data.stores || data;
            const presetsToImport = Array.isArray(sourceStores[STORES.PRESETS]) ? sourceStores[STORES.PRESETS] : [];
            const tuningsToImport = Array.isArray(sourceStores[STORES.TUNINGS]) ? sourceStores[STORES.TUNINGS] : [];
            const sessionsToImport = Array.isArray(sourceStores[STORES.SESSIONS]) ? sourceStores[STORES.SESSIONS] : [];

            if (options.clearExisting) {
                await Promise.all([
                    this.clear(STORES.PRESETS),
                    this.clear(STORES.TUNINGS),
                    this.clear(STORES.SESSIONS)
                ]);
            }

            let presetsCount = 0;
            for (const preset of presetsToImport) {
                if (preset && typeof preset === 'object') {
                    await this.save(STORES.PRESETS, preset);
                    presetsCount++;
                }
            }

            let tuningsCount = 0;
            for (const tuning of tuningsToImport) {
                if (tuning && typeof tuning === 'object') {
                    await this.save(STORES.TUNINGS, tuning);
                    tuningsCount++;
                }
            }

            let sessionsCount = 0;
            for (const session of sessionsToImport) {
                if (session && typeof session === 'object') {
                    await this.save(STORES.SESSIONS, session);
                    sessionsCount++;
                }
            }

            return {
                success: true,
                imported: {
                    [STORES.PRESETS]: presetsCount,
                    [STORES.TUNINGS]: tuningsCount,
                    [STORES.SESSIONS]: sessionsCount
                },
                total: presetsCount + tuningsCount + sessionsCount
            };
        }

        // =====================================================================
        // Browser Helper Utilities
        // =====================================================================

        /**
         * Triggers client-side browser download of the complete vault as a .json file.
         */
        async downloadVaultBackup(filename = 'guitar_vault_backup.json') {
            if (typeof document === 'undefined' || typeof Blob === 'undefined') {
                throw new Error('downloadVaultBackup is only available in browser environments.');
            }

            const jsonString = await this.exportVault({ asString: true });
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            return true;
        }

        /**
         * Reads a user-selected File/Blob and imports it into the vault.
         * @param {File|Blob} file
         * @param {Object} options
         */
        async importVaultFromFile(file, options = { clearExisting: false }) {
            if (typeof FileReader === 'undefined') {
                throw new Error('importVaultFromFile requires browser FileReader API.');
            }

            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = async (e) => {
                    try {
                        const content = e.target.result;
                        const result = await this.importVault(content, options);
                        resolve(result);
                    } catch (err) {
                        reject(err);
                    }
                };
                reader.onerror = () => reject(reader.error);
                reader.readAsText(file);
            });
        }
    }

    // Default shared instance
    const defaultVault = new GuitarVault();

    return {
        GuitarVault,
        PresetVault: GuitarVault,
        StorageVault: GuitarVault,
        guitarVault: defaultVault,
        guitarStorage: defaultVault,
        STORES
    };
}));
