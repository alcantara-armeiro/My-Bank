





window.addEventListener('error', function(e){
 var root=document.getElementById('root');
 if(root && !root.innerHTML.trim()){root.innerHTML='<pre style="white-space:pre-wrap;color:#ff6b75;background:#050505;padding:24px;font:16px monospace">Erro no My Bank: '+(e.message||'Script error')+'\n'+(e.filename||'')+':'+(e.lineno||0)+':'+(e.colno||0)+'</pre>'}
});
window.addEventListener('unhandledrejection', function(e){
 var root=document.getElementById('root');
 if(root && !root.innerHTML.trim()){root.innerHTML='<pre style="white-space:pre-wrap;color:#ff6b75;background:#050505;padding:24px;font:16px monospace">Erro no My Bank: '+((e.reason&&e.reason.message)||e.reason||'Promise error')+'</pre>'}
});


        // ===== STORAGE BRIDGE V11 CLEAN BACKUP =====
        const SafeStorage = (() => {
            const DB_NAME = 'mybank_storage_v2';
            const STORE = 'kv';
            const VERSION = 1;
            const MIGRATION_FLAG = '__mybank_idb_migrated_v2__';
            const memory = {};
            let dbPromise = null;
            let readyResolve;
            const ready = new Promise(resolve => { readyResolve = resolve; });

            const cloneValue = (v) => v === undefined ? null : String(v);
            const keysToMirror = [
                'mybank_transactions','mybank_fixed','mybank_budgets','mybank_cards','mybank_card_entries','mybank_withdrawal_limit','mybank_debt_plan'
            ];

            function openDb() {
                if (dbPromise) return dbPromise;
                dbPromise = new Promise((resolve, reject) => {
                    const request = indexedDB.open(DB_NAME, VERSION);
                    request.onupgradeneeded = (event) => {
                        const db = event.target.result;
                        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
                    };
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error || new Error('Falha ao abrir IndexedDB'));
                });
                return dbPromise;
            }

            async function idbSetItem(key, value) {
                const db = await openDb();
                return new Promise((resolve, reject) => {
                    const tr = db.transaction(STORE, 'readwrite');
                    const st = tr.objectStore(STORE);
                    const req = st.put({ key, value: cloneValue(value), updatedAt: Date.now() });
                    req.onsuccess = () => resolve(true);
                    req.onerror = () => reject(req.error);
                });
            }

            async function idbRemoveItem(key) {
                const db = await openDb();
                return new Promise((resolve, reject) => {
                    const tr = db.transaction(STORE, 'readwrite');
                    const st = tr.objectStore(STORE);
                    const req = st.delete(key);
                    req.onsuccess = () => resolve(true);
                    req.onerror = () => reject(req.error);
                });
            }

            async function bootstrap() {
                if (!('indexedDB' in window)) {
                    console.warn('IndexedDB indisponível; usando localStorage padrão.');
                    readyResolve();
                    return;
                }
                try {
                    const db = await openDb();
                    const rows = await new Promise((resolve, reject) => {
                        const tr = db.transaction(STORE, 'readonly');
                        const st = tr.objectStore(STORE);
                        const req = st.getAll();
                        req.onsuccess = () => resolve(req.result || []);
                        req.onerror = () => reject(req.error);
                    });

                    rows.forEach(row => {
                        if (!row || !row.key) return;
                        memory[row.key] = cloneValue(row.value);
                        if (row.value !== null && row.value !== undefined) {
                            try { localStorage.setItem(row.key, cloneValue(row.value)); } catch (_) {}
                        }
                    });

                    const alreadyMigrated = localStorage.getItem(MIGRATION_FLAG) === 'true' || memory[MIGRATION_FLAG] === 'true';
                    if (!alreadyMigrated) {
                        const pending = [];
                        for (let i = 0; i < localStorage.length; i++) {
                            const key = localStorage.key(i);
                            if (!key) continue;
                            if (!keysToMirror.includes(key) && !key.startsWith('mybank_')) continue;
                            const value = localStorage.getItem(key);
                            memory[key] = cloneValue(value);
                            pending.push(idbSetItem(key, value));
                        }
                        pending.push(idbSetItem(MIGRATION_FLAG, 'true'));
                        memory[MIGRATION_FLAG] = 'true';
                        await Promise.allSettled(pending);
                        try { localStorage.setItem(MIGRATION_FLAG, 'true'); } catch (_) {}
                    }
                } catch (error) {
                    console.warn('Falha no bootstrap do IndexedDB:', error);
                } finally {
                    readyResolve();
                    window.dispatchEvent(new CustomEvent('mybank-storage-ready'));
                }
            }

            bootstrap();

            return {
                ready,
                getItem(key) {
                    if (Object.prototype.hasOwnProperty.call(memory, key)) return memory[key];
                    const raw = localStorage.getItem(key);
                    if (raw !== null && raw !== undefined) memory[key] = cloneValue(raw);
                    return raw;
                },
                setItem(key, value) {
                    const normalized = cloneValue(value);
                    memory[key] = normalized;
                    localStorage.setItem(key, normalized);
                    if ('indexedDB' in window) idbSetItem(key, normalized).catch(err => console.warn('Falha ao persistir no IndexedDB:', err));
                },
                removeItem(key) {
                    delete memory[key];
                    localStorage.removeItem(key);
                    if ('indexedDB' in window) idbRemoveItem(key).catch(err => console.warn('Falha ao remover do IndexedDB:', err));
                },
                async exportAll() {
                    const db = await openDb();
                    return new Promise((resolve, reject) => {
                        const tr = db.transaction(STORE, 'readonly');
                        const st = tr.objectStore(STORE);
                        const req = st.getAll();
                        req.onsuccess = () => resolve(req.result || []);
                        req.onerror = () => reject(req.error);
                    });
                },
                async estimateUsage() {
                    let localBytes = 0;
                    try {
                        for (let i = 0; i < localStorage.length; i++) {
                            const key = localStorage.key(i);
                            const val = localStorage.getItem(key) || '';
                            localBytes += (String(key).length + String(val).length) * 2;
                        }
                    } catch (_) {}
                    let idbBytes = 0;
                    let rows = [];
                    try {
                        rows = await this.exportAll();
                        rows.forEach(row => {
                            const key = String(row?.key || '');
                            const val = String(row?.value || '');
                            idbBytes += (key.length + val.length) * 2;
                        });
                    } catch (_) {}
                    let quota = 0, usage = 0;
                    try {
                        if (navigator.storage && navigator.storage.estimate) {
                            const est = await navigator.storage.estimate();
                            quota = Number(est?.quota || 0);
                            usage = Number(est?.usage || 0);
                        }
                    } catch (_) {}
                    return { localBytes, idbBytes, quota, usage, rows: rows.length };
                },
                async compactData() {
                    const keys = [
                        'mybank_transactions','mybank_fixed','mybank_cards','mybank_card_entries',
                        'mybank_budgets','mybank_withdrawal_limit','mybank_debt_plan'
                    ];
                    let cleaned = 0;
                    for (const key of keys) {
                        const raw = this.getItem(key);
                        if (raw === null || raw === undefined || raw === '') continue;
                        try {
                            const parsed = JSON.parse(raw);
                            if (Array.isArray(parsed)) {
                                const compacted = parsed.filter(Boolean);
                                this.setItem(key, JSON.stringify(compacted));
                                cleaned += Math.max(0, parsed.length - compacted.length);
                            } else if (parsed && typeof parsed === 'object') {
                                this.setItem(key, JSON.stringify(parsed));
                            }
                        } catch (_) {}
                    }
                    return { cleaned };
                },
                async restoreRows(rows) {
                    if (!Array.isArray(rows)) throw new Error('Backup inválido');
                    for (const row of rows) {
                        if (!row || !row.key) continue;
                        this.setItem(String(row.key), cloneValue(row.value));
                    }
                    return true;
                }
            };
        })();
    

const { useState, useEffect, useRef, useCallback, useMemo } = React;
const safeJsonParse = (rawValue, fallbackValue) => {
    if (rawValue === null || rawValue === undefined || rawValue === '')
        return fallbackValue;
    try {
        return JSON.parse(rawValue);
    }
    catch (error) {
        console.warn('Falha ao ler JSON do localStorage:', error);
        return fallbackValue;
    }
};
const formatBytes = (bytes = 0) => {
    const value = Number(bytes || 0);
    if (!value)
        return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let out = value;
    while (out >= 1024 && i < units.length - 1) {
        out /= 1024;
        i += 1;
    }
    return `${out.toFixed(out >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
};
const downloadJsonFile = (filename, payload) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
};
const APP_BACKUP_KEYS = [
    'mybank_transactions','mybank_fixed','mybank_budgets','mybank_cards','mybank_card_entries','mybank_withdrawal_limit','mybank_debt_plan'
];

const shareJsonFile = async (filename, payload, shareText = 'Backup do app') => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const file = new File([blob], filename, { type: 'application/json' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
            files: [file],
            title: 'Backup My Bank',
            text: shareText
        });
        return true;
    }
    downloadJsonFile(filename, payload);
    return false;
};
const isoToday = () => new Date().toISOString().slice(0, 10);
const isIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const asArray = (value) => Array.isArray(value) ? value : [];
const normalizeBankDate = (value, fallback = isoToday()) => {
    const raw = String(value || '').trim();
    if (!raw)
        return fallback;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const probe = new Date(`${raw}T12:00:00`);
        return Number.isNaN(probe.getTime()) ? fallback : raw;
    }
    const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) {
        const iso = `${br[3]}-${br[2]}-${br[1]}`;
        const probe = new Date(`${iso}T12:00:00`);
        return Number.isNaN(probe.getTime()) ? fallback : iso;
    }
    const probe = new Date(raw);
    if (!Number.isNaN(probe.getTime()))
        return probe.toISOString().slice(0, 10);
    return fallback;
};
const normalizeBankTransaction = (item, fallbackIndex = 0) => {
    if (!item || typeof item !== 'object')
        return null;
    return {
        ...item,
        id: String(item.id || `bank_tx_${Date.now()}_${fallbackIndex}`),
        area: 'pessoal',
        type: item.type === 'saida' ? 'saida' : 'entrada',
        category: String(item.category || (item.type === 'saida' ? 'Outros' : 'Serviço')).trim() || (item.type === 'saida' ? 'Outros' : 'Serviço'),
        description: String(item.description || '').trim(),
        value: Number(item.value || 0),
        date: normalizeBankDate(item.date),
        paymentDate: item.paymentDate ? normalizeBankDate(item.paymentDate, normalizeBankDate(item.date)) : item.paymentDate,
        sourceOrderDate: item.sourceOrderDate ? normalizeBankDate(item.sourceOrderDate, normalizeBankDate(item.date)) : item.sourceOrderDate,
        obs: String(item.obs || '').trim()
    };
};
const normalizeBankTransactions = (value) => asArray(value)
    .map((item, index) => normalizeBankTransaction(item, index))
    .filter(item => item && item.description && Number(item.value || 0) > 0);
const normalizeDayValue = (value) => {
    const raw = parseInt(value, 10);
    return Number.isInteger(raw) && raw >= 1 && raw <= 31 ? raw : '';
};
const normalizeCardEntry = (item, fallbackIndex = 0) => {
    if (!item || typeof item !== 'object')
        return null;
    const installmentCount = Math.max(parseInt(item.installmentCount || 1, 10) || 1, 1);
    const installmentIndex = Math.min(Math.max(parseInt(item.installmentIndex || 1, 10) || 1, 1), installmentCount);
    const date = normalizeBankDate(item.date);
    const purchaseDate = item.purchaseDate ? normalizeBankDate(item.purchaseDate, date) : date;
    return {
        ...item,
        id: String(item.id || `card_entry_${Date.now()}_${fallbackIndex}`),
        cardId: String(item.cardId || '').trim(),
        area: 'pessoal',
        category: String(item.category || 'Outros').trim() || 'Outros',
        description: String(item.description || '').trim(),
        value: Number(item.value || 0),
        totalPurchaseValue: Number(item.totalPurchaseValue || item.value || 0),
        date,
        purchaseDate,
        invoiceMonth: /^\d{4}-\d{2}$/.test(String(item.invoiceMonth || '')) ? String(item.invoiceMonth) : '',
        isInstallment: installmentCount > 1 || item.isInstallment === true,
        installmentCount,
        installmentIndex,
        installmentValue: Number(item.installmentValue || item.value || 0),
        installmentGroupId: String(item.installmentGroupId || '').trim(),
        isRecurring: item.isRecurring === true,
        recurringGroupId: String(item.recurringGroupId || '').trim(),
        recurringIndex: Math.max(parseInt(item.recurringIndex || 1, 10) || 1, 1),
        recurringActive: item.recurringActive !== false,
        recurrenceMonths: Math.max(parseInt(item.recurrenceMonths || 72, 10) || 72, 1),
        obs: String(item.obs || '').trim()
    };
};
const normalizeCardEntries = (value) => asArray(value)
    .map((item, index) => normalizeCardEntry(item, index))
    .filter(item => item && item.cardId && item.description && Number(item.value || 0) > 0);
const normalizeCard = (item, fallbackIndex = 0) => {
    if (!item || typeof item !== 'object')
        return null;
    const name = String(item.name || '').trim();
    const dueDay = normalizeDayValue(item.dueDay);
    const closingDay = normalizeDayValue(item.closingDay || dueDay);
    const bestPurchaseDay = normalizeDayValue(item.bestPurchaseDay || (closingDay ? (Number(closingDay) === 31 ? 1 : Number(closingDay) + 1) : ''));
    return name ? {
        ...item,
        id: String(item.id || `card_${Date.now()}_${fallbackIndex}`),
        name,
        brand: String(item.brand || '').trim(),
        final: String(item.final || '').replace(/\D/g, '').slice(-4),
        limit: Number(item.limit || 0) > 0 ? Number(item.limit) : '',
        dueDay,
        closingDay,
        bestPurchaseDay,
        createdAt: item.createdAt || new Date().toISOString()
    } : null;
};
const normalizeCards = (value) => asArray(value)
    .map((item, index) => normalizeCard(item, index))
    .filter(Boolean);
const normalizeBudgets = (value) => ({
    personal: Number(value === null || value === void 0 ? void 0 : value.personal) > 0 ? Number(value.personal) : 2500,
    workshop: 0
});
const normalizeFixedBill = (bill, fallbackIndex = 0) => {
    var _a;
    if (!bill || typeof bill !== 'object')
        return null;
    const rawDate = isIsoDate(bill.date) ? bill.date : isoToday();
    const parsedDay = parseInt((_a = bill.day) !== null && _a !== void 0 ? _a : rawDate.slice(8, 10), 10);
    const safeDay = Number.isInteger(parsedDay) && parsedDay >= 1 && parsedDay <= 31
        ? parsedDay
        : parseInt(rawDate.slice(8, 10), 10);
    const name = String(bill.name || '').trim();
    const value = Number(bill.value || 0);
    if (!name || value <= 0)
        return null;
    return {
        ...bill,
        id: String(bill.id || `fixed_${Date.now()}_${fallbackIndex}`),
        name,
        value,
        date: isIsoDate(bill.date) ? bill.date : `${rawDate.slice(0, 7)}-${String(safeDay).padStart(2, '0')}`,
        day: safeDay,
        area: 'pessoal',
        active: bill.active !== false,
        paidMonths: Array.isArray(bill.paidMonths)
            ? [...new Set(bill.paidMonths.filter(m => /^\d{4}-\d{2}$/.test(String(m))))]
            : []
    };
};
const normalizeFixedBills = (value) => asArray(value)
    .map((bill, index) => normalizeFixedBill(bill, index))
    .filter(Boolean);
// ========== DB CONTEXT (estado global reativo) ==========
const DbContext = React.createContext(null);
const dbReducer = (state, action) => {
    let orders, products, catalog;
    switch (action.type) {
        case 'LOAD':
            return {
                orders: asArray(safeJsonParse(SafeStorage.getItem('alcantara_os'), [])),
                catalog: asArray(safeJsonParse(SafeStorage.getItem('alcantara_catalog'), [])),
                products: asArray(safeJsonParse(SafeStorage.getItem('alcantara_products'), [])),
            };
        case 'SAVE_ORDER':
            orders = [...state.orders];
            const idx = orders.findIndex(o => o.id === action.order.id);
            if (idx !== -1)
                orders[idx] = action.order;
            else
                orders.unshift(action.order);
            SafeStorage.setItem('alcantara_os', JSON.stringify(orders));
            return { ...state, orders };
        case 'DELETE_ORDER':
            orders = state.orders.filter(o => o.id !== action.id);
            SafeStorage.setItem('alcantara_os', JSON.stringify(orders));
            return { ...state, orders };
        case 'SAVE_CATALOG_ITEM':
            catalog = [...state.catalog];
            const exists = catalog.find(c => c.name.toLowerCase() === action.item.name.toLowerCase() && c.type === action.item.type);
            if (!exists) {
                catalog.push({ ...action.item, id: Date.now().toString() });
                SafeStorage.setItem('alcantara_catalog', JSON.stringify(catalog));
                return { ...state, catalog };
            }
            return state;
        case 'DELETE_CATALOG_ITEM':
            catalog = state.catalog.filter(i => i.id !== action.id);
            SafeStorage.setItem('alcantara_catalog', JSON.stringify(catalog));
            return { ...state, catalog };
        case 'UPDATE_CATALOG_ITEM': {
            const previousItem = state.catalog.find(i => i.id === action.item.id) || null;
            catalog = state.catalog.map(i => i.id === action.item.id ? action.item : i);
            const normalizeItemName = (value) => String(value || '')
                .normalize('NFD')
                .replace(/[̀-ͯ]/g, '')
                .trim()
                .toUpperCase();
            const syncOrderItems = (items, expectedType) => asArray(items).map(entry => {
                const matchesByCatalogId = String((entry === null || entry === void 0 ? void 0 : entry.catalogId) || '') === String(action.item.id || '');
                const matchesByLegacyName = previousItem
                    && expectedType === action.item.type
                    && !(entry === null || entry === void 0 ? void 0 : entry.catalogId)
                    && normalizeItemName(entry === null || entry === void 0 ? void 0 : entry.name) === normalizeItemName(previousItem === null || previousItem === void 0 ? void 0 : previousItem.name);
                if (!matchesByCatalogId && !matchesByLegacyName)
                    return entry;
                const quantity = Math.max(1, parseInt(entry === null || entry === void 0 ? void 0 : entry.quantity, 10) || 1);
                const unitPrice = parseFloat(action.item.price) || 0;
                return {
                    ...entry,
                    name: action.item.name,
                    type: action.item.type,
                    catalogId: action.item.id,
                    unitPrice,
                    price: unitPrice * quantity
                };
            });
            orders = state.orders.map(order => ({
                ...order,
                services: syncOrderItems(order.services, 'service'),
                parts: syncOrderItems(order.parts, 'part'),
                products: syncOrderItems(order.products, 'product')
            }));
            SafeStorage.setItem('alcantara_catalog', JSON.stringify(catalog));
            SafeStorage.setItem('alcantara_os', JSON.stringify(orders));
            return { ...state, catalog, orders };
        }
        case 'SAVE_PRODUCT':
            products = [...state.products];
            const pExists = products.find(p => p.name.toLowerCase() === action.product.name.toLowerCase());
            if (!pExists) {
                products.push({ ...action.product, id: Date.now().toString(),
                    stock: parseInt(action.product.stock) || 0,
                    price: parseFloat(action.product.price) || 0,
                    costPrice: parseFloat(action.product.costPrice || action.product.purchasePrice || 0) || 0 });
                SafeStorage.setItem('alcantara_products', JSON.stringify(products));
                return { ...state, products };
            }
            return state;
        case 'UPDATE_PRODUCT':
            products = state.products.map(p => p.id === action.product.id
                ? { ...action.product, stock: parseInt(action.product.stock) || 0, price: parseFloat(action.product.price) || 0 }
                : p);
            SafeStorage.setItem('alcantara_products', JSON.stringify(products));
            return { ...state, products };
        case 'DELETE_PRODUCT':
            products = state.products.filter(p => p.id !== action.id);
            SafeStorage.setItem('alcantara_products', JSON.stringify(products));
            return { ...state, products };
        case 'RESERVE_STOCK': {
            products = [...state.products];
            const pi = products.findIndex(p => p.id === action.productId);
            if (pi === -1)
                return state;
            const cur = parseInt(products[pi].stock) || 0;
            if (cur < action.qty)
                return state;
            products[pi] = { ...products[pi], stock: cur - action.qty };
            SafeStorage.setItem('alcantara_products', JSON.stringify(products));
            return { ...state, products };
        }
        case 'RELEASE_STOCK': {
            products = [...state.products];
            const ri = products.findIndex(p => p.id === action.productId);
            if (ri === -1)
                return state;
            products[ri] = { ...products[ri], stock: (parseInt(products[ri].stock) || 0) + action.qty };
            SafeStorage.setItem('alcantara_products', JSON.stringify(products));
            return { ...state, products };
        }
        default:
            return state;
    }
};
const DbProvider = ({ children }) => {
    const [state, dispatch] = React.useReducer(dbReducer, null, () => ({
        orders: asArray(safeJsonParse(SafeStorage.getItem('alcantara_os'), [])),
        catalog: asArray(safeJsonParse(SafeStorage.getItem('alcantara_catalog'), [])),
        products: asArray(safeJsonParse(SafeStorage.getItem('alcantara_products'), [])),
    }));
    return (React.createElement(DbContext.Provider, { value: { state, dispatch } }, children));
};
const useDb = () => React.useContext(DbContext);
// ========== MÁSCARA DE TELEFONE ==========
const formatPhone = (v) => {
    const d = v.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2)
        return d;
    if (d.length <= 6)
        return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10)
        return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};
const PhoneInput = ({ value, onChange, placeholder = "WhatsApp", className = "" }) => (React.createElement("input", { type: "tel", inputMode: "numeric", className: className, placeholder: placeholder, value: value, onChange: e => onChange(formatPhone(e.target.value)), maxLength: 15, "aria-label": placeholder }));
// ========== MODAL DE CONFIRMAÇÃO (substitui confirm() nativo) ==========
const ConfirmModal = ({ message, subMessage, onConfirm, onCancel, confirmLabel = "CONFIRMAR", confirmClass = "gold-gradient", icon = "alert-triangle" }) => (React.createElement("div", { className: "modal-overlay", onClick: onCancel, role: "dialog", "aria-modal": "true", "aria-label": "Confirma\u00E7\u00E3o" },
    React.createElement("div", { className: "modal-content p-6", onClick: e => e.stopPropagation() },
        React.createElement("div", { className: "flex flex-col items-center text-center gap-4 mb-6" },
            React.createElement("div", { className: "w-16 h-16 rounded-full border border-yellow-500/30 flex items-center justify-center overflow-hidden" },
                React.createElement("img", { src: LOGO_URL, className: "w-full h-full object-cover logo-premium-animated" })),
            React.createElement("div", null,
                React.createElement("p", { className: "font-usarmy text-white text-sm mb-1" }, message),
                subMessage && React.createElement("p", { className: "text-gray-500 text-xs" }, subMessage))),
        React.createElement("div", { className: "grid grid-cols-2 gap-3" },
            React.createElement("button", { onClick: onCancel, className: "p-4 rounded-xl border-2 border-white/10 text-gray-400 font-usarmy text-xs" }, "CANCELAR"),
            React.createElement("button", { onClick: onConfirm, className: `p-4 rounded-xl font-usarmy text-xs ${confirmClass}` }, confirmLabel)))));
const useConfirm = () => {
    const [cfg, setCfg] = useState(null);
    const confirm = useCallback((opts) => new Promise(resolve => {
        setCfg({ ...opts, resolve });
    }), []);
    const modal = cfg ? (React.createElement(ConfirmModal, { ...cfg, onConfirm: () => { cfg.resolve(true); setCfg(null); }, onCancel: () => { cfg.resolve(false); setCfg(null); } })) : null;
    return { confirm, modal };
};
// ========== LISTA VIRTUALIZADA (paginação incremental) ==========
const PAGE_SIZE = 20;
const VirtualOrderList = ({ items, onSelect }) => {
    const [page, setPage] = useState(1);
    const visible = useMemo(() => items.slice(0, page * PAGE_SIZE), [items, page]);
    const hasMore = visible.length < items.length;
    const loaderRef = useRef(null);
    useEffect(() => {
        if (!loaderRef.current || !hasMore)
            return;
        const obs = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting)
                setPage(p => p + 1);
        }, { threshold: 0.1 });
        obs.observe(loaderRef.current);
        return () => obs.disconnect();
    }, [hasMore]);
    // reset page when items change (filter/search)
    useEffect(() => setPage(1), [items]);
    return (React.createElement(React.Fragment, null,
        visible.map(o => {
            const statusConfig = STATUS_CONFIG[o.status] || STATUS_CONFIG.ABERTA;
            return (React.createElement("div", { key: o.id, onClick: () => onSelect(o), className: "os-card p-4 rounded-xl cursor-pointer transition-all hover:scale-[1.01] active:scale-[0.99]", role: "button", tabIndex: 0, onKeyDown: e => e.key === 'Enter' && onSelect(o), "aria-label": `OS #${o.osNumber} - ${o.customerName}` },
                React.createElement("div", { className: "flex justify-between items-start mb-2" },
                    React.createElement("div", { className: "flex-1 min-w-0 mr-3" },
                        React.createElement("p", { className: "text-[8px] text-gray-600 font-mono mb-1" },
                            "OS #",
                            o.osNumber),
                        React.createElement("p", { className: "font-bold text-white text-sm truncate" }, o.customerName),
                        React.createElement("p", { className: "text-xs text-gray-500 truncate mt-1" }, o.equipment)),
                    React.createElement("div", { className: "text-right flex-shrink-0" },
                        React.createElement("p", { className: "font-usarmy text-[#d4af37] text-base" },
                            "R$ ",
                            calculateTotal(o).toFixed(2)),
                        React.createElement("p", { className: "text-[9px] text-gray-600 mt-1" }, o.date))),
                React.createElement("div", { className: "flex items-center justify-between mt-3 pt-2 border-t border-white/5" },
                    React.createElement("div", { className: `status-badge ${statusConfig.bg} ${statusConfig.text} ${statusConfig.border} border` }, statusConfig.label),
                    React.createElement("span", { className: `payment-badge ${o.paymentStatus === 'PAGO' ? 'paid' : 'pending'}` },
                        React.createElement("i", { "data-lucide": o.paymentStatus === 'PAGO' ? 'check-circle' : 'clock', className: "w-3 h-3" }),
                        o.paymentStatus === 'PAGO' ? 'PAGO' : 'PENDENTE'))));
        }),
        hasMore && (React.createElement("div", { ref: loaderRef, className: "flex justify-center py-6" },
            React.createElement("div", { className: "loading-spinner" }))),
        items.length === 0 && (React.createElement("div", { className: "text-center py-20" },
            React.createElement("i", { "data-lucide": "inbox", className: "w-16 h-16 text-gray-700 mx-auto mb-4" }),
            React.createElement("p", { className: "text-gray-600 font-usarmy text-xs" }, "NENHUMA ORDEM ENCONTRADA")))));
};
// ========== CONFIGURAÇÕES ==========
// Auth: comparação em tempo constante para evitar timing attacks
const verifyPassword = (input) => {
    const encoded = btoa(input).split('').reverse().join('');
    const expected = '==ANzITM';
    if (encoded.length !== expected.length)
        return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
        diff |= encoded.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return diff === 0;
};
const LOGO_URL = "./icons/logo.jpg?v=19";
// Logo embutido para PDF: evita falha online por CORS/cache de imagem externa.
const LOGO_DATA_URL = "";
const getPdfLogoDataUrl = async () => LOGO_DATA_URL;
// ========== PDF PREMIUM HELPERS ==========
const brMoney = (value) => `R$ ${Number(value || 0).toFixed(2).replace('.', ',')}`;
const pdfSafeText = (value, fallback = 'Não informado') => String(value !== null && value !== void 0 ? value : '').trim() || fallback;
const drawPdfWatermark = (doc) => {
    try {
        doc.setTextColor(247, 247, 247);
        doc.setFont('courier', 'bold');
        doc.setFontSize(33);
        doc.text('MY BANK', 105, 154, { align: 'center', angle: 35 });
    }
    catch (_) { }
};
const drawPremiumPdfHeader = async (doc, title, rightRows = []) => {
    doc.setFillColor(5, 5, 5);
    doc.rect(0, 0, 210, 48, 'F');
    doc.setFillColor(16, 16, 16);
    doc.rect(0, 48, 210, 5, 'F');
    doc.setFillColor(212, 175, 55);
    doc.rect(0, 52, 210, 1.2, 'F');
    try {
        const logoDataUrl = await getPdfLogoDataUrl();
        doc.addImage(logoDataUrl, 'JPEG', 10, 6, 34, 34);
    }
    catch (e) {
        doc.setTextColor(212, 175, 55);
        doc.setFontSize(24);
        doc.setFont('courier', 'bold');
        doc.text('AA', 18, 27);
    }
    doc.setTextColor(212, 175, 55);
    doc.setFont('courier', 'bold');
    doc.setFontSize(18);
    doc.text('MY BANK', 50, 13);
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(220, 220, 220);
    doc.text(`CNPJ: ${DADOS_EMPRESA.cnpj}`, 50, 19);
    doc.text(DADOS_EMPRESA.endereco, 50, 24);
    doc.text(`${DADOS_EMPRESA.bairro} | ${DADOS_EMPRESA.cidade}`, 50, 29);
    doc.text(DADOS_EMPRESA.contato, 50, 34);
    doc.setTextColor(255, 255, 255);
    doc.setFont('courier', 'bold');
    doc.setFontSize(9);
    doc.text(title, 50, 42);
    let y = 12;
    rightRows.forEach(row => { doc.setFont('courier', 'normal'); doc.setFontSize(8); doc.setTextColor(190, 190, 190); doc.text(`${row.label}:`, 142, y); doc.setFont('courier', 'bold'); doc.setTextColor(255, 255, 255); const lines = doc.splitTextToSize(String(row.value || '-'), 34); doc.text(lines, 170, y); y += Math.max(6, lines.length * 4.5); });
};
const drawPdfFooter = (doc, label = 'Documento gerado eletronicamente') => {
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setDrawColor(212, 175, 55);
        doc.setLineWidth(0.2);
        doc.line(14, 286, 196, 286);
        doc.setFont('courier', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(120, 120, 120);
        doc.text(`My Bank - Pessoal | ${label}`, 14, 291);
        doc.text(`Página ${i}/${totalPages}`, 196, 291, { align: 'right' });
    }
};
const pdfSectionTitle = (doc, title, y) => { doc.setFillColor(10, 10, 10); doc.roundedRect(14, y - 5, 182, 9, 2, 2, 'F'); doc.setFillColor(212, 175, 55); doc.rect(14, y - 5, 2.5, 9, 'F'); doc.setTextColor(212, 175, 55); doc.setFont('courier', 'bold'); doc.setFontSize(9); doc.text(title, 20, y + 1); return y + 12; };
const pdfCheckPage = async (doc, y, needed = 20, title = '') => { if (y + needed <= 276)
    return y; doc.addPage(); await drawPremiumPdfHeader(doc, title || 'MY BANK', []); drawPdfWatermark(doc); return 65; };
const pdfInfoRow = (doc, label, value, x, y, width = 80) => { doc.setFont('courier', 'bold'); doc.setFontSize(7.5); doc.setTextColor(95, 95, 95); doc.text(label.toUpperCase(), x, y); doc.setFont('courier', 'normal'); doc.setFontSize(8.5); doc.setTextColor(20, 20, 20); const lines = doc.splitTextToSize(pdfSafeText(value), width); doc.text(lines, x, y + 5); return y + 6 + (lines.length * 4); };
const collectOrderPdfItems = (order) => ([...asArray(order.services).map(i => ({ tipo: 'SERVIÇO', nome: i.name, qtd: i.quantity || 1, valor: Number(i.price || 0) })), ...asArray(order.parts).map(i => ({ tipo: 'PEÇA', nome: i.name, qtd: i.quantity || 1, valor: Number(i.price || 0) })), ...asArray(order.products).map(i => ({ tipo: 'PRODUTO', nome: i.name, qtd: i.quantity || 1, valor: Number(i.price || 0) }))]);
const APP_VERSION = "V15.2 PDF PREMIUM";
const DADOS_EMPRESA = {
    nome: "MY BANK",
    cpf: "",
    endereco: "",
    bairro: "",
    cidade: "",
    contato: ""
};
const STATUS_CONFIG = {
    ABERTA: { color: 'bg-yellow-500', text: 'text-yellow-500', bg: 'bg-yellow-500/20', border: 'border-yellow-500/30', label: 'ABERTA' },
    EM_CURSO: { color: 'bg-blue-500', text: 'text-blue-500', bg: 'bg-blue-500/20', border: 'border-blue-500/30', label: 'EM CURSO' },
    AGUARDANDO_PECA: { color: 'bg-orange-500', text: 'text-orange-500', bg: 'bg-orange-500/20', border: 'border-orange-500/30', label: 'AGUARDANDO PEÇA' },
    CONCLUIDA: { color: 'bg-green-500', text: 'text-green-500', bg: 'bg-green-500/20', border: 'border-green-500/30', label: 'CONCLUÍDA' },
    CANCELADA: { color: 'bg-red-500', text: 'text-red-500', bg: 'bg-red-500/20', border: 'border-red-500/30', label: 'CANCELADA' }
};
const OPERATIONAL_STAGES = [
    { key: 'ENTRADA', label: 'ENTRADA', cardClass: 'card-missoes', textClass: 'text-blue-400', icon: 'inbox' },
    { key: 'AGUARDANDO_APROVACAO', label: 'AGUARDANDO APROVAÇÃO', cardClass: 'card-custos', textClass: 'text-red-400', icon: 'alert-circle' },
    { key: 'AGUARDANDO_PECA', label: 'AGUARDANDO PEÇA', cardClass: 'card-faturamento', textClass: 'text-orange-400', icon: 'package' },
    { key: 'EM_SERVICO', label: 'EM SERVIÇO', cardClass: 'card-missoes', textClass: 'text-blue-400', icon: 'wrench' },
    { key: 'EM_TESTE', label: 'EM TESTE', cardClass: 'card-pendentes', textClass: 'text-yellow-400', icon: 'flask-conical' },
    { key: 'PRONTO', label: 'PRONTO', cardClass: 'card-pagas', textClass: 'text-green-400', icon: 'check-circle-2' },
    { key: 'ENTREGUE', label: 'ENTREGUE', cardClass: 'card-lucro', textClass: 'text-green-400', icon: 'truck' }
];
const OPERATIONAL_STAGE_LABELS = OPERATIONAL_STAGES.reduce((acc, stage) => {
    acc[stage.key] = stage.label;
    return acc;
}, {});
const normalizeOperationalStatus = (value) => {
    const raw = String(value || 'ENTRADA')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '_');
    const exact = OPERATIONAL_STAGES.find(stage => stage.key === raw);
    if (exact)
        return exact.key;
    const byLabel = OPERATIONAL_STAGES.find(stage => stage.label
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '_') === raw);
    return byLabel ? byLabel.key : 'ENTRADA';
};

// ========== TOAST NOTIFICATIONS ==========
const showToast = (message, type = 'info') => {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    const colors = {
        success: '#22c55e',
        error: '#ef4444',
        warning: '#eab308',
        info: '#d4af37'
    };
    toast.style.borderColor = colors[type] || colors.info;
    toast.innerHTML = `
                <div class="flex items-center gap-2">
                    <span class="text-sm font-usarmy text-white">${message}</span>
                </div>
            `;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translate(-50%, 20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};





// ========== MY BANK BANK V14 — COMPLETE ==========
const MyBankIntegrated = ({ orders, onBack, onOpenOrder }) => {
    const BANK_VERSION_LABEL = 'V14.1 PREMIUM LIMPO';
    const now = new Date();
    const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    // ── State ──────────────────────────────────────────────────────────
    const [tab, setTab] = useState(() => localStorage.getItem('mybank_quick_tab') || 'dashboard');
    const [transactions, setTransactions] = useState(() => normalizeBankTransactions(safeJsonParse(SafeStorage.getItem('mybank_transactions'), [])));
    const [fixedBills, setFixedBills] = useState(() => normalizeFixedBills(safeJsonParse(SafeStorage.getItem('mybank_fixed'), [])));
    const [budgets, setBudgets] = useState(() => normalizeBudgets(safeJsonParse(SafeStorage.getItem('mybank_budgets'), { personal: 2500, workshop: 0 })));
    const [withdrawalLimit, setWithdrawalLimit] = useState(() => {
        const saved = Number(safeJsonParse(SafeStorage.getItem('mybank_withdrawal_limit'), 800));
        return saved > 0 ? saved : 800;
    });
    const [selectedMonth, setSelectedMonth] = useState(currentYM);
    const [filterArea, setFilterArea] = useState('todos');
    const [filterType, setFilterType] = useState('todos');
    const [search, setSearch] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [editingBillId, setEditingBillId] = useState(null);
    const [showBillForm, setShowBillForm] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(null);
    const emptyForm = {
        area: 'pessoal', type: 'entrada', category: 'Serviço', categoryManual: false,
        description: '', value: '', date: new Date().toISOString().slice(0, 10),
        obs: '', isPersonalExpense: false
    };
    const [form, setForm] = useState(emptyForm);
    useEffect(() => {
        setForm(prev => {
            if (prev.categoryManual)
                return prev;
            const nextCategory = inferSmartCategory(prev);
            return nextCategory === prev.category ? prev : { ...prev, category: nextCategory };
        });
    }, [form.area, form.type, form.description, form.obs, form.isPersonalExpense, form.categoryManual]);
    const [billForm, setBillForm] = useState({ name: '', value: '', date: isoToday(), area: 'pessoal', active: true });
    const [cards, setCards] = useState(() => normalizeCards(safeJsonParse(SafeStorage.getItem('mybank_cards'), [])));
    const [cardEntries, setCardEntries] = useState(() => normalizeCardEntries(safeJsonParse(SafeStorage.getItem('mybank_card_entries'), [])));
    const [selectedCardId, setSelectedCardId] = useState(null);
    const defaultDebtPlanState = {
        currentMonthCritical: [
            { id: 'debt_current_internet', label: 'Internet', value: 110, due: '11', type: 'essencial' },
            { id: 'debt_current_iptv', label: 'Lista IPTV', value: 25, due: '14', type: 'fixa' },
            { id: 'debt_current_mei', label: 'MEI', value: 87, due: '20', type: 'fixa' },
            { id: 'debt_current_erika', label: 'Cartão Erika', value: 180, due: '15', type: 'prioridade' },
            { id: 'debt_current_carrefour', label: 'Cartão Carrefour', value: 673.80, due: '17', type: 'prioridade' },
            { id: 'debt_current_atacadao', label: 'Cartão Atacadão', value: 441.74, due: '23', type: 'prioridade' },
            { id: 'debt_current_mp', label: 'Mercado Pago', value: 115.75, due: 'sem dia informado', type: 'prioridade' }
        ],
        currentMonthNegotiation: [
            { id: 'debt_negociacao_armarinhos', label: 'DM Armarinhos', value: 279.88, status: 'vencido' },
            { id: 'debt_negociacao_dmvisa', label: 'DM Visa', value: 514.43, status: 'vencido' },
            { id: 'debt_negociacao_shopee', label: 'Shopee', value: 885.93, status: 'sem data informada' }
        ],
        nextMonthBase: [
            { id: 'debt_next_carrefour', label: 'Cartão Carrefour', value: 781 },
            { id: 'debt_next_atacadao', label: 'Cartão Atacadão', value: 380 },
            { id: 'debt_next_luz', label: 'Luz', value: 240 },
            { id: 'debt_next_agua', label: 'Água', value: 80 },
            { id: 'debt_next_mei', label: 'MEI', value: 87 },
            { id: 'debt_next_internet', label: 'Internet', value: 110 },
            { id: 'debt_next_iptv', label: 'Lista IPTV', value: 25 },
            { id: 'debt_next_erika', label: 'Cartão Erika', value: 180 },
            { id: 'debt_next_celular', label: 'Celular', value: 80 }
        ]
    };
    const normalizeDebtPlanState = (value) => {
        const base = value && typeof value === 'object' ? value : {};
        const normalizeList = (list, fallbackKey) => asArray(list).map((item, index) => ({
            ...item,
            id: String((item === null || item === void 0 ? void 0 : item.id) || `${fallbackKey}_${index}_${Date.now()}`),
            label: String((item === null || item === void 0 ? void 0 : item.label) || '').trim(),
            value: Number((item === null || item === void 0 ? void 0 : item.value) || 0)
        })).filter(item => item.label && item.value > 0);
        return {
            currentMonthCritical: normalizeList(base.currentMonthCritical || defaultDebtPlanState.currentMonthCritical, 'current'),
            currentMonthNegotiation: normalizeList(base.currentMonthNegotiation || defaultDebtPlanState.currentMonthNegotiation, 'negotiation'),
            nextMonthBase: normalizeList(base.nextMonthBase || defaultDebtPlanState.nextMonthBase, 'next')
        };
    };
    const [debtPlanData, setDebtPlanData] = useState(() => normalizeDebtPlanState(safeJsonParse(SafeStorage.getItem('mybank_debt_plan'), defaultDebtPlanState)));
    const [editingDebtItem, setEditingDebtItem] = useState(null);
    const [debtItemForm, setDebtItemForm] = useState({ section: 'currentMonthCritical', id: null, label: '', value: '', due: '', type: '', status: '' });
    useEffect(() => {
        const quickTab = localStorage.getItem('mybank_quick_tab');
        if (quickTab) {
            setTab(quickTab === 'storage' ? 'dashboard' : quickTab);
            localStorage.removeItem('mybank_quick_tab');
        }
    }, [debtPlanData]);
    useEffect(() => {
        setTransactions(prev => normalizeBankTransactions(prev));
        setCards(prev => normalizeCards(prev));
        setCardEntries(prev => normalizeCardEntries(prev));
    }, []);
    const [showCardForm, setShowCardForm] = useState(false);
    const [editingCardId, setEditingCardId] = useState(null);
    const [editingCardEntryId, setEditingCardEntryId] = useState(null);
    const [showCardEntryForm, setShowCardEntryForm] = useState(false);
    const [confirmDeleteCard, setConfirmDeleteCard] = useState(null);
    const [confirmDeleteCardEntry, setConfirmDeleteCardEntry] = useState(null);
    const [storageBusy, setStorageBusy] = useState(false);
    const handleStorageBackup = async () => {
        try {
            setStorageBusy(true);
            const payload = await buildFullAppBackup();
            downloadJsonFile(`mybank_backup_total_${new Date().toISOString().slice(0, 10)}.json`, payload);
            showToast('📦 Backup total do app gerado', 'success');
        }
        catch (error) {
            console.error(error);
            showToast('Erro ao gerar backup total', 'error');
        }
        finally {
            setStorageBusy(false);
        }
    };
    const handleStorageBackupDrive = async () => {
        try {
            setStorageBusy(true);
            const payload = await buildFullAppBackup();
            const shared = await shareJsonFile(`mybank_backup_total_${new Date().toISOString().slice(0, 10)}.json`, payload, 'Salvar backup total do app no Google Drive');
            showToast(shared ? '☁️ Compartilhe no Google Drive para salvar o backup' : '📦 Download do backup total gerado', shared ? 'success' : 'warning');
        }
        catch (error) {
            console.error(error);
            showToast('Não foi possível abrir o compartilhamento do Google Drive', 'error');
        }
        finally {
            setStorageBusy(false);
        }
    };
    const handleStorageRestore = async (event) => {
        var _a, _b;
        const file = (_b = (_a = event === null || event === void 0 ? void 0 : event.target) === null || _a === void 0 ? void 0 : _a.files) === null || _b === void 0 ? void 0 : _b[0];
        if (!file)
            return;
        try {
            setStorageBusy(true);
            const raw = await file.text();
            const parsed = JSON.parse(raw);
            const localSnapshot = (parsed === null || parsed === void 0 ? void 0 : parsed.localSnapshot) && typeof parsed.localSnapshot === 'object' ? parsed.localSnapshot : null;
            const rows = Array.isArray(parsed) ? parsed : (parsed === null || parsed === void 0 ? void 0 : parsed.indexedRows) || (parsed === null || parsed === void 0 ? void 0 : parsed.rows);
            if (!localSnapshot && !Array.isArray(rows)) {
                throw new Error('Backup inválido');
            }
            if (localSnapshot) {
                Object.entries(localSnapshot).forEach(([key, value]) => {
                    if (!key)
                        return;
                    if (value === null || value === undefined)
                        SafeStorage.removeItem(key);
                    else
                        SafeStorage.setItem(key, String(value));
                });
            }
            if (Array.isArray(rows)) {
                await SafeStorage.restoreRows(rows);
            }
            showToast('♻️ Backup total restaurado', 'success');
            setTimeout(() => window.location.reload(), 700);
        }
        catch (error) {
            console.error(error);
            showToast('Backup inválido para restauração', 'error');
        }
        finally {
            if (event === null || event === void 0 ? void 0 : event.target)
                event.target.value = '';
            setStorageBusy(false);
        }
    };
    const handleStorageCompact = async () => {
        try {
            setStorageBusy(true);
            const result = await SafeStorage.compactData();
            showToast(`🧹 Limpeza inteligente concluída${(result === null || result === void 0 ? void 0 : result.cleaned) ? ` • ${result.cleaned} itens ajustados` : ''}`, 'success');
        }
        catch (error) {
            showToast('Erro na limpeza inteligente', 'error');
        }
        finally {
            setStorageBusy(false);
        }
    };
    // ── Categories ────────────────────────────────────────────────────
    const CATS = {
        
        pessoal: {
            entrada: ['Salário', 'Freelance', 'Renda Extra', 'Reembolso', 'Presente', 'Dividendos', 'Outros'],
            saida: ['Alimentação', 'Moradia/Aluguel', 'Transporte', 'Saúde', 'Lazer', 'Educação', 'Cartão de Crédito', 'Marketplace', 'Streaming', 'Contas', 'Vestuário', 'Outros']
          }
    };
    const getCats = (area, type) => {
        var _a;
        const a = area === 'pessoal' ? 'pessoal' : 'pessoal';
        return ((_a = CATS[a]) === null || _a === void 0 ? void 0 : _a[type]) || CATS.pessoal.entrada;
    };
    const AREA_META = {
        pessoal: { label: 'PESSOAL', color: '#6366f1', bg: 'rgba(99,102,241,0.1)', border: 'rgba(99,102,241,0.3)', icon: 'user' },
    };
    const PERSONAL_EXPENSE_CATS = ['Retirada Pessoal', 'Uso Pessoal (Mat.)'];
    const getTransactionCats = (area, type, isPersonalExpense = false) => {
        if (area === 'pessoal' && type === 'saida' && isPersonalExpense)
            return CATS.pessoal.saida;
        return getCats(area, type);
    };
    // Categoria inteligente: classifica automaticamente pelo texto, área e tipo.
    const normalizeSmartText = (value = '') => String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    const smartCategoryRules = [
        { cat: 'Alimentação', terms: ['mercado', 'supermercado', 'padaria', 'acougue', 'hortifruti', 'restaurante', 'lanche', 'almoco', 'janta', 'pizza', 'ifood', 'delivery', 'cafe', 'bebida', 'comida'] },
        { cat: 'Moradia/Aluguel', terms: ['aluguel', 'condominio', 'casa', 'moradia', 'apartamento'] },
        { cat: 'Transporte', terms: ['uber', '99', 'taxi', 'onibus', 'metro', 'trem', 'gasolina', 'combustivel', 'posto', 'estacionamento', 'pedagio'] },
        { cat: 'Saúde', terms: ['farmacia', 'remedio', 'medico', 'dentista', 'consulta', 'exame', 'hospital', 'saude'] },
        { cat: 'Lazer', terms: ['cinema', 'passeio', 'jogo', 'game', 'lazer', 'bar', 'viagem'] },
        { cat: 'Educação', terms: ['curso', 'faculdade', 'escola', 'livro', 'treinamento', 'educacao'] },
        { cat: 'Cartão de Crédito', terms: ['cartao', 'credito', 'fatura', 'visa', 'mastercard', 'carrefour', 'atacadao', 'mercado pago', 'nubank'] },
        { cat: 'Marketplace', terms: ['shopee', 'mercado livre', 'amazon', 'aliexpress', 'magazine', 'magalu', 'compra online'] },
        { cat: 'Streaming', terms: ['netflix', 'prime', 'disney', 'spotify', 'youtube', 'iptv', 'streaming'] },
        { cat: 'Contas', terms: ['luz', 'energia', 'agua', 'sabesp', 'internet', 'wifi', 'telefone', 'celular', 'mei', 'boleto', 'conta fixa', 'enel'] },
        { cat: 'Vestuário', terms: ['roupa', 'tenis', 'camisa', 'calca', 'bermuda', 'vestuario'] },
    
        { cat: 'Salário', terms: ['salario', 'ordenado', 'pagamento mensal'] },
        { cat: 'Freelance', terms: ['freela', 'freelance', 'bico'] },
        { cat: 'Renda Extra', terms: ['renda extra', 'extra'] },
        { cat: 'Reembolso', terms: ['reembolso', 'devolucao', 'estorno'] },
        { cat: 'Presente', terms: ['presente', 'doacao'] },
        { cat: 'Dividendos', terms: ['dividendo', 'rendimento', 'investimento'] },
    ];
    const inferSmartCategory = (draft) => {
        const allowed = getTransactionCats(draft.area, draft.type, draft.isPersonalExpense);
        const text = normalizeSmartText([draft.description, draft.obs].filter(Boolean).join(' '));
        if (draft.area === 'pessoal' && draft.type === 'saida' && draft.isPersonalExpense) {
            const personalMatch = smartCategoryRules.find(rule => allowed.includes(rule.cat) && rule.terms.some(term => text.includes(normalizeSmartText(term))));
            return (personalMatch === null || personalMatch === void 0 ? void 0 : personalMatch.cat) || 'Outros';
        }
        const match = smartCategoryRules.find(rule => allowed.includes(rule.cat) && rule.terms.some(term => text.includes(normalizeSmartText(term))));
        return (match === null || match === void 0 ? void 0 : match.cat) || (allowed.includes(draft.category) ? draft.category : allowed[0]);
    };
    const CAT_ICONS = {
        'Salário': 'briefcase', 'Freelance': 'laptop', 'Renda Extra': 'trending-up', 'Reembolso': 'corner-up-left',
       'Ferramenta/Equip.': 'tool', 'Alimentação': 'coffee', 'Moradia/Aluguel': 'home', 'Transporte': 'car',
        'Saúde': 'heart', 'Lazer': 'smile', 'Educação': 'book-open', 'Cartão de Crédito': 'credit-card',
        'Marketplace': 'store', 'Contas': 'file-text', 'Retirada Pessoal': 'arrow-down-left', 'Manutenção': 'settings',
        'Streaming': 'play-circle', 'Vestuário': 'tag', 'Marketing': 'megaphone', 'Frete': 'truck', 'Estoque': 'layers',
       };
    const getFixedBillIconKey = (name = '') => {
        const n = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        if (/(agua|sabesp|saneamento)/.test(n))
            return 'droplet';
        if (/(luz|energia|eletric|enel)/.test(n))
            return 'zap';
        if (/(internet|fibra|wifi|banda larga)/.test(n))
            return 'wifi';
        if (/(celular|telefone|chip|tim|vivo|claro|oi)/.test(n))
            return 'smartphone';
        if (/(iptv|netflix|prime|disney|youtube|stream)/.test(n))
            return 'tv';
        if (/(mei|imposto|tributo|taxa|boleto)/.test(n))
            return 'receipt';
        if (/(cartao|credito|fatura)/.test(n))
            return 'credit-card';
        if (/(aluguel|moradia|condominio|casa)/.test(n))
            return 'home';
        return 'file-text';
    };
    const FixedBillIcon = ({ icon = 'file-text', color = '#d4af37', size = 16, strokeWidth = 2 }) => {
        const common = {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: color,
            strokeWidth,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true'
        };
        switch (icon) {
            case 'droplet':
                return React.createElement("svg", { ...common },
                    React.createElement("path", { d: "M12 2.7c-.6.7-6 6.2-6 10.3A6 6 0 0 0 18 13c0-4.1-5.4-9.6-6-10.3z" }));
            case 'zap':
                return React.createElement("svg", { ...common },
                    React.createElement("path", { d: "M13 2 4 14h7l-1 8 9-12h-7l1-8z" }));
            case 'wifi':
                return React.createElement("svg", { ...common },
                    React.createElement("path", { d: "M12 20h.01" }),
                    React.createElement("path", { d: "M2 8.82a15 15 0 0 1 20 0" }),
                    React.createElement("path", { d: "M5 12.86a10 10 0 0 1 14 0" }),
                    React.createElement("path", { d: "M8.5 16.43a5 5 0 0 1 7 0" }));
            case 'smartphone':
                return React.createElement("svg", { ...common },
                    React.createElement("rect", { x: "7", y: "2", width: "10", height: "20", rx: "2" }),
                    React.createElement("path", { d: "M12 18h.01" }));
            case 'tv':
                return React.createElement("svg", { ...common },
                    React.createElement("rect", { x: "3", y: "7", width: "18", height: "12", rx: "2" }),
                    React.createElement("path", { d: "m9 3 3 4 3-4" }));
            case 'receipt':
                return React.createElement("svg", { ...common },
                    React.createElement("path", { d: "M4 3h16v18l-3-2-3 2-3-2-3 2-3-2-3 2V3z" }),
                    React.createElement("path", { d: "M8 7h8" }),
                    React.createElement("path", { d: "M8 11h8" }),
                    React.createElement("path", { d: "M8 15h5" }));
            case 'credit-card':
                return React.createElement("svg", { ...common },
                    React.createElement("rect", { x: "2", y: "5", width: "20", height: "14", rx: "2" }),
                    React.createElement("path", { d: "M2 10h20" }));
            case 'home':
                return React.createElement("svg", { ...common },
                    React.createElement("path", { d: "M3 10.5 12 3l9 7.5" }),
                    React.createElement("path", { d: "M5 9.5V21h14V9.5" }));
            case 'wrench':
                return React.createElement("svg", { ...common },
                    React.createElement("path", { d: "M14.7 6.3a4 4 0 0 0 5 5l-8.4 8.4a2 2 0 1 1-2.8-2.8l8.4-8.4a4 4 0 0 0-5-5l2.2 2.2-2.8 2.8-2.2-2.2a4 4 0 0 0 5.6 5.6" }));
            default:
                return React.createElement("svg", { ...common },
                    React.createElement("path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }),
                    React.createElement("path", { d: "M14 2v6h6" }),
                    React.createElement("path", { d: "M8 13h8" }),
                    React.createElement("path", { d: "M8 17h5" }));
        }
    };
    const BankUiIcon = ({ name = 'file-text', color = '#d4af37', size = 16, strokeWidth = 2 }) => {
        const common = {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: color,
            strokeWidth,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true'
        };
        switch (name) {
            case 'bell-ring':
                return React.createElement("svg", { ...common },
                    React.createElement("path", { d: "M10.3 21a2 2 0 0 0 3.4 0" }),
                    React.createElement("path", { d: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" }),
                    React.createElement("path", { d: "M4 2C2.8 3.7 2 5.7 2 8" }),
                    React.createElement("path", { d: "M22 8c0-2.3-.8-4.3-2-6" }));
            case 'user':
                return React.createElement("svg", { ...common },
                    React.createElement("path", { d: "M20 21a8 8 0 0 0-16 0" }),
                    React.createElement("circle", { cx: "12", cy: "7", r: "4" }));
            case 'wrench':
                return React.createElement("svg", { ...common },
                    React.createElement("path", { d: "M14.7 6.3a4 4 0 0 0 5 5l-8.4 8.4a2 2 0 1 1-2.8-2.8l8.4-8.4a4 4 0 0 0-5-5l2.2 2.2-2.8 2.8-2.2-2.2a4 4 0 0 0 5.6 5.6" }));
            case 'check':
                return React.createElement("svg", { ...common },
                    React.createElement("path", { d: "M20 6 9 17l-5-5" }));
            case 'pencil':
                return React.createElement("svg", { ...common },
                    React.createElement("path", { d: "M12 20h9" }),
                    React.createElement("path", { d: "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" }));
            case 'trash-2':
                return React.createElement("svg", { ...common },
                    React.createElement("path", { d: "M3 6h18" }),
                    React.createElement("path", { d: "M8 6V4h8v2" }),
                    React.createElement("path", { d: "M19 6l-1 14H6L5 6" }),
                    React.createElement("path", { d: "M10 11v6" }),
                    React.createElement("path", { d: "M14 11v6" }));
            case 'chevron-left':
                return React.createElement("svg", { ...common },
                    React.createElement("path", { d: "m15 18-6-6 6-6" }));
            case 'chevron-right':
                return React.createElement("svg", { ...common },
                    React.createElement("path", { d: "m9 18 6-6-6-6" }));
            case 'arrow-left':
                return React.createElement("svg", { ...common },
                    React.createElement("path", { d: "M19 12H5" }),
                    React.createElement("path", { d: "m12 19-7-7 7-7" }));
            case 'plus':
                return React.createElement("svg", { ...common },
                    React.createElement("path", { d: "M12 5v14" }),
                    React.createElement("path", { d: "M5 12h14" }));
            case 'plus-circle':
                return React.createElement("svg", { ...common },
                    React.createElement("circle", { cx: "12", cy: "12", r: "9" }),
                    React.createElement("path", { d: "M12 8v8" }),
                    React.createElement("path", { d: "M8 12h8" }));
            case 'layout-dashboard':
                return React.createElement("svg", { ...common },
                    React.createElement("rect", { x: "3", y: "3", width: "7", height: "7", rx: "1" }),
                    React.createElement("rect", { x: "14", y: "3", width: "7", height: "5", rx: "1" }),
                    React.createElement("rect", { x: "14", y: "12", width: "7", height: "9", rx: "1" }),
                    React.createElement("rect", { x: "3", y: "14", width: "7", height: "7", rx: "1" }));
            case 'list':
                return React.createElement("svg", { ...common },
                    React.createElement("path", { d: "M8 6h13" }),
                    React.createElement("path", { d: "M8 12h13" }),
                    React.createElement("path", { d: "M8 18h13" }),
                    React.createElement("path", { d: "M3 6h.01" }),
                    React.createElement("path", { d: "M3 12h.01" }),
                    React.createElement("path", { d: "M3 18h.01" }));
            case 'calendar-clock':
                return React.createElement("svg", { ...common },
                    React.createElement("path", { d: "M8 2v4" }),
                    React.createElement("path", { d: "M16 2v4" }),
                    React.createElement("rect", { x: "3", y: "4", width: "18", height: "18", rx: "2" }),
                    React.createElement("path", { d: "M3 10h18" }),
                    React.createElement("circle", { cx: "16", cy: "16", r: "3" }),
                    React.createElement("path", { d: "M16 14.5v2l1.2.8" }));
            case 'bar-chart-2':
                return React.createElement("svg", { ...common },
                    React.createElement("path", { d: "M18 20V10" }),
                    React.createElement("path", { d: "M12 20V4" }),
                    React.createElement("path", { d: "M6 20v-6" }));
            case 'shield':
                return React.createElement("svg", { ...common },
                    React.createElement("path", { d: "M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z" }));
            case 'shield-alert':
                return React.createElement("svg", { ...common },
                    React.createElement("path", { d: "M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z" }),
                    React.createElement("path", { d: "M12 8v5" }),
                    React.createElement("path", { d: "M12 16h.01" }));
            case 'target':
                return React.createElement("svg", { ...common },
                    React.createElement("circle", { cx: "12", cy: "12", r: "9" }),
                    React.createElement("circle", { cx: "12", cy: "12", r: "5" }),
                    React.createElement("circle", { cx: "12", cy: "12", r: "1" }));
            case 'traffic-cone':
                return React.createElement("svg", { ...common },
                    React.createElement("path", { d: "M10 4h4l3 12H7l3-12z" }),
                    React.createElement("path", { d: "M8 10h8" }),
                    React.createElement("path", { d: "M6 20h12" }));
            case 'arrow-down-left':
                return React.createElement("svg", { ...common },
                    React.createElement("path", { d: "M17 7v10H7" }),
                    React.createElement("path", { d: "m17 17-6-6" }));
            case 'arrow-left-right':
                return React.createElement("svg", { ...common },
                    React.createElement("path", { d: "M8 3 4 7l4 4" }),
                    React.createElement("path", { d: "M4 7h16" }),
                    React.createElement("path", { d: "m16 21 4-4-4-4" }),
                    React.createElement("path", { d: "M20 17H4" }));
            case 'credit-card':
                return React.createElement("svg", { ...common },
                    React.createElement("rect", { x: "2", y: "5", width: "20", height: "14", rx: "2" }),
                    React.createElement("path", { d: "M2 10h20" }));
            case 'file-down':
                return React.createElement("svg", { ...common },
                    React.createElement("path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }),
                    React.createElement("path", { d: "M14 2v6h6" }),
                    React.createElement("path", { d: "M12 11v6" }),
                    React.createElement("path", { d: "m9 14 3 3 3-3" }));
            case 'file-text':
                return React.createElement(FixedBillIcon, { icon: "file-text", color: color, size: size, strokeWidth: strokeWidth });
            default:
                return React.createElement(FixedBillIcon, { icon: "file-text", color: color, size: size, strokeWidth: strokeWidth });
        }
    };
    // ── Persist ────────────────────────────────────────────────────────
    useEffect(() => { SafeStorage.setItem('mybank_transactions', JSON.stringify(normalizeBankTransactions(transactions))); }, [transactions]);
    useEffect(() => { SafeStorage.setItem('mybank_fixed', JSON.stringify(normalizeFixedBills(fixedBills))); }, [fixedBills]);
    useEffect(() => { SafeStorage.setItem('mybank_budgets', JSON.stringify(normalizeBudgets(budgets))); }, [budgets]);
    useEffect(() => { SafeStorage.setItem('mybank_withdrawal_limit', JSON.stringify(Number(withdrawalLimit) > 0 ? Number(withdrawalLimit) : 800)); }, [withdrawalLimit]);
    useEffect(() => { SafeStorage.setItem('mybank_cards', JSON.stringify(normalizeCards(cards))); }, [cards]);
    useEffect(() => { SafeStorage.setItem('mybank_card_entries', JSON.stringify(normalizeCardEntries(cardEntries))); }, [cardEntries]);
    useEffect(() => { SafeStorage.setItem('mybank_debt_plan', JSON.stringify(normalizeDebtPlanState(debtPlanData))); }, [debtPlanData]);
    // ── Icon refresh ───────────────────────────────────────────────────
    // No Bank não podemos reexecutar lucide.createIcons(), porque o Lucide
    // substitui nós do DOM fora do ciclo do React e isso derruba a tela
    // nas atualizações de contas fixas (salvar / marcar / desmarcar).
    // ── Helpers ────────────────────────────────────────────────────────
    const money = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const pct = (a, b) => b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0;
    const monthLabel = ym => {
        const match = String(ym || '').match(/^(\d{4})-(\d{2})$/);
        if (!match)
            return 'SEM DATA';
        const year = Number(match[1]);
        const month = Number(match[2]);
        const base = new Date(year, month - 1, 1, 12, 0, 0, 0);
        return Number.isNaN(base.getTime())
            ? 'SEM DATA'
            : base.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    };
    // ── Months for selector ─────────────────────────────────────────────
    const availableMonths = useMemo(() => {
        const set = new Set([currentYM]);
        transactions.forEach(t => { const ym = String(normalizeBankDate((t === null || t === void 0 ? void 0 : t.date) || '')).slice(0, 7); if (/^\d{4}-\d{2}$/.test(ym))
            set.add(ym); });
        fixedBills.forEach(b => { if (isIsoDate(b === null || b === void 0 ? void 0 : b.date))
            set.add(b.date.slice(0, 7)); });
        cardEntries.forEach(entry => {
            const ym = /^\d{4}-\d{2}$/.test(String((entry === null || entry === void 0 ? void 0 : entry.invoiceMonth) || ''))
                ? String(entry.invoiceMonth)
                : String(normalizeBankDate((entry === null || entry === void 0 ? void 0 : entry.date) || (entry === null || entry === void 0 ? void 0 : entry.purchaseDate) || '')).slice(0, 7);
            if (/^\d{4}-\d{2}$/.test(ym))
                set.add(ym);
        });
        // Calendário contínuo: meses anteriores, mês atual e próximos 12 meses disponíveis.
        const [curY, curM] = currentYM.split('-').map(Number);
        const futureBase = new Date(curY, curM - 1 + 12, 1, 12, 0, 0, 0);
        set.add(`${futureBase.getFullYear()}-${String(futureBase.getMonth() + 1).padStart(2, '0')}`);
        const allMonths = [...set].filter(Boolean).sort();
        const maxYM = allMonths[allMonths.length - 1] || currentYM;
        const [maxY, maxM] = maxYM.split('-').map(Number);
        const startYear = 2024;
        const startMonth = 1;
        for (let y = startYear; y <= maxY; y++) {
            const mStart = (y === startYear) ? startMonth : 1;
            const mEnd = (y === maxY) ? maxM : 12;
            for (let m = mStart; m <= mEnd; m++) {
                set.add(`${y}-${String(m).padStart(2, '0')}`);
            }
        }
        return [...set].sort((a, b) => b.localeCompare(a));
    }, [transactions, fixedBills, cardEntries, cards, currentYM]);
    // ── Summary (all time) ─────────────────────────────────────────────
    const totalSummary = useMemo(() => {
        const p = { i: 0, e: 0 };
        const w = { i: 0, e: 0 };
        // Saldo oficina: receitas APENAS de ordens pagas (syncSource=office) + todas as despesas
        const wPaid = { i: 0, e: 0 };
        let personalViaWorkshop = 0;
        transactions.forEach(t => {
            const v = Number(t.value || 0);
            if (t.area === 'pessoal') {
                t.type === 'entrada' ? p.i += v : p.e += v;
            }
            else {
                t.type === 'entrada' ? w.i += v : w.e += v;
                if ((t.isPersonalExpense || PERSONAL_EXPENSE_CATS.includes(t.category)) && t.type === 'saida')
                    personalViaWorkshop += v;
                // Saldo oficina pago: entrada só conta se vier de ordem PAGA (syncSource=office)
                if (t.type === 'entrada' && t.syncSource === 'office')
                    wPaid.i += v;
                if (t.type === 'saida')
                    wPaid.e += v;
            }
        });
        const wBalancePaid = wPaid.i - wPaid.e;
        return { pBalance: p.i - p.e, wBalance: w.i - w.e, wBalancePaid, pIncome: p.i, pExpense: p.e, wIncome: w.i, wExpense: w.e,
            wPaidIncome: wPaid.i, wPaidExpense: wPaid.e,
            personalViaWorkshop, total: (p.i - p.e) + (w.i - w.e) };
    }, [transactions]);
    // ── Monthly filtered summary ───────────────────────────────────────
    const monthlySummary = useMemo(() => {
        const filtered = transactions.filter(t => t.date && t.date.slice(0, 7) === selectedMonth);
        const p = { i: 0, e: 0 };
        const w = { i: 0, e: 0 };
        let personalViaWorkshop = 0;
        let workshopRealProfit = 0;
        const catExpP = {};
        const catExpW = {};
        filtered.forEach(t => {
            const v = Number(t.value || 0);
            if (t.area === 'pessoal') {
                t.type === 'entrada' ? p.i += v : p.e += v;
                if (t.type === 'saida')
                    catExpP[t.category] = (catExpP[t.category] || 0) + v;
            }
            else {
                t.type === 'entrada' ? w.i += v : w.e += v;
                if (t.type === 'entrada' && t.syncSource === 'office')
                    workshopRealProfit += Number(t.realProfit || v || 0);
                if (t.type === 'saida')
                    catExpW[t.category] = (catExpW[t.category] || 0) + v;
                if ((t.isPersonalExpense || PERSONAL_EXPENSE_CATS.includes(t.category)) && t.type === 'saida')
                    personalViaWorkshop += v;
            }
        });
        const pSaved = p.i - p.e;
        const wProfit = w.i - w.e;
        return { p, w, pSaved, wProfit, workshopRealProfit, workshopRealMargin: w.i > 0 ? (workshopRealProfit / w.i) * 100 : 0, personalViaWorkshop, catExpP, catExpW,
            totalIncome: p.i + w.i, totalExpense: p.e + w.e, count: filtered.length };
    }, [transactions, selectedMonth]);
    const periodStats = useMemo(() => {
        const todayKey = isoToday();
        const nowRef = new Date();
        const dayOfWeek = nowRef.getDay();
        const diffToMonday = (dayOfWeek + 6) % 7;
        const monday = new Date(nowRef.getFullYear(), nowRef.getMonth(), nowRef.getDate() - diffToMonday, 12, 0, 0, 0);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        const build = (items) => items.reduce((acc, item) => {
            const value = Number(item.value || 0);
            const areaKey = item.area === 'pessoal' ? 'pessoal' : 'pessoal';
            if (item.type === 'entrada')
                acc[areaKey].entrada += value;
            else
                acc[areaKey].saida += value;
            if (areaKey === 'pessoal' && item.type === 'saida' && (item.isPersonalExpense || PERSONAL_EXPENSE_CATS.includes(item.category))) {
                acc[areaKey].pessoalNaOficina += value;
            }
            return acc;
        }, {
            pessoal: { entrada: 0, saida: 0, pessoalNaOficina: 0 },
            oficina: { entrada: 0, saida: 0, pessoalNaOficina: 0 }
        });
        const enrich = (base) => ({
            pessoal: { ...base.pessoal, saldo: base.pessoal.entrada - base.pessoal.saida },
            oficina: { ...base.oficina, saldo: base.oficina.entrada - base.oficina.saida },
            geral: (base.pessoal.entrada + base.oficina.entrada) - (base.pessoal.saida + base.oficina.saida)
        });
        const todayItems = transactions.filter(t => t.date === todayKey);
        const weekItems = transactions.filter(t => {
            if (!isIsoDate(t === null || t === void 0 ? void 0 : t.date))
                return false;
            const dt = new Date(`${t.date}T12:00:00`);
            return dt >= monday && dt <= sunday;
        });
        const monthItems = transactions.filter(t => String(t.date || '').slice(0, 7) === selectedMonth);
        return {
            today: enrich(build(todayItems)),
            week: enrich(build(weekItems)),
            month: enrich(build(monthItems))
        };
    }, [transactions, selectedMonth]);
    const tacticalPressure = useMemo(() => {
        const currentMonthExpenses = monthlySummary.totalExpense;
        const currentMonthIncome = monthlySummary.totalIncome;
        const workshopNet = monthlySummary.wProfit;
        const workshopPersonalDrain = monthlySummary.personalViaWorkshop;
        const totalBudget = Number(budgets.personal || 0) + Number(budgets.workshop || 0);
        const usagePct = totalBudget > 0 ? (currentMonthExpenses / totalBudget) : 0;
        if (workshopNet < 0 || workshopPersonalDrain > Math.max(300, currentMonthIncome * 0.25)) {
            return { label: 'PRESSÃO MÁXIMA', color: '#ef4444', bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.30)', hint: 'Reduza retiradas e corte saídas imediatamente.' };
        }
        if (usagePct >= 1 || currentMonthExpenses > currentMonthIncome) {
            return { label: 'RISCO ALTO', color: '#f97316', bg: 'rgba(249,115,22,0.10)', border: 'rgba(249,115,22,0.30)', hint: 'Suas saídas do mês já passaram da zona segura.' };
        }
        if (usagePct >= 0.8) {
            return { label: 'ATENÇÃO TÁTICA', color: '#eab308', bg: 'rgba(234,179,8,0.10)', border: 'rgba(234,179,8,0.30)', hint: 'Segure compras e acompanhe vencimentos de perto.' };
        }
        return { label: 'CAIXA CONTROLADO', color: '#22c55e', bg: 'rgba(34,197,94,0.10)', border: 'rgba(34,197,94,0.30)', hint: 'Fluxo sob controle. Mantenha o ritmo.' };
    }, [monthlySummary, budgets]);
    const budgetRadar = useMemo(() => {
        const buildBudgetMeta = (label, budgetValue, spentValue, color, icon) => {
            const budget = Number(budgetValue || 0);
            const spent = Number(spentValue || 0);
            const usage = budget > 0 ? (spent / budget) : 0;
            const remaining = budget - spent;
            let status = 'SEM LIMITE';
            let tone = '#9ca3af';
            let hint = 'Defina um teto para o app te avisar quando sair da zona segura.';
            if (budget > 0 && usage < 0.7) {
                status = 'DENTRO DO PLANO';
                tone = '#22c55e';
                hint = 'Uso saudável. Ainda existe folga para o restante do mês.';
            }
            else if (budget > 0 && usage < 1) {
                status = 'ATENÇÃO';
                tone = '#eab308';
                hint = 'Você está consumindo a margem do mês. Segure novas saídas.';
            }
            else if (budget > 0) {
                status = 'ESTOUROU';
                tone = '#ef4444';
                hint = 'Você passou do teto mensal. Corte gastos até voltar ao limite.';
            }
            return { label, budget, spent, usage, remaining, status, tone, hint, color, icon };
        };
        const pessoal = buildBudgetMeta('PESSOAL', budgets.personal, monthlySummary.p.e, '#818cf8', 'user');
        const oficina = buildBudgetMeta('OFICINA', budgets.workshop, monthlySummary.w.e, '#d4af37', 'wrench');
        const totalBudget = pessoal.budget + oficina.budget;
        const totalSpent = pessoal.spent + oficina.spent;
        const totalRemaining = totalBudget - totalSpent;
        const totalUsage = totalBudget > 0 ? (totalSpent / totalBudget) : 0;
        let totalStatus = 'SEM LIMITE';
        let totalTone = '#9ca3af';
        if (totalBudget > 0 && totalUsage < 0.7) {
            totalStatus = 'CONTROLE FORTE';
            totalTone = '#22c55e';
        }
        else if (totalBudget > 0 && totalUsage < 1) {
            totalStatus = 'ZONA DE ALERTA';
            totalTone = '#eab308';
        }
        else if (totalBudget > 0) {
            totalStatus = 'LIMITE ROMPIDO';
            totalTone = '#ef4444';
        }
        return { pessoal, oficina, totalBudget, totalSpent, totalRemaining, totalUsage, totalStatus, totalTone };
    }, [budgets, monthlySummary]);
    // ── Fixed bills due alert ──────────────────────────────────────────
    const isBillPaidForMonth = (bill, ym = currentYM) => Array.isArray(bill === null || bill === void 0 ? void 0 : bill.paidMonths) && bill.paidMonths.includes(ym);
    const getFixedBillSyncId = (billId, ym = currentYM) => `fixed_bill_${billId}_${ym}`;
    const getBillStartMonth = (bill) => {
        if (isIsoDate(bill === null || bill === void 0 ? void 0 : bill.date))
            return bill.date.slice(0, 7);
        return currentYM;
    };
    const compareYM = (a, b) => String(a || '').localeCompare(String(b || ''));
    const getBillDueDateForMonth = (bill, ym = currentYM) => {
        if (!bill || !ym || compareYM(ym, getBillStartMonth(bill)) < 0)
            return null;
        const [year, month] = String(ym).split('-').map(Number);
        if (!year || !month)
            return null;
        const maxDay = new Date(year, month, 0).getDate();
        const dueDay = Math.min(Math.max(parseInt(bill.day, 10) || 1, 1), maxDay);
        return new Date(year, month - 1, dueDay, 12, 0, 0, 0);
    };
    const getBillMonthStatus = (bill, ym = currentYM) => {
        const dueDate = getBillDueDateForMonth(bill, ym);
        const paid = isBillPaidForMonth(bill, ym);
        if (!dueDate) {
            return {
                paid,
                dueDate: null,
                started: false,
                daysUntil: null,
                urgent: false,
                overdue: false,
                waiting: true,
                label: 'AGUARDANDO',
            };
        }
        const isCurrentMonthView = ym === currentYM;
        const todayRef = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
        const diffDays = Math.round((dueDate.getTime() - todayRef.getTime()) / 86400000);
        const waiting = !paid && (!isCurrentMonthView || diffDays > 5);
        const urgent = !paid && isCurrentMonthView && diffDays >= 0 && diffDays <= 5;
        const overdue = !paid && isCurrentMonthView && diffDays < 0;
        return {
            paid,
            dueDate,
            started: true,
            daysUntil: diffDays,
            urgent,
            overdue,
            waiting,
            label: paid ? 'PAGA' : overdue ? 'VENCIDA' : urgent ? (diffDays === 0 ? 'HOJE!' : `${diffDays}d`) : 'AGUARDANDO',
        };
    };
    const billsAlerts = useMemo(() => {
        return fixedBills
            .filter(b => b.active !== false)
            .map(b => {
            const status = getBillMonthStatus(b, currentYM);
            return { ...b, ...status };
        })
            .filter(b => b.started)
            .sort((a, b) => { var _a, _b; return a.paid === b.paid ? (((_a = a.daysUntil) !== null && _a !== void 0 ? _a : 999) - ((_b = b.daysUntil) !== null && _b !== void 0 ? _b : 999)) : Number(a.paid) - Number(b.paid); });
    }, [fixedBills, currentYM]);
    const urgentCount = billsAlerts.filter(b => !b.paid && (b.urgent || b.overdue)).length;
    const alertBellCount = billsAlerts.filter(b => !b.paid && (b.overdue || b.daysUntil === 0)).length;
    // ── Filtered transactions ─────────────────────────────────────────
    const filteredTransactions = useMemo(() => {
        const q = search.toLowerCase();
        return transactions
            .filter(t => t.date && t.date.slice(0, 7) === selectedMonth)
            .filter(t => filterArea === 'todos' || t.area === filterArea)
            .filter(t => filterType === 'todos' || t.type === filterType)
            .filter(t => `${t.description} ${t.category} ${t.obs || ''}`.toLowerCase().includes(q))
            .sort((a, b) => b.date.localeCompare(a.date));
    }, [transactions, selectedMonth, filterArea, filterType, search]);
    // ── Cash-flow daily ────────────────────────────────────────────────
    const monthlyWorkshopPersonalOut = useMemo(() => Number(monthlySummary.personalViaWorkshop || 0), [monthlySummary.personalViaWorkshop]);
    const workshopWithdrawalRadar = useMemo(() => {
        const spent = monthlyWorkshopPersonalOut;
        const limit = Number(withdrawalLimit || 0) > 0 ? Number(withdrawalLimit) : 800;
        const ratio = limit > 0 ? spent / limit : 0;
        let status = 'CONTROLADA';
        let tone = '#22c55e';
        let hint = 'Retirada pessoal dentro do limite seguro.';
        if (ratio >= 1) {
            status = 'ESTOUROU';
            tone = '#ef4444';
            hint = 'A retirada pessoal passou do limite mensal.';
        }
        else if (ratio >= 0.75) {
            status = 'ATENÇÃO';
            tone = '#f59e0b';
            hint = 'Você está perto do limite de retirada pessoal.';
        }
        return { spent, limit, ratio, status, tone, hint, remaining: limit - spent };
    }, [monthlyWorkshopPersonalOut, withdrawalLimit]);
    const financialTraffic = useMemo(() => {
        const monthBalance = monthlySummary.totalIncome - monthlySummary.totalExpense;
        let color = '#22c55e';
        let label = 'SAUDÁVEL';
        let hint = 'Seu mês está controlado e ainda há margem de segurança.';
        if (budgetRadar.totalRemaining < 0 || monthBalance < 0 || workshopWithdrawalRadar.ratio >= 1) {
            color = '#ef4444';
            label = 'RISCO';
            hint = 'Você já passou do limite ou está fechando o mês no negativo.';
        }
        else if (budgetRadar.totalSpent >= budgetRadar.totalBudget * 0.7 || workshopWithdrawalRadar.ratio >= 0.75) {
            color = '#f59e0b';
            label = 'ATENÇÃO';
            hint = 'O orçamento do mês está apertando. Segure as saídas.';
        }
        return { color, label, hint, monthBalance };
    }, [budgetRadar, workshopWithdrawalRadar, monthlySummary.totalIncome, monthlySummary.totalExpense]);
    const dashboardIntelligence = useMemo(() => {
        const daysInMonth = new Date(Number(selectedMonth.slice(0, 4)), Number(selectedMonth.slice(5, 7)), 0).getDate();
        const selectedIsCurrent = selectedMonth === currentYM;
        const currentDay = selectedIsCurrent ? now.getDate() : daysInMonth;
        const remainingDays = Math.max(1, daysInMonth - currentDay + (selectedIsCurrent ? 0 : 1));
        const safeBudgetLeft = Math.max(0, budgetRadar.totalRemaining);
        const safeSpendToday = safeBudgetLeft / remainingDays;
        const workshopGap = Math.max(0, monthlySummary.w.e - monthlySummary.w.i);
        const personalGap = Math.max(0, monthlySummary.p.e - monthlySummary.p.i);
        const workshopTarget = Math.max(0, workshopGap + Math.max(0, workshopWithdrawalRadar.spent - workshopWithdrawalRadar.limit));
        return { remainingDays, safeSpendToday, workshopTarget, personalGap };
    }, [budgetRadar.totalRemaining, monthlySummary.w.e, monthlySummary.w.i, monthlySummary.p.e, monthlySummary.p.i, workshopWithdrawalRadar, selectedMonth, currentYM, now]);
    const normalizeDebtLabel = (value) => String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    const nextMonthYM = useMemo(() => {
        const [y, m] = currentYM.split('-').map(Number);
        const d = new Date(y, m, 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }, [currentYM]);
    const debtCategoryAliases = useMemo(() => ({
        internet: ['internet', 'wifi', 'fibra', 'banda larga'],
        'lista iptv': ['lista iptv', 'iptv'],
        mei: ['mei', 'das mei', 'guia mei'],
        'cartao erika': ['cartao erika', 'cartão erika', 'erika'],
        'cartao carrefour': ['cartao carrefour', 'cartão carrefour', 'carrefour'],
        'cartao atacadao': ['cartao atacadao', 'cartão atacadão', 'cartao atacadão', 'cartão atacadao', 'atacadao', 'atacadão'],
        'mercado pago': ['mercado pago', 'mp'],
        'dm armarinhos': ['dm armarinhos', 'armarinhos', 'dm loja', 'dm armarinho'],
        'dm visa': ['dm visa', 'visa dm', 'dmvisa'],
        shopee: ['shopee'],
        luz: ['luz', 'energia', 'enel', 'eletricidade'],
        agua: ['agua', 'água', 'sabesp'],
        celular: ['celular', 'telefone', 'conta celular', 'recarga']
    }), []);
    const getDebtAliases = useCallback((label) => {
        const normalized = normalizeDebtLabel(label);
        if (!normalized)
            return [];
        const mapped = debtCategoryAliases[normalized] || [];
        return [...new Set([normalized, ...mapped.map(alias => normalizeDebtLabel(alias)).filter(Boolean)])];
    }, [debtCategoryAliases]);
    const entryMatchesDebtItem = useCallback((entry, item) => {
        const aliases = getDebtAliases(item === null || item === void 0 ? void 0 : item.label);
        if (!aliases.length)
            return false;
        const textBlob = normalizeDebtLabel([
            entry === null || entry === void 0 ? void 0 : entry.description,
            entry === null || entry === void 0 ? void 0 : entry.category,
            entry === null || entry === void 0 ? void 0 : entry.obs,
            entry === null || entry === void 0 ? void 0 : entry.cardName,
            entry === null || entry === void 0 ? void 0 : entry.cardBrand
        ].filter(Boolean).join(' '));
        if (!textBlob)
            return false;
        return aliases.some(alias => textBlob.includes(alias));
    }, [getDebtAliases]);
    const isDebtItemPaid = useCallback((item, section) => {
        const aliases = getDebtAliases(item === null || item === void 0 ? void 0 : item.label);
        if (!aliases.length)
            return false;
        const targetMonth = section === 'nextMonthBase' ? nextMonthYM : currentYM;
        const targetValue = Number((item === null || item === void 0 ? void 0 : item.value) || 0);
        const minValue = Math.max(1, targetValue - 0.5);
        const matchedTransaction = transactions.some(t => {
            if (String(t === null || t === void 0 ? void 0 : t.type) !== 'saida')
                return false;
            if (String((t === null || t === void 0 ? void 0 : t.date) || '').slice(0, 7) !== targetMonth)
                return false;
            if (!entryMatchesDebtItem(t, item))
                return false;
            const txValue = Number((t === null || t === void 0 ? void 0 : t.value) || 0);
            return txValue >= minValue;
        });
        if (matchedTransaction)
            return true;
        return cardEntries.some(entry => {
            const card = cards.find(c => c.id === (entry === null || entry === void 0 ? void 0 : entry.cardId));
            const invoiceMonth = getCardInvoiceMonth(entry, card);
            if (invoiceMonth !== targetMonth)
                return false;
            const enrichedEntry = {
                ...entry,
                cardName: (card === null || card === void 0 ? void 0 : card.name) || '',
                cardBrand: (card === null || card === void 0 ? void 0 : card.brand) || ''
            };
            if (!entryMatchesDebtItem(enrichedEntry, item))
                return false;
            const entryValue = Number((entry === null || entry === void 0 ? void 0 : entry.value) || 0);
            return entryValue >= minValue;
        });
    }, [transactions, cardEntries, cards, currentYM, nextMonthYM, getDebtAliases, entryMatchesDebtItem]);
    const openDebtItemEditor = (section, item) => {
        setEditingDebtItem({ section, id: item.id });
        setDebtItemForm({
            section,
            id: item.id,
            label: item.label || '',
            value: String(item.value || ''),
            due: item.due || '',
            type: item.type || '',
            status: item.status || ''
        });
    };
    const saveDebtItemEdit = () => {
        const section = debtItemForm.section;
        const value = parseFloat(debtItemForm.value);
        if (!section || !debtItemForm.label.trim() || !value || value <= 0) {
            showToast('Preencha nome e valor válido da dívida', 'warning');
            return;
        }
        setDebtPlanData(prev => {
            const next = normalizeDebtPlanState(prev);
            next[section] = asArray(next[section]).map(item => item.id === debtItemForm.id
                ? {
                    ...item,
                    label: debtItemForm.label.trim(),
                    value,
                    ...(section === 'currentMonthCritical' ? { due: debtItemForm.due || item.due || 'sem dia informado', type: debtItemForm.type || item.type || 'prioridade' } : {}),
                    ...(section === 'currentMonthNegotiation' ? { status: debtItemForm.status || item.status || 'em aberto' } : {})
                }
                : item);
            return next;
        });
        setEditingDebtItem(null);
        showToast('✅ Item do plano atualizado', 'success');
    };
    const renderDebtItemRow = (item, section, metaLabel) => {
        const paid = isDebtItemPaid(item, section);
        const secondary = section === 'currentMonthCritical'
            ? `Vence ${item.due || 'sem dia'}`
            : section === 'currentMonthNegotiation'
                ? (item.status || 'em aberto')
                : (metaLabel || `Previsto para ${monthLabel(nextMonthYM)}`);
        return (React.createElement("div", { key: item.id || item.label, className: "flex items-center justify-between text-[10px] gap-3 rounded-lg px-2 py-1.5 bg-black/20 border border-white/5" },
            React.createElement("div", { className: "min-w-0 flex-1" },
                React.createElement("div", { className: "flex items-center gap-2" },
                    React.createElement("span", { className: `block ${paid ? 'text-green-400' : 'text-gray-300'}` }, item.label),
                    paid && React.createElement("span", { className: "text-[8px] font-bold px-1.5 py-0.5 rounded-full border text-emerald-400 bg-emerald-500/10 border-emerald-500/30" }, "PAGO")),
                React.createElement("span", { className: "text-[8px] text-gray-500" }, secondary)),
            React.createElement("div", { className: "flex items-center gap-1 shrink-0" },
                React.createElement("span", { className: "font-mono text-white" }, money(item.value)),
                React.createElement("button", { onClick: () => openDebtItemEditor(section, item), className: "btn-icon text-[#d4af37] w-7 h-7", "aria-label": "Editar item do plano" },
                    React.createElement(BankUiIcon, { name: "pencil", size: 14, color: "#d4af37" })))));
    };
    


    const monthlyExtractGroups = useMemo(() => {
        const rows = transactions
            .map((t, index) => normalizeBankTransaction(t, index))
            .filter(Boolean)
            .filter(t => (!filterArea || filterArea === 'todos' || t.area === filterArea))
            .filter(t => (!filterType || filterType === 'todos' || t.type === filterType))
            .filter(t => {
            const q = String(search || '').trim().toLowerCase();
            if (!q)
                return true;
            return [t.description, t.category, t.area, t.type, t.obs].some(v => String(v || '').toLowerCase().includes(q));
        })
            .sort((a, b) => String(normalizeBankDate(b.date) || '').localeCompare(String(normalizeBankDate(a.date) || '')));
        const grouped = {};
        rows.forEach(item => {
            const ym = String(normalizeBankDate(item.date)).slice(0, 7);
            if (!/^\d{4}-\d{2}$/.test(ym))
                return;
            if (!grouped[ym])
                grouped[ym] = [];
            grouped[ym].push(item);
        });
        return Object.entries(grouped).sort((a, b) => b[0].localeCompare(a[0]));
    }, [transactions, filterArea, filterType, search]);
    const cashFlowDays = useMemo(() => {
        const [y, m] = selectedMonth.split('-').map(Number);
        const daysInMonth = new Date(y, m, 0).getDate();
        const map = {};
        transactions
            .filter(t => t.date && t.date.slice(0, 7) === selectedMonth)
            .forEach(t => {
            const d = parseInt(t.date.slice(8, 10));
            if (!map[d])
                map[d] = { in: 0, out: 0 };
            t.type === 'entrada' ? map[d].in += Number(t.value || 0) : map[d].out += Number(t.value || 0);
        });
        return Array.from({ length: daysInMonth }, (_, i) => ({
            day: i + 1, in: (map[i + 1] || { in: 0 }).in, out: (map[i + 1] || { out: 0 }).out
        }));
    }, [transactions, selectedMonth]);
    const maxCashFlow = useMemo(() => Math.max(...cashFlowDays.map(d => Math.max(d.in, d.out)), 1), [cashFlowDays]);
    // ── Save transaction ───────────────────────────────────────────────
    const saveTransaction = () => {
        const value = parseFloat(form.value);
        const isPE = form.area === 'pessoal' && (form.isPersonalExpense || PERSONAL_EXPENSE_CATS.includes(form.category)) && form.type === 'saida';
        if (!form.description.trim() || !value || value <= 0) {
            showToast('Preencha descrição e valor válido', 'warning');
            return;
        }
        const smartDraft = { ...form, isPersonalExpense: isPE };
        const payloadCategory = form.categoryManual ? form.category : inferSmartCategory(smartDraft);
        const payloadDescription = form.description.trim();
        const payload = {
            id: editingId || Date.now().toString(),
            area: 'pessoal', type: form.type, category: payloadCategory,
            description: payloadDescription, value, date: normalizeBankDate(form.date),
            obs: form.obs || '', isPersonalExpense: isPE
        };
        setTransactions(prev => editingId
            ? prev.map(t => t.id === editingId ? { ...t, ...payload } : t)
            : [payload, ...prev]);
        setEditingId(null);
        setForm({ ...emptyForm, date: form.date });
        showToast(editingId ? '✅ Lançamento atualizado' : '✅ Lançamento salvo', 'success');
    };
    const editTransaction = (t) => {
        if (t.syncSource === 'office') {
            showToast('Lançamento auto-importado, edite na OS.', 'info');
            return;
        }
        if (t.syncSource === 'fixed_bill') {
            showToast('Lançamento da conta fixa é controlado pela aba de contas fixas.', 'info');
            return;
        }
        setEditingId(t.id);
        setForm({ area: t.area, type: t.type, category: t.category,
            description: t.description, value: String(t.value),
            date: t.date, obs: t.obs || '', isPersonalExpense: !!t.isPersonalExpense, categoryManual: true });
        setTab('lancamentos');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    const removeTransaction = (id) => {
        const item = transactions.find(t => t.id === id);
        if ((item === null || item === void 0 ? void 0 : item.syncSource) === 'office') {
            showToast('OS sincronizadas removem-se pela OS.', 'warning');
            return;
        }
        if ((item === null || item === void 0 ? void 0 : item.syncSource) === 'fixed_bill') {
            const syncMatch = String(item.syncId || '').match(/^fixed_bill_(.+)_([0-9]{4}-[0-9]{2})$/);
            const billId = syncMatch ? syncMatch[1] : null;
            const billMonth = syncMatch ? syncMatch[2] : null;
            if (!billId || !billMonth) {
                showToast('Conta fixa vinculada inválida.', 'warning');
                return;
            }
            setTransactions(prev => prev.filter(t => t.id !== id));
            setFixedBills(prev => prev.map(b => String(b.id) === String(billId)
                ? { ...b, paidMonths: (b.paidMonths || []).filter(m => m !== billMonth) }
                : b));
            setConfirmDelete(null);
            showToast('🗑️ Lançamento removido e conta fixa desmarcada', 'success');
            return;
        }
        setTransactions(prev => prev.filter(t => t.id !== id));
        setConfirmDelete(null);
        showToast('🗑️ Lançamento removido', 'success');
    };
    // ── Fixed bills ────────────────────────────────────────────────────
    const saveBill = () => {
        const value = parseFloat(billForm.value);
        const billDate = billForm.date;
        const day = parseInt((billDate || '').slice(8, 10), 10);
        if (!billForm.name.trim() || !value || !billDate || !day || day < 1 || day > 31) {
            showToast('Preencha nome, valor e data válida', 'warning');
            return;
        }
        const existingBill = fixedBills.find(b => b.id === editingBillId);
        const payload = normalizeFixedBill({
            ...existingBill,
            id: editingBillId || Date.now().toString(),
            name: billForm.name.trim(),
            value,
            date: billDate,
            day,
            area: billForm.area || 'pessoal',
            active: existingBill ? existingBill.active !== false : true,
            paidMonths: (existingBill === null || existingBill === void 0 ? void 0 : existingBill.paidMonths) || []
        });
        if (!payload) {
            showToast('Não foi possível salvar a conta fixa', 'error');
            return;
        }
        setFixedBills(prev => editingBillId
            ? prev.map(b => b.id === editingBillId ? payload : b)
            : [payload, ...normalizeFixedBills(prev)]);
        setEditingBillId(null);
        setBillForm({ name: '', value: '', date: isoToday(), area: 'pessoal', active: true });
        setShowBillForm(false);
        showToast(editingBillId ? '✅ Conta atualizada' : '✅ Conta adicionada', 'success');
    };
    const editBill = (b) => {
        setEditingBillId(b.id);
        setBillForm({
            name: b.name,
            value: String(b.value),
            date: isIsoDate(b.date) ? b.date : `${currentYM}-${String(Math.min(Math.max(parseInt(b.day, 10) || 1, 1), 31)).padStart(2, '0')}`,
            area: b.area || 'pessoal',
            active: b.active !== false
        });
        setShowBillForm(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    const toggleBillPaid = (bill) => {
        const ym = selectedMonth;
        if (compareYM(ym, getBillStartMonth(bill)) < 0) {
            showToast('Essa conta ainda não iniciou no mês selecionado.', 'info');
            return;
        }
        const syncId = getFixedBillSyncId(bill.id, ym);
        const alreadyPaid = isBillPaidForMonth(bill, ym);
        if (alreadyPaid) {
            setFixedBills(prev => prev.map(item => item.id === bill.id
                ? { ...item, paidMonths: asArray(item.paidMonths).filter(m => m !== ym) }
                : item));
            setTransactions(prev => prev.filter(t => !(t.syncSource === 'fixed_bill' && String(t.syncId) === syncId)));
            showToast('↩️ Conta desmarcada como paga', 'info');
            return;
        }
        const paymentDate = new Date().toISOString().slice(0, 10);
        const autoTransaction = {
            id: 'fixed_tx_' + syncId,
            syncId,
            syncSource: 'fixed_bill',
            area: bill.area || 'pessoal',
            type: 'saida',
            category: bill.area === 'pessoal' ? 'Contas' : 'Outros',
            description: `Conta fixa: ${bill.name}`,
            value: Number(bill.value || 0),
            date: paymentDate,
            obs: 'Lançamento automático da conta fixa',
            isPersonalExpense: false
        };
        setFixedBills(prev => prev.map(item => item.id === bill.id
            ? { ...item, paidMonths: [...new Set([...asArray(item.paidMonths), ym])] }
            : item));
        setTransactions(prev => {
            const cleaned = prev.filter(t => !(t.syncSource === 'fixed_bill' && String(t.syncId) === syncId));
            return [autoTransaction, ...cleaned];
        });
        showToast('✅ Conta marcada como paga e lançada no extrato', 'success');
    };
    // ── Area form handler ──────────────────────────────────────────────
    const removeFixedBill = (billId) => {
        setTransactions(prev => prev.filter(t => !(t.syncSource === 'fixed_bill' && String(t.syncId || '').startsWith(`fixed_bill_${billId}_`))));
        setFixedBills(prev => prev.filter(x => x.id !== billId));
        showToast('🗑️ Conta removida', 'success');
    };
    const handleAreaChange = (area) => {
        setForm(prev => {
            const draft = { ...prev, area, isPersonalExpense: false, categoryManual: false };
            return { ...draft, category: inferSmartCategory(draft) };
        });
    };
    const handleTypeChange = (type) => {
        setForm(prev => {
            const nextIsPE = prev.area === 'pessoal' && type === 'saida' && prev.isPersonalExpense;
            const draft = { ...prev, type, isPersonalExpense: nextIsPE, categoryManual: false };
            return { ...draft, category: inferSmartCategory(draft) };
        });
    };
    // ── Cartões ───────────────────────────────────────────────────────
    const emptyCardForm = {
        name: '',
        brand: '',
        final: '',
        limit: '',
        dueDay: '',
        closingDay: '',
        bestPurchaseDay: ''
    };
    const emptyCardEntryForm = {
        area: 'pessoal',
        category: getCats('pessoal', 'saida')[0],
        description: '',
        totalValue: '',
        date: isoToday(),
        obs: '',
        isInstallment: false,
        installmentCount: '2',
        installmentGroupId: '',
        isRecurring: false,
        recurrenceMonths: '72',
        recurringGroupId: ''
    };
    const selectedCard = useMemo(() => cards.find(c => c.id === selectedCardId) || null, [cards, selectedCardId]);
    const [cardForm, setCardForm] = useState(emptyCardForm);
    const [cardEntryForm, setCardEntryForm] = useState(emptyCardEntryForm);
    const handleCardAreaChange = (area) => {
        const safeArea = area === 'pessoal' ? 'pessoal' : 'pessoal';
        setCardEntryForm(prev => ({
            ...prev,
            area: safeArea,
            category: getCats(safeArea, 'saida')[0]
        }));
    };
    const parseCardDay = (value) => {
        const raw = parseInt(value, 10);
        return Number.isInteger(raw) && raw >= 1 && raw <= 31 ? raw : null;
    };
    const addMonthsToYM = (ym, amount = 0) => {
        const [year, month] = String(ym || currentYM).split('-').map(Number);
        if (!year || !month)
            return currentYM;
        const base = new Date(year, month - 1 + amount, 1, 12, 0, 0, 0);
        return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`;
    };
    const shiftIsoDateMonths = (isoDate, amount = 0) => {
        const normalized = normalizeBankDate(isoDate, isoToday());
        const [year, month, day] = String(normalized).split('-').map(Number);
        if (!year || !month || !day)
            return isoToday();
        const base = new Date(year, month - 1 + amount, 1, 12, 0, 0, 0);
        const maxDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
        return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(Math.min(day, maxDay)).padStart(2, '0')}`;
    };
    const splitAmountAcrossInstallments = (totalValue, count = 1) => {
        const safeTotal = Math.max(Number(totalValue || 0), 0);
        const safeCount = Math.max(parseInt(count || 1, 10) || 1, 1);
        const totalCents = Math.round((safeTotal + Number.EPSILON) * 100);
        const baseCents = Math.floor(totalCents / safeCount);
        const remainder = totalCents - (baseCents * safeCount);
        return Array.from({ length: safeCount }, (_, index) => Number(((baseCents + (index === safeCount - 1 ? remainder : 0)) / 100).toFixed(2)));
    };
    const getCardDueDay = (card) => parseCardDay(card === null || card === void 0 ? void 0 : card.dueDay);
    const getCardClosingDay = (card) => parseCardDay(card === null || card === void 0 ? void 0 : card.closingDay) || getCardDueDay(card);
    const getCardBestPurchaseDay = (card) => {
        const bestDay = parseCardDay(card === null || card === void 0 ? void 0 : card.bestPurchaseDay);
        if (bestDay)
            return bestDay;
        const closingDay = getCardClosingDay(card);
        return closingDay ? (closingDay === 31 ? 1 : closingDay + 1) : null;
    };
    const getCardInvoiceMonth = (entry, card) => {
        // Para parcelamento, cada registro já representa UMA parcela e tem sua própria data.
        // Por isso a fatura deve ser calculada pela data da parcela (entry.date), não pela data original da compra.
        // Ex.: compra 08/04 em 3x, cartão fecha 31 e vence 11:
        // parcela 1 -> fatura 05/2026, parcela 2 -> fatura 06/2026, parcela 3 -> fatura 07/2026.
        const entryDate = normalizeBankDate((entry === null || entry === void 0 ? void 0 : entry.date) || (entry === null || entry === void 0 ? void 0 : entry.purchaseDate), isoToday());
        const baseYM = String(entryDate).slice(0, 7);
        const closingDay = getCardClosingDay(card);
        const dueDay = getCardDueDay(card);
        const entryDay = parseInt(String(entryDate).slice(8, 10), 10);
        // A fatura exibida no Bank representa o mês de VENCIMENTO.
        // Primeiro encontra o mês de fechamento da parcela, depois joga para o mês de vencimento.
        // Ex.: fecha dia 31 e vence dia 11: compra/parcela em 08/04 fecha em 30/04 e vence em 11/05.
        if (!closingDay || !dueDay || !Number.isInteger(entryDay)) {
            return /^\d{4}-\d{2}$/.test(String((entry === null || entry === void 0 ? void 0 : entry.invoiceMonth) || '')) ? String(entry.invoiceMonth) : baseYM;
        }
        const closingYM = entryDay > closingDay ? addMonthsToYM(baseYM, 1) : baseYM;
        return dueDay <= closingDay ? addMonthsToYM(closingYM, 1) : closingYM;
    };
    const getCardInvoiceDueDate = (card, ym = currentYM) => {
        const dueDay = getCardDueDay(card);
        if (!dueDay || !ym)
            return null;
        const [year, month] = String(ym).split('-').map(Number);
        if (!year || !month)
            return null;
        const maxDay = new Date(year, month, 0).getDate();
        return new Date(year, month - 1, Math.min(dueDay, maxDay), 12, 0, 0, 0);
    };
    const buildCardEntriesFromForm = (form, card) => {
        const totalValue = Math.round((Number(form.totalValue || 0) + Number.EPSILON) * 100) / 100;
        const purchaseDate = normalizeBankDate(form.date, isoToday());
        const timestamp = Date.now();
        const isRecurring = form.isRecurring === true;
        if (isRecurring) {
            const recurrenceMonths = Math.min(Math.max(parseInt(form.recurrenceMonths || 72, 10) || 72, 1), 120);
            const recurringGroupId = form.recurringGroupId || `card_recurring_${timestamp}`;
            return Array.from({ length: recurrenceMonths }, (_, index) => {
                const recurringDate = shiftIsoDateMonths(purchaseDate, index);
                return {
                    id: `card_entry_${timestamp}_rec_${index}_${Math.random().toString(36).slice(2, 8)}`,
                    cardId: selectedCardId,
                    area: 'pessoal',
                    category: form.category,
                    description: form.description.trim(),
                    value: totalValue,
                    totalPurchaseValue: totalValue,
                    date: recurringDate,
                    purchaseDate,
                    invoiceMonth: getCardInvoiceMonth({ date: recurringDate }, card),
                    obs: form.obs || '',
                    isInstallment: false,
                    installmentCount: 1,
                    installmentIndex: 1,
                    installmentValue: totalValue,
                    installmentGroupId: '',
                    isRecurring: true,
                    recurringGroupId,
                    recurringIndex: index + 1,
                    recurringActive: true,
                    recurrenceMonths
                };
            });
        }
        const installmentCount = form.isInstallment ? Math.max(parseInt(form.installmentCount || 1, 10) || 1, 2) : 1;
        const values = splitAmountAcrossInstallments(totalValue, installmentCount);
        const groupId = installmentCount > 1 ? (form.installmentGroupId || `card_installment_${timestamp}`) : '';
        return values.map((installmentValue, index) => {
            const installmentDate = shiftIsoDateMonths(purchaseDate, index);
            return {
                id: `card_entry_${timestamp}_${index}_${Math.random().toString(36).slice(2, 8)}`,
                cardId: selectedCardId,
                area: 'pessoal',
                category: form.category,
                description: form.description.trim(),
                value: installmentValue,
                totalPurchaseValue: totalValue,
                date: installmentDate,
                purchaseDate,
                invoiceMonth: getCardInvoiceMonth({ date: installmentDate }, card),
                obs: form.obs || '',
                isInstallment: installmentCount > 1,
                installmentCount,
                installmentIndex: index + 1,
                installmentValue,
                installmentGroupId: groupId,
                isRecurring: false,
                recurringGroupId: '',
                recurringIndex: 1,
                recurringActive: true,
                recurrenceMonths: 1
            };
        });
    };
    const saveCard = () => {
        const name = String(cardForm.name || '').trim();
        const brand = String(cardForm.brand || '').trim();
        const final = String(cardForm.final || '').replace(/\D/g, '').slice(-4);
        const limit = cardForm.limit === '' ? '' : Number(cardForm.limit || 0);
        const dueDay = cardForm.dueDay === '' ? '' : Math.min(Math.max(parseInt(cardForm.dueDay || 0, 10), 1), 31);
        const closingDay = cardForm.closingDay === '' ? '' : Math.min(Math.max(parseInt(cardForm.closingDay || 0, 10), 1), 31);
        const bestPurchaseDay = cardForm.bestPurchaseDay === '' ? '' : Math.min(Math.max(parseInt(cardForm.bestPurchaseDay || 0, 10), 1), 31);
        const existingCard = cards.find(card => card.id === editingCardId);
        if (!name) {
            showToast('Informe o nome do cartão', 'warning');
            return;
        }
        const payload = {
            id: editingCardId || `card_${Date.now()}`,
            name,
            brand,
            final,
            limit: limit !== '' && limit > 0 ? limit : '',
            dueDay: dueDay || '',
            closingDay: closingDay || '',
            bestPurchaseDay: bestPurchaseDay || '',
            createdAt: (existingCard === null || existingCard === void 0 ? void 0 : existingCard.createdAt) || new Date().toISOString()
        };
        setCards(prev => editingCardId
            ? prev.map(card => card.id === editingCardId ? { ...card, ...payload } : card)
            : [payload, ...prev]);
        if (!editingCardId)
            setSelectedCardId(payload.id);
        setEditingCardId(null);
        setCardForm(emptyCardForm);
        setShowCardForm(false);
        showToast(editingCardId ? '✅ Cartão atualizado' : '✅ Cartão adicionado', 'success');
    };
    const editCard = (card) => {
        setEditingCardId(card.id);
        setCardForm({
            name: card.name || '',
            brand: card.brand || '',
            final: card.final || '',
            limit: card.limit === '' ? '' : String(card.limit || ''),
            dueDay: card.dueDay === '' ? '' : String(card.dueDay || ''),
            closingDay: card.closingDay === '' ? '' : String(card.closingDay || ''),
            bestPurchaseDay: card.bestPurchaseDay === '' ? '' : String(card.bestPurchaseDay || '')
        });
        setShowCardForm(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    const removeCard = (cardId) => {
        setCards(prev => prev.filter(card => card.id !== cardId));
        setCardEntries(prev => prev.filter(entry => entry.cardId !== cardId));
        if (selectedCardId === cardId) {
            setSelectedCardId(null);
            setShowCardEntryForm(false);
            setEditingCardEntryId(null);
            setCardEntryForm(emptyCardEntryForm);
        }
        setConfirmDeleteCard(null);
        showToast('🗑️ Cartão removido', 'success');
    };
    const saveCardEntry = () => {
        if (!selectedCardId) {
            showToast('Selecione um cartão', 'warning');
            return;
        }
        const selectedCardData = cards.find(card => card.id === selectedCardId);
        if (!selectedCardData) {
            showToast('Cartão não encontrado', 'warning');
            return;
        }
        const totalValue = Number(cardEntryForm.totalValue || 0);
        const installmentCount = cardEntryForm.isInstallment ? Math.max(parseInt(cardEntryForm.installmentCount || 1, 10) || 1, 2) : 1;
        if (cardEntryForm.isRecurring && cardEntryForm.isInstallment) {
            showToast('Escolha parcelado OU recorrente', 'warning');
            return;
        }
        if (!cardEntryForm.description.trim() || totalValue <= 0 || !cardEntryForm.date) {
            showToast('Preencha descrição, valor total e data da compra', 'warning');
            return;
        }
        if (cardEntryForm.isInstallment && installmentCount < 2) {
            showToast('Informe pelo menos 2 parcelas', 'warning');
            return;
        }
        const payloads = buildCardEntriesFromForm(cardEntryForm, selectedCardData);
        const currentEditingEntry = cardEntries.find(entry => entry.id === editingCardEntryId);
        const editingGroupId = (currentEditingEntry === null || currentEditingEntry === void 0 ? void 0 : currentEditingEntry.installmentGroupId) || cardEntryForm.installmentGroupId || '';
        const editingRecurringGroupId = (currentEditingEntry === null || currentEditingEntry === void 0 ? void 0 : currentEditingEntry.recurringGroupId) || cardEntryForm.recurringGroupId || '';
        setCardEntries(prev => {
            const filtered = editingCardEntryId
                ? prev.filter(entry => editingRecurringGroupId ? entry.recurringGroupId !== editingRecurringGroupId : (editingGroupId ? entry.installmentGroupId !== editingGroupId : entry.id !== editingCardEntryId))
                : prev;
            return [...payloads, ...filtered];
        });
        setEditingCardEntryId(null);
        setCardEntryForm(prev => ({ ...emptyCardEntryForm, area: prev.area, category: getCats(prev.area, 'saida')[0], date: prev.date }));
        setShowCardEntryForm(false);
        showToast(editingCardEntryId
            ? (cardEntryForm.isRecurring ? '✅ Recorrência atualizada' : (payloads.length > 1 ? '✅ Parcelamento atualizado' : '✅ Lançamento do cartão atualizado'))
            : (cardEntryForm.isRecurring ? '✅ Compra recorrente salva' : (payloads.length > 1 ? '✅ Gasto parcelado salvo' : '✅ Gasto do cartão salvo')), 'success');
    };
    const editCardEntry = (entry) => {
        const groupEntries = entry.recurringGroupId
            ? cardEntries
                .filter(item => item.recurringGroupId === entry.recurringGroupId)
                .sort((a, b) => Number(a.recurringIndex || 1) - Number(b.recurringIndex || 1))
            : (entry.installmentGroupId
                ? cardEntries
                    .filter(item => item.installmentGroupId === entry.installmentGroupId)
                    .sort((a, b) => Number(a.installmentIndex || 1) - Number(b.installmentIndex || 1))
                : [entry]);
        const baseEntry = groupEntries.find(item => Number(item.installmentIndex || 1) === 1 || Number(item.recurringIndex || 1) === 1) || groupEntries[0] || entry;
        const totalPurchaseValue = entry.recurringGroupId
            ? Number(baseEntry.value || baseEntry.totalPurchaseValue || 0)
            : Number(baseEntry.totalPurchaseValue || groupEntries.reduce((sum, item) => sum + Number(item.value || 0), 0));
        const area = baseEntry.area || 'pessoal';
        const installmentCount = Math.max(parseInt(baseEntry.installmentCount || groupEntries.length || 1, 10) || 1, 1);
        setEditingCardEntryId(entry.id);
        setCardEntryForm({
            area,
            category: baseEntry.category || getCats(area, 'saida')[0],
            description: baseEntry.description || '',
            totalValue: totalPurchaseValue ? String(totalPurchaseValue.toFixed(2)) : '',
            date: baseEntry.purchaseDate || baseEntry.date || isoToday(),
            obs: baseEntry.obs || '',
            isInstallment: !baseEntry.isRecurring && installmentCount > 1,
            installmentCount: String(installmentCount > 1 ? installmentCount : 2),
            installmentGroupId: baseEntry.installmentGroupId || '',
            isRecurring: baseEntry.isRecurring === true,
            recurrenceMonths: String(baseEntry.recurrenceMonths || groupEntries.length || 72),
            recurringGroupId: baseEntry.recurringGroupId || ''
        });
        setShowCardEntryForm(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    const removeCardEntry = (entryId) => {
        const targetEntry = cardEntries.find(entry => entry.id === entryId);
        const recurringGroupId = (targetEntry === null || targetEntry === void 0 ? void 0 : targetEntry.recurringGroupId) || '';
        const groupId = (targetEntry === null || targetEntry === void 0 ? void 0 : targetEntry.installmentGroupId) || '';
        setCardEntries(prev => recurringGroupId
            ? prev.filter(entry => entry.recurringGroupId !== recurringGroupId)
            : (groupId ? prev.filter(entry => entry.installmentGroupId !== groupId) : prev.filter(entry => entry.id !== entryId)));
        setConfirmDeleteCardEntry(null);
        showToast(recurringGroupId ? '🗑️ Recorrência cancelada/removida' : (groupId ? '🗑️ Parcelamento removido' : '🗑️ Lançamento do cartão removido'), 'success');
    };
    const selectedCardEntries = useMemo(() => cardEntries
        .filter(entry => entry.cardId === selectedCardId)
        .sort((a, b) => `${b.date}_${b.id}`.localeCompare(`${a.date}_${a.id}`)), [cardEntries, selectedCardId]);
    const selectedCardEntriesForMonth = useMemo(() => selectedCardEntries
        .filter(entry => getCardInvoiceMonth(entry, selectedCard) === selectedMonth), [selectedCardEntries, selectedMonth, selectedCard]);
    const selectedCardEntriesGrouped = useMemo(() => {
        const groups = selectedCardEntriesForMonth.reduce((acc, entry) => {
            const ym = getCardInvoiceMonth(entry, selectedCard);
            if (!acc[ym])
                acc[ym] = [];
            acc[ym].push(entry);
            return acc;
        }, {});
        return Object.entries(groups)
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([month, entries]) => ({
            month,
            dueDate: getCardInvoiceDueDate(selectedCard, month),
            entries: entries.sort((a, b) => `${b.date}_${b.id}`.localeCompare(`${a.date}_${a.id}`)),
            summary: entries.reduce((acc, entry) => {
                const value = Number(entry.value || 0);
                acc.total += value;
                if (entry.area === 'pessoal')
                    acc.oficina += value;
                else
                    acc.pessoal += value;
                return acc;
            }, { total: 0, pessoal: 0, oficina: 0 })
        }));
    }, [selectedCardEntriesForMonth, selectedCard]);
    const selectedCardSummary = useMemo(() => {
        return selectedCardEntriesForMonth.reduce((acc, entry) => {
            const value = Number(entry.value || 0);
            acc.total += value;
            if (false)
                acc.oficina += value;
            else
                acc.pessoal += value;
            return acc;
        }, { total: 0, pessoal: 0, oficina: 0 });
    }, [selectedCardEntriesForMonth]);
    const fixedBillsForSelectedMonth = useMemo(() => fixedBills
        .filter(b => b.active !== false && compareYM(selectedMonth, getBillStartMonth(b)) >= 0)
        .sort((a, b) => parseInt(a.day, 10) - parseInt(b.day, 10)), [fixedBills, selectedMonth]);
    const fixedBillsSelectedSummary = useMemo(() => fixedBillsForSelectedMonth.reduce((acc, b) => {
        const value = Number(b.value || 0);
        acc.total += value;
        if ((b.area || 'pessoal') === 'pessoal')
            acc.pessoal += value;
        else
            acc.oficina += value;
        if (isBillPaidForMonth(b, selectedMonth))
            acc.paid += value;
        else
            acc.pending += value;
        return acc;
    }, { total: 0, pessoal: 0, oficina: 0, paid: 0, pending: 0 }), [fixedBillsForSelectedMonth, selectedMonth]);
    const formatDateBR = (value) => {
        if (!value)
            return '-';
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
            const [y, m, d] = String(value).split('-');
            return `${d}/${m}/${y}`;
        }
        return value;
    };
    const generateFinancialReportPDF = async () => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const marginLeft = 14;
        const marginRight = 14;
        const contentWidth = pageWidth - marginLeft - marginRight;
        const usableBottom = pageHeight - 18;
        const reportMonthLabel = monthLabel(selectedMonth).toUpperCase();
        const getReportDate = (item) => {
            if ((item === null || item === void 0 ? void 0 : item.syncSource) === 'office' && (item === null || item === void 0 ? void 0 : item.sourceOrderDate))
                return String(item.sourceOrderDate);
            return String((item === null || item === void 0 ? void 0 : item.date) || '');
        };
        const selectedTransactions = transactions
            .filter(item => {
            const reportDate = getReportDate(item);
            return reportDate && reportDate.slice(0, 7) === selectedMonth;
        })
            .sort((a, b) => `${getReportDate(a)}_${a.id}`.localeCompare(`${getReportDate(b)}_${b.id}`));
        const personalTransactions = selectedTransactions.filter(item => item.area === 'pessoal');
        const workshopTransactions = selectedTransactions.filter(item => item.area !== 'pessoal');
        const personalIncome = personalTransactions.filter(item => item.type === 'entrada');
        const personalExpense = personalTransactions.filter(item => item.type !== 'entrada');
        const workshopIncome = workshopTransactions.filter(item => item.type === 'entrada');
        const workshopExpense = workshopTransactions.filter(item => item.type !== 'entrada');
        const fixedBillsForMonth = fixedBills
            .filter(bill => ((bill === null || bill === void 0 ? void 0 : bill.active) !== false) && compareYM(selectedMonth, getBillStartMonth(bill)) >= 0)
            .map(bill => ({
            ...bill,
            dueDate: getBillDueDateForMonth(bill, selectedMonth),
            paid: isBillPaidForMonth(bill, selectedMonth)
        }))
            .sort((a, b) => {
            const aTime = a.dueDate ? a.dueDate.getTime() : 0;
            const bTime = b.dueDate ? b.dueDate.getTime() : 0;
            return aTime - bTime;
        });
        const cardReport = cards.map(card => {
            const entries = cardEntries
                .filter(entry => entry.cardId === card.id && getCardInvoiceMonth(entry, card) === selectedMonth)
                .sort((a, b) => `${a.date}_${a.id}`.localeCompare(`${b.date}_${b.id}`));
            const totals = entries.reduce((acc, entry) => {
                const value = Number(entry.value || 0);
                acc.total += value;
                if (false)
                    acc.oficina += value;
                else
                    acc.pessoal += value;
                return acc;
            }, { total: 0, pessoal: 0, oficina: 0 });
            return {
                ...card,
                dueDate: getCardInvoiceDueDate(card, selectedMonth),
                entries,
                totals
            };
        }).filter(card => card.entries.length > 0);
        let y = 18;
        let pageNumber = 1;
        let logoDataUrl = null;
        try {
            logoDataUrl = await getPdfLogoDataUrl();
        }
        catch (e) {
            logoDataUrl = null;
        }
        const moneyPdf = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        const drawFooter = () => {
            doc.setDrawColor(50, 50, 50);
            doc.line(marginLeft, pageHeight - 10, pageWidth - marginRight, pageHeight - 10);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(110, 110, 110);
            doc.text(`Relatório financeiro — ${reportMonthLabel}`, marginLeft, pageHeight - 5.5);
            doc.text(`Página ${pageNumber}`, pageWidth - marginRight, pageHeight - 5.5, { align: 'right' });
        };
        const addPage = () => {
            drawFooter();
            doc.addPage();
            pageNumber += 1;
            y = 18;
            addHeader(false);
        };
        const ensureSpace = (required = 12) => {
            if (y + required > usableBottom)
                addPage();
        };
        const addHeader = (firstPage = false) => {
            doc.setFillColor(5, 5, 5);
            doc.rect(0, 0, pageWidth, firstPage ? 42 : 32, 'F');
            if (logoDataUrl) {
                doc.addImage(logoDataUrl, 'JPEG', marginLeft, firstPage ? 6 : 5, firstPage ? 26 : 22, firstPage ? 26 : 22);
            }
            else {
                doc.setTextColor(212, 175, 55);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(firstPage ? 20 : 16);
                doc.text('AA', marginLeft + 6, firstPage ? 22 : 18);
            }
            doc.setTextColor(212, 175, 55);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(firstPage ? 18 : 14);
            doc.text('MY BANK BANK', 44, firstPage ? 14 : 12);
            doc.setFontSize(firstPage ? 10 : 8.5);
            doc.setTextColor(210, 210, 210);
            doc.setFont('helvetica', 'normal');
            doc.text('RELATÓRIO FINANCEIRO PROFISSIONAL', 44, firstPage ? 20 : 17);
            doc.text(`Período: ${reportMonthLabel}`, 44, firstPage ? 26 : 22);
            doc.text(`Emitido em: ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`, 44, firstPage ? 32 : 27);
            y = firstPage ? 50 : 38;
        };
        const addCoverPage = () => {
            const centerX = pageWidth / 2;
            doc.setFillColor(5, 5, 5);
            doc.rect(0, 0, pageWidth, pageHeight, 'F');
            doc.setDrawColor(212, 175, 55);
            doc.setLineWidth(1.2);
            doc.roundedRect(10, 10, pageWidth - 20, pageHeight - 20, 6, 6, 'S');
            doc.setDrawColor(120, 90, 20);
            doc.setLineWidth(0.3);
            doc.roundedRect(14, 14, pageWidth - 28, pageHeight - 28, 5, 5, 'S');
            doc.setFillColor(20, 20, 20);
            doc.roundedRect(24, 24, pageWidth - 48, 58, 4, 4, 'F');
            if (logoDataUrl) {
                doc.addImage(logoDataUrl, 'JPEG', centerX - 20, 32, 40, 40);
            }
            else {
                doc.setTextColor(212, 175, 55);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(28);
                doc.text('AA', centerX, 57, { align: 'center' });
            }
            doc.setTextColor(212, 175, 55);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(22);
            doc.text('MY BANK BANK', centerX, 98, { align: 'center' });
            doc.setFontSize(14);
            doc.setTextColor(235, 235, 235);
            doc.text('RELATÓRIO FINANCEIRO PREMIUM', centerX, 108, { align: 'center' });
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(10);
            doc.setTextColor(180, 180, 180);
            doc.text('Receitas • Despesas • Cartões • Contas Fixas • Consolidado', centerX, 117, { align: 'center' });
            doc.setFillColor(212, 175, 55);
            doc.roundedRect(42, 128, pageWidth - 84, 16, 3, 3, 'F');
            doc.setTextColor(10, 10, 10);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(12);
            doc.text(`PERÍODO ANALISADO: ${reportMonthLabel}`, centerX, 138, { align: 'center' });
            const boxTop = 156;
            const boxW = 50;
            const gap = 8;
            const startX = 24;
            const infoBoxes = [
                ['Receitas', moneyPdf(monthlySummary.totalIncome), [34, 197, 94]],
                ['Despesas', moneyPdf(monthlySummary.totalExpense), [239, 68, 68]],
                ['Resultado Pessoal', moneyPdf(monthlySummary.pSaved), monthlySummary.pSaved >= 0 ? [99, 102, 241] : [239, 68, 68]],
                ['Resultado', moneyPdf(monthlySummary.wProfit), monthlySummary.wProfit >= 0 ? [212, 175, 55] : [239, 68, 68]],
            ];
            infoBoxes.forEach((item, idx) => {
                const x = startX + idx * (boxW + gap);
                doc.setFillColor(18, 18, 18);
                doc.setDrawColor(70, 70, 70);
                doc.roundedRect(x, boxTop, boxW, 28, 3, 3, 'FD');
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(7);
                doc.setTextColor(170, 170, 170);
                doc.text(item[0], x + (boxW / 2), boxTop + 8, { align: 'center' });
                doc.setFontSize(9);
                doc.setTextColor(...item[2]);
                doc.text(item[1], x + (boxW / 2), boxTop + 18, { align: 'center' });
            });
            doc.setFillColor(15, 15, 15);
            doc.setDrawColor(212, 175, 55);
            doc.roundedRect(24, 198, pageWidth - 48, 40, 4, 4, 'FD');
            doc.setTextColor(212, 175, 55);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            doc.text('CONTEÚDO DO RELATÓRIO', 30, 208);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9.5);
            doc.setTextColor(225, 225, 225);
            const coverLines = [
                '• Resumo executivo do mês',
                '• Demonstrativo financeiro pessoal',
                '• Movimentações detalhadas de receitas e despesas',
                '• Rateio por categoria',
                '• Contas fixas e situação mensal',
                '• Faturas e gastos por cartão'
            ];
            coverLines.forEach((line, idx) => doc.text(line, 30, 217 + idx * 6));
            doc.setTextColor(150, 150, 150);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8.5);
            doc.text(`Emitido em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`, centerX, 258, { align: 'center' });
            doc.text('My Bank • Gestão Financeira', centerX, 266, { align: 'center' });
        };
        const sectionTitle = (title, subtitle = '') => {
            ensureSpace(16);
            doc.setFillColor(245, 245, 245);
            doc.roundedRect(marginLeft, y, contentWidth, 10, 2, 2, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            doc.setTextColor(20, 20, 20);
            doc.text(title, marginLeft + 4, y + 6.5);
            if (subtitle) {
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(8);
                doc.setTextColor(90, 90, 90);
                doc.text(subtitle, pageWidth - marginRight - 2, y + 6.5, { align: 'right' });
            }
            y += 14;
        };
        const summaryCard = (x, top, w, h, title, value, detail = '', valueColor = [20, 20, 20]) => {
            doc.setDrawColor(220, 220, 220);
            doc.setFillColor(252, 252, 252);
            doc.roundedRect(x, top, w, h, 3, 3, 'FD');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(100, 100, 100);
            doc.text(title, x + 4, top + 6);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            doc.setTextColor(...valueColor);
            doc.text(value, x + 4, top + 13);
            if (detail) {
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(7);
                doc.setTextColor(120, 120, 120);
                const lines = doc.splitTextToSize(detail, w - 8);
                doc.text(lines.slice(0, 2), x + 4, top + 18);
            }
        };
        const drawTable = (columns, rows, options = {}) => {
            const rowHeight = options.rowHeight || 7;
            const headerHeight = options.headerHeight || 8;
            const emptyMessage = options.emptyMessage || 'Sem dados no período.';
            ensureSpace(headerHeight + rowHeight + 4);
            if (!rows.length) {
                doc.setDrawColor(230, 230, 230);
                doc.roundedRect(marginLeft, y, contentWidth, 12, 2, 2, 'S');
                doc.setFont('helvetica', 'italic');
                doc.setFontSize(8.5);
                doc.setTextColor(130, 130, 130);
                doc.text(emptyMessage, marginLeft + 4, y + 7.5);
                y += 16;
                return;
            }
            const widths = columns.map(col => Math.floor((contentWidth * col.width) / 1000 * 100) / 100);
            const drawHeaderRow = () => {
                ensureSpace(headerHeight + rowHeight);
                doc.setFillColor(20, 20, 20);
                doc.rect(marginLeft, y, contentWidth, headerHeight, 'F');
                let x = marginLeft;
                columns.forEach((col, index) => {
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(8);
                    doc.setTextColor(255, 255, 255);
                    const align = col.align || 'left';
                    const textX = align === 'right' ? x + widths[index] - 2 : x + 2;
                    doc.text(col.label, textX, y + 5.4, { align });
                    x += widths[index];
                });
                y += headerHeight;
            };
            drawHeaderRow();
            rows.forEach((row, rowIndex) => {
                ensureSpace(rowHeight + 2);
                doc.setFillColor(rowIndex % 2 === 0 ? 248 : 255, rowIndex % 2 === 0 ? 248 : 255, rowIndex % 2 === 0 ? 248 : 255);
                doc.rect(marginLeft, y, contentWidth, rowHeight, 'F');
                let x = marginLeft;
                columns.forEach((col, index) => {
                    const cell = row[index] == null ? '' : String(row[index]);
                    const align = col.align || 'left';
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(7.7);
                    doc.setTextColor(35, 35, 35);
                    const text = doc.splitTextToSize(cell, Math.max(10, widths[index] - 4))[0] || '';
                    const textX = align === 'right' ? x + widths[index] - 2 : x + 2;
                    doc.text(text, textX, y + 4.8, { align });
                    x += widths[index];
                });
                y += rowHeight;
                if (y + rowHeight > usableBottom) {
                    addPage();
                    drawHeaderRow();
                }
            });
            y += 4;
        };
        const buildCategoryRows = (categoryMap) => Object.entries(categoryMap || {})
            .sort((a, b) => b[1] - a[1])
            .map(([category, value]) => [category, moneyPdf(value)]);
        addCoverPage();
        doc.addPage();
        pageNumber = 2;
        addHeader(true);
        sectionTitle('RESUMO EXECUTIVO', 'Visão consolidada do mês');
        const cardWidth = (contentWidth - 8) / 2;
        summaryCard(marginLeft, y, cardWidth, 26, 'Receitas totais', moneyPdf(monthlySummary.totalIncome), 'Financeiro pessoal', [22, 163, 74]);
        summaryCard(marginLeft + cardWidth + 8, y, cardWidth, 26, 'Despesas totais', moneyPdf(monthlySummary.totalExpense), 'Saídas do mês', [220, 38, 38]);
        y += 30;
        summaryCard(marginLeft, y, cardWidth, 26, 'Resultado pessoal', moneyPdf(monthlySummary.pSaved), `Entradas: ${moneyPdf(monthlySummary.p.i)} | Saídas: ${moneyPdf(monthlySummary.p.e)}`, monthlySummary.pSaved >= 0 ? [79, 70, 229] : [220, 38, 38]);
        summaryCard(marginLeft + cardWidth + 8, y, cardWidth, 26, 'Resultado', moneyPdf(monthlySummary.wProfit), `Receitas: ${moneyPdf(monthlySummary.w.i)} | Despesas: ${moneyPdf(monthlySummary.w.e)}`, monthlySummary.wProfit >= 0 ? [180, 140, 40] : [220, 38, 38]);
        y += 34;
        ensureSpace(16);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(90, 90, 90);
        doc.text(`Lançamentos no mês: ${monthlySummary.count}`, marginLeft, y);
        doc.text(`Gastos pessoais pagos pela oficina: ${moneyPdf(monthlySummary.personalViaWorkshop)}`, pageWidth - marginRight, y, { align: 'right' });
        y += 10;
        sectionTitle('DEMONSTRATIVO CONSOLIDADO', 'Receitas, despesas e saldos');
        drawTable([
            { label: 'Indicador', width: 620 },
            { label: 'Valor', width: 380, align: 'right' }
        ], [
            ['Receita pessoal', moneyPdf(monthlySummary.p.i)],
            ['Despesa pessoal', moneyPdf(monthlySummary.p.e)],
            ['Resultado pessoal', moneyPdf(monthlySummary.pSaved)],
            ['Receita oficina', moneyPdf(monthlySummary.w.i)],
            ['Despesa oficina', moneyPdf(monthlySummary.w.e)],
            ['Gastos pessoais via oficina', moneyPdf(monthlySummary.personalViaWorkshop)],
            ['Lucro / resultado da oficina', moneyPdf(monthlySummary.wProfit)],
            ['Receitas totais', moneyPdf(monthlySummary.totalIncome)],
            ['Despesas totais', moneyPdf(monthlySummary.totalExpense)]
        ]);
        sectionTitle('MOVIMENTAÇÕES PESSOAIS', `${personalTransactions.length} lançamento(s)`);
        drawTable([
            { label: 'Data', width: 120 },
            { label: 'Tipo', width: 110 },
            { label: 'Categoria', width: 220 },
            { label: 'Descrição', width: 340 },
            { label: 'Valor', width: 210, align: 'right' }
        ], personalTransactions.map(item => [
            formatDateBR(getReportDate(item)),
            item.type === 'entrada' ? 'Receita' : 'Despesa',
            item.category || '-',
            item.description || item.obs || '-',
            moneyPdf(item.value)
        ]), { emptyMessage: 'Nenhum lançamento pessoal neste mês.' });
        sectionTitle('MOVIMENTAÇÕES', `${workshopTransactions.length} lançamento(s)`);
        drawTable([
            { label: 'Data', width: 120 },
            { label: 'Tipo', width: 110 },
            { label: 'Categoria', width: 210 },
            { label: 'Descrição', width: 320 },
            { label: 'Origem', width: 100 },
            { label: 'Valor', width: 140, align: 'right' }
        ], workshopTransactions.map(item => [
            formatDateBR(getReportDate(item)),
            item.type === 'entrada' ? 'Receita' : 'Despesa',
            item.category || '-',
            item.description || item.obs || '-',
            item.syncSource === 'office' ? 'OS paga' : (item.syncSource === 'fixed_bill' ? 'Conta fixa' : 'Manual'),
            moneyPdf(item.value)
        ]), { emptyMessage: 'Nenhum lançamento neste mês.' });
        sectionTitle('DESPESAS PESSOAIS POR CATEGORIA', 'Rateio do mês');
        drawTable([
            { label: 'Categoria', width: 700 },
            { label: 'Valor', width: 300, align: 'right' }
        ], buildCategoryRows(monthlySummary.catExpP), { emptyMessage: 'Sem despesas pessoais categorizadas.' });
        sectionTitle('DESPESAS POR CATEGORIA', 'Rateio do mês');
        drawTable([
            { label: 'Categoria', width: 700 },
            { label: 'Valor', width: 300, align: 'right' }
        ], buildCategoryRows(monthlySummary.catExpW), { emptyMessage: 'Sem despesas categorizadas.' });
        sectionTitle('CONTAS FIXAS DO MÊS', `${fixedBillsForMonth.length} conta(s)`);
        drawTable([
            { label: 'Conta', width: 320 },
            { label: 'Área', width: 120 },
            { label: 'Vencimento', width: 170 },
            { label: 'Status', width: 140 },
            { label: 'Valor', width: 250, align: 'right' }
        ], fixedBillsForMonth.map(bill => [
            bill.name || '-',
            'Pessoal',
            bill.dueDate ? bill.dueDate.toLocaleDateString('pt-BR') : '-',
            bill.paid ? 'Pago' : 'Aberto',
            moneyPdf(bill.value)
        ]), { emptyMessage: 'Nenhuma conta fixa programada para este mês.' });
        sectionTitle('FATURAS E GASTOS DE CARTÕES', `${cardReport.length} cartão(ões) com movimentação`);
        if (!cardReport.length) {
            drawTable([], [], { emptyMessage: 'Nenhum gasto de cartão no período.' });
        }
        else {
            cardReport.forEach(card => {
                ensureSpace(18);
                doc.setDrawColor(220, 220, 220);
                doc.roundedRect(marginLeft, y, contentWidth, 12, 2, 2, 'S');
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(9.5);
                doc.setTextColor(30, 30, 30);
                const cardName = `${card.name || 'Cartão'}${card.brand ? ` • ${card.brand}` : ''}${card.final ? ` • final ${card.final}` : ''}`;
                doc.text(cardName, marginLeft + 3, y + 5);
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(8);
                doc.setTextColor(100, 100, 100);
                const dueText = card.dueDate ? `Vencimento: ${card.dueDate.toLocaleDateString('pt-BR')}` : 'Sem vencimento definido';
                doc.text(`${dueText}  |  Total fatura: ${moneyPdf(card.totals.total)}`, marginLeft + 3, y + 9.5);
                y += 16;
                drawTable([
                    { label: 'Data', width: 120 },
                    { label: 'Área', width: 120 },
                    { label: 'Categoria', width: 220 },
                    { label: 'Descrição', width: 330 },
                    { label: 'Valor', width: 210, align: 'right' }
                ], card.entries.map(entry => [
                    formatDateBR(entry.date),
                    'Pessoal',
                    entry.category || '-',
                    `${entry.description || entry.obs || '-'}${entry.isInstallment ? ` (${entry.installmentIndex}/${entry.installmentCount})` : ''}`,
                    moneyPdf(entry.value)
                ]), { emptyMessage: 'Sem compras nesta fatura.' });
            });
        }
        drawFooter();
        const safeMonth = selectedMonth.replace(/[^0-9-]/g, '');
        doc.save(`RELATORIO_FINANCEIRO_${safeMonth}.pdf`);
        showToast('📄 Relatório financeiro em PDF gerado!', 'success');
    };
    // ── UI helpers ─────────────────────────────────────────────────────
    const AreaBadge = ({ area, size = 'sm' }) => {
        const m = AREA_META.pessoal;
        const sz = size === 'xs' ? 'text-[8px] px-1.5 py-0.5' : 'text-[9px] px-2 py-0.5';
        return React.createElement("span", { className: `${sz} rounded-full font-bold border`, style: { color: m.color, background: m.bg, borderColor: m.border } }, m.label);
    };
    const TypeBadge = ({ type }) => (React.createElement("span", { className: `text-[8px] px-1.5 py-0.5 rounded-full font-bold border ${type === 'entrada'
            ? 'text-green-400 bg-green-500/10 border-green-500/30'
            : 'text-red-400 bg-red-500/10 border-red-500/30'}` }, type === 'entrada' ? '↑ ENTRADA' : '↓ SAÍDA'));
    const ProgressBar = ({ value, total, color = '#d4af37', height = 6 }) => {
        const p = pct(value, total);
        const c = p >= 90 ? '#ef4444' : p >= 70 ? '#eab308' : color;
        return (React.createElement("div", { style: { height, borderRadius: height, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' } },
            React.createElement("div", { style: { height: '100%', width: `${p}%`, background: c, borderRadius: height, transition: 'width .5s ease-out' } })));
    };
    const MonthNav = () => (React.createElement("div", { className: "month-nav-fix" },
        React.createElement("button", { onClick: () => { const i = availableMonths.indexOf(selectedMonth); if (i < availableMonths.length - 1)
                setSelectedMonth(availableMonths[i + 1]); }, className: "btn-icon text-gray-400 bg-white/5 rounded-xl w-9 h-9", disabled: availableMonths.indexOf(selectedMonth) === availableMonths.length - 1 },
            React.createElement(BankUiIcon, { name: "chevron-left", size: 16, color: "#9ca3af" })),
        React.createElement("select", { value: selectedMonth, onChange: e => setSelectedMonth(e.target.value), className: "flex-1 p-2 rounded-xl text-center text-xs font-usarmy", style: { background: '#0f0f0f', color: '#d4af37', border: '1px solid rgba(212,175,55,0.2)' } }, availableMonths.map(m => React.createElement("option", { key: m, value: m }, monthLabel(m)))),
        React.createElement("button", { onClick: () => { const i = availableMonths.indexOf(selectedMonth); if (i > 0)
                setSelectedMonth(availableMonths[i - 1]); }, className: "btn-icon text-gray-400 bg-white/5 rounded-xl w-9 h-9", disabled: availableMonths.indexOf(selectedMonth) === 0 },
            React.createElement(BankUiIcon, { name: "chevron-right", size: 16, color: "#9ca3af" }))));
    // ── RENDER ─────────────────────────────────────────────────────────
    return (React.createElement("div", { className: "animate-fadeIn pb-6" },
        React.createElement("div", { className: "flex items-center justify-between mb-4" },
            React.createElement("button", { onClick: onBack, className: "btn-icon text-gray-400", "aria-label": "Voltar" },
                React.createElement(BankUiIcon, { name: "user", size: 20, color: "#9ca3af" })),
            React.createElement("div", { className: "text-center flex-1" },
                React.createElement("p", { className: "font-usarmy text-[#d4af37] text-sm tracking-widest" }, "MY BANK"),
                React.createElement("p", { className: "text-[9px] text-gray-500 font-mono" }, "GEST\u00C3O FINANCEIRA"),
                React.createElement("p", { className: "text-[9px] text-cyan-400 font-mono" })),
            React.createElement("div", { className: "relative" },
                React.createElement("button", { onClick: () => setTab('fixas'), className: `btn-icon relative ${alertBellCount > 0 ? 'text-yellow-400' : 'text-gray-500'}`, "aria-label": "Alertas de contas fixas", title: "Alertas de contas fixas" },
                    React.createElement(BankUiIcon, { name: "bell-ring", size: 20, color: alertBellCount > 0 ? '#facc15' : '#6b7280' }),
                    alertBellCount > 0 && (React.createElement("span", { className: "absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-red-500 rounded-full text-[8px] font-bold text-white flex items-center justify-center" }, alertBellCount))))),
        editingDebtItem && (React.createElement("div", { className: "modal-overlay", onClick: () => setEditingDebtItem(null) },
            React.createElement("div", { className: "modal-content p-5", onClick: e => e.stopPropagation() },
                React.createElement("p", { className: "font-usarmy text-[#d4af37] text-xs mb-3" }, "EDITAR ITEM DO PLANO"),
                React.createElement("div", { className: "space-y-3" },
                    React.createElement("input", { className: "w-full p-3 rounded-xl", placeholder: "Nome da conta", value: debtItemForm.label, onChange: e => setDebtItemForm(prev => ({ ...prev, label: e.target.value })) }),
                    React.createElement("input", { type: "text", inputMode: "decimal", step: "0.01", className: "w-full p-3 rounded-xl", placeholder: "Valor", value: debtItemForm.value, onChange: e => setDebtItemForm(prev => ({ ...prev, value: e.target.value })) }),
                    debtItemForm.section === 'currentMonthCritical' && (React.createElement(React.Fragment, null,
                        React.createElement("input", { className: "w-full p-3 rounded-xl", placeholder: "Vencimento", value: debtItemForm.due, onChange: e => setDebtItemForm(prev => ({ ...prev, due: e.target.value })) }),
                        React.createElement("input", { className: "w-full p-3 rounded-xl", placeholder: "Tipo", value: debtItemForm.type, onChange: e => setDebtItemForm(prev => ({ ...prev, type: e.target.value })) }))),
                    debtItemForm.section === 'currentMonthNegotiation' && (React.createElement("input", { className: "w-full p-3 rounded-xl", placeholder: "Status", value: debtItemForm.status, onChange: e => setDebtItemForm(prev => ({ ...prev, status: e.target.value })) })),
                    React.createElement("div", { className: "grid grid-cols-2 gap-3 pt-1" },
                        React.createElement("button", { onClick: () => setEditingDebtItem(null), className: "p-3 rounded-xl border border-white/10 text-gray-400 font-usarmy text-xs" }, "CANCELAR"),
                        React.createElement("button", { onClick: saveDebtItemEdit, className: "gold-gradient p-3 rounded-xl font-usarmy text-xs" }, "SALVAR")))))),
        React.createElement("div", { className: "grid grid-cols-2 gap-3 mb-4" },
            React.createElement("div", { className: "aa-card wallet-card wallet-personal rounded-2xl p-4 relative overflow-hidden" },
                React.createElement("div", { className: "aa-card-overlay absolute top-0 right-0 w-20 h-20 rounded-full opacity-10" }),
                React.createElement("div", { className: "flex items-center gap-2 mb-3" },
                    React.createElement("div", { className: "aa-icon-badge w-7 h-7 rounded-full flex items-center justify-center" },
                        React.createElement(BankUiIcon, { name: "user", size: 14, color: "#6366f1" })),
                    React.createElement("span", { className: "text-[9px] font-usarmy" }, "SALDO")),
                React.createElement("p", { className: "font-usarmy text-base mb-1" }, money(totalSummary.pBalance)),
                React.createElement("div", { className: "flex justify-between text-[8px] font-mono text-gray-500" },
                    React.createElement("span", { className: "text-green-400" },
                        "\u2191 ",
                        money(totalSummary.pIncome)),
                    React.createElement("span", { className: "text-red-400" },
                        "\u2193 ",
                        money(totalSummary.pExpense)))),
            React.createElement("div", { className: "aa-card wallet-card wallet-workshop rounded-2xl p-4 relative overflow-hidden" },
                React.createElement("div", { className: "aa-card-overlay absolute top-0 right-0 w-20 h-20 rounded-full opacity-10" }),
                React.createElement("div", { className: "flex items-center gap-2 mb-3" },
                    React.createElement("div", { className: "aa-icon-badge w-7 h-7 rounded-full flex items-center justify-center" },
                        React.createElement(BankUiIcon, { name: "wrench", size: 14, color: "#d4af37" })),
                    React.createElement("span", { className: "text-[9px] font-usarmy" }, "PESSOAL")),
                React.createElement("p", { className: "font-usarmy text-base mb-1" }, money(totalSummary.wBalance)),
                React.createElement("div", { className: "flex justify-between text-[8px] font-mono text-gray-500" },
                    React.createElement("span", { className: "text-green-400" },
                        "\u2191 ",
                        money(totalSummary.wIncome)),
                    React.createElement("span", { className: "text-red-400" },
                        "\u2193 ",
                        money(totalSummary.wExpense))))),
        React.createElement("div", { className: "bank-nav-grid-fix" }, [
            ['dashboard', 'PAINEL', 'layout-dashboard'],
            ['lancamentos', 'LANÇAR', 'plus-circle'],
            ['extratos', 'EXTRATOS', 'list'],
            ['fixas', 'FIXAS', 'calendar-clock'],
            ['cartoes', 'CARTÕES', 'credit-card'],
            ['fechamento', 'CAIXA', 'shield'],
            ['relatorios', 'RELATÓRIO', 'bar-chart-2']
        ].map(([key, label, icon]) => (React.createElement("button", { key: key, onClick: () => setTab(key), className: `bank-nav-card p-2.5 rounded-xl text-[9px] font-usarmy relative ${tab === key ? 'gold-gradient' : 'aa-card-button'}` },
            key === 'fixas' && urgentCount > 0 && (React.createElement("span", { className: "absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 rounded-full text-[7px] font-bold text-white flex items-center justify-center" }, urgentCount)),
            React.createElement("div", { className: "flex justify-center mb-0.5" },
                React.createElement(BankUiIcon, { name: icon, size: 14, color: tab === key ? "#000000" : "#9ca3af" })),
            label)))),
        tab === 'dashboard' && (React.createElement("div", { className: "space-y-4 animate-fadeIn" },
            React.createElement(MonthNav, null),
            React.createElement("div", { className: "grid grid-cols-2 gap-3" },
                React.createElement("div", { className: "os-card p-4 rounded-xl" },
                    React.createElement("p", { className: "text-[8px] text-gray-500 font-mono mb-1" }, "RECEITA DO M\u00CAS"),
                    React.createElement("p", { className: "font-usarmy text-green-400 text-sm" }, money(monthlySummary.totalIncome)),
                    React.createElement("div", { className: "mt-2 text-[9px] text-gray-600 space-y-0.5" },
                        React.createElement("div", { className: "flex justify-between" },
                            React.createElement("span", { style: { color: '#818cf8' } }, "Pessoal"),
                            React.createElement("span", null, money(monthlySummary.p.i))),
                        React.createElement("div", { className: "flex justify-between" },
                            null,
                            React.createElement("span", null, money(monthlySummary.w.i))))),
                React.createElement("div", { className: "os-card p-4 rounded-xl" },
                    React.createElement("p", { className: "text-[8px] text-gray-500 font-mono mb-1" }, "DESPESAS DO M\u00CAS"),
                    React.createElement("p", { className: "font-usarmy text-red-400 text-sm" }, money(monthlySummary.totalExpense)),
                    React.createElement("div", { className: "mt-2 text-[9px] text-gray-600 space-y-0.5" },
                        React.createElement("div", { className: "flex justify-between" },
                            React.createElement("span", { style: { color: '#818cf8' } }, "Pessoal"),
                            React.createElement("span", null, money(monthlySummary.p.e))),
                        React.createElement("div", { className: "flex justify-between" },
                            null,
                            React.createElement("span", null, money(monthlySummary.w.e))))),
                React.createElement("div", { className: "os-card p-4 rounded-xl" },
                    React.createElement("p", { className: "text-[8px] text-gray-500 font-mono mb-1" }, "POUPAN\u00C7A PESSOAL"),
                    React.createElement("p", { className: `font-usarmy text-sm ${monthlySummary.pSaved >= 0 ? 'text-green-400' : 'text-red-400'}` }, money(monthlySummary.pSaved)),
                    React.createElement("div", { className: "mt-2" },
                        React.createElement(ProgressBar, { value: monthlySummary.p.e, total: budgets.personal, color: "#6366f1" }),
                        React.createElement("p", { className: "text-[8px] text-gray-600 mt-1" },
                            pct(monthlySummary.p.e, budgets.personal),
                            "% do or\u00E7amento"))),
                React.createElement("div", { className: "os-card p-4 rounded-xl" },
                    React.createElement("p", { className: "text-[8px] text-gray-500 font-mono mb-1" }, "LUCRO DA OFICINA"),
                    React.createElement("p", { className: `font-usarmy text-sm ${monthlySummary.wProfit >= 0 ? 'text-[#d4af37]' : 'text-red-400'}` }, money(monthlySummary.wProfit)),
                    React.createElement("div", { className: "mt-2" },
                        React.createElement(ProgressBar, { value: monthlySummary.w.e, total: budgets.workshop, color: "#d4af37" }),
                        React.createElement("p", { className: "text-[8px] text-green-400 mt-1" },
                            "Lucro real OS: ",
                            money(monthlySummary.workshopRealProfit),
                            " \u2022 ",
                            (monthlySummary.workshopRealMargin || 0).toFixed(1),
                            "%"),
                        React.createElement("p", { className: "text-[8px] text-gray-600 mt-1" },
                            pct(monthlySummary.w.e, budgets.workshop),
                            "% do or\u00E7amento")))))),
        tab === 'lancamentos' && (React.createElement("div", { className: "space-y-4 animate-fadeIn" },
            React.createElement("div", { className: "os-card p-4 rounded-xl" },
                React.createElement("p", { className: "font-usarmy text-[#d4af37] text-xs mb-4" }, editingId ? '✏️ EDITAR LANÇAMENTO' : '➕ NOVO LANÇAMENTO'),
                
                React.createElement("p", { className: "text-[9px] text-gray-500 font-mono mb-2" }, "TIPO"),
                React.createElement("div", { className: "grid grid-cols-2 gap-2 mb-4" }, [['entrada', '↑ ENTRADA', '#22c55e'], ['saida', '↓ SAÍDA', '#ef4444']].map(([type, label, color]) => (React.createElement("button", { key: type, onClick: () => handleTypeChange(type), className: "p-3 rounded-xl font-usarmy text-[10px] transition-all", style: { background: form.type === type ? `${color}18` : 'rgba(255,255,255,0.04)',
                        border: `1.5px solid ${form.type === type ? color : 'rgba(255,255,255,0.08)'}`,
                        color: form.type === type ? color : '#6b7280' } }, label)))),
                React.createElement("div", { className: "rounded-xl p-3 mb-4", style: { background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.18)' } },
                    React.createElement("div", { className: "flex items-center justify-between gap-3" },
                        React.createElement("div", null,
                            React.createElement("p", { className: "text-[8px] text-gray-500 font-mono" }, "CATEGORIA INTELIGENTE"),
                            React.createElement("p", { className: "font-usarmy text-[11px] text-[#d4af37] mt-1" }, form.category || 'AUTO'),
                            React.createElement("p", { className: "text-[8px] text-gray-600 mt-0.5" }, form.categoryManual ? 'Editada manualmente' : 'Automática pela descrição')),
                        React.createElement("div", { className: "flex items-center gap-2" },
                            React.createElement(BankUiIcon, { name: CAT_ICONS[form.category] || 'sparkles', size: 18, color: "#d4af37" }),
                            React.createElement("button", { onClick: () => setForm(p => ({ ...p, categoryManual: !p.categoryManual, category: p.category || inferSmartCategory(p) })), className: "px-3 py-2 rounded-xl border font-usarmy text-[9px]", style: { borderColor: 'rgba(212,175,55,0.28)', color: '#d4af37', background: 'rgba(0,0,0,0.18)' } }, form.categoryManual ? 'AUTO' : 'EDITAR'))),
                    form.categoryManual && (React.createElement("select", { value: form.category, onChange: e => setForm(p => ({ ...p, category: e.target.value, categoryManual: true })), className: "w-full p-3 rounded-xl mt-3 text-sm" }, getTransactionCats(form.area, form.type, form.isPersonalExpense).map(cat => (React.createElement("option", { key: cat, value: cat }, cat)))))),
                React.createElement("div", { className: "grid grid-cols-2 gap-3 mb-3" },
                    React.createElement("div", null,
                        React.createElement("p", { className: "text-[9px] text-gray-500 font-mono mb-1" }, "DATA"),
                        React.createElement("input", { type: "date", value: form.date, onChange: e => setForm(p => ({ ...p, date: e.target.value })), className: "w-full p-3 rounded-xl text-sm" })),
                    React.createElement("div", null,
                        React.createElement("p", { className: "text-[9px] text-gray-500 font-mono mb-1" }, "VALOR (R$)"),
                        React.createElement("input", { type: "text", inputMode: "decimal", inputMode: "decimal", step: "0.01", min: "0", value: form.value, placeholder: "0,00", onChange: e => setForm(p => ({ ...p, value: e.target.value })), className: "w-full p-3 rounded-xl text-sm" }))),
                React.createElement("p", { className: "text-[9px] text-gray-500 font-mono mb-1" }, "DESCRI\u00C7\u00C3O"),
                React.createElement("input", { type: "text", value: form.description, placeholder: "Ex: mercado, gasolina, pe\u00E7a, frete, servi\u00E7o...", onChange: e => setForm(p => ({ ...p, description: e.target.value })), className: "w-full p-3 rounded-xl mb-3 text-sm" }),
                React.createElement("p", { className: "text-[9px] text-gray-500 font-mono mb-1" }, "OBSERVA\u00C7\u00C3O (opcional)"),
                React.createElement("input", { type: "text", value: form.obs, placeholder: "Detalhes extras...", onChange: e => setForm(p => ({ ...p, obs: e.target.value })), className: "w-full p-3 rounded-xl mb-4 text-sm" }),
                React.createElement("div", { className: "grid grid-cols-2 gap-3" },
                    React.createElement("button", { onClick: saveTransaction, className: "p-4 rounded-xl border border-white/10 text-gray-400 font-usarmy text-xs" }, editingId ? 'ATUALIZAR' : 'SALVAR LANÇAMENTO'),
                    React.createElement("button", { onClick: () => { setEditingId(null); setForm({ ...emptyForm, date: form.date }); }, className: "p-4 rounded-xl border border-white/10 text-gray-400 font-usarmy text-xs" }, "LIMPAR"))))),
        tab === 'extratos' && (React.createElement("div", { className: "space-y-4 animate-fadeIn" },
            React.createElement(MonthNav, null),
            React.createElement("div", { className: "os-card p-3 rounded-xl" },
                React.createElement("input", { type: "text", value: search, placeholder: "Buscar lan\u00E7amentos...", onChange: e => setSearch(e.target.value), className: "w-full p-3 rounded-xl text-sm mb-3" }),
                React.createElement("div", { className: "grid grid-cols-2 gap-2" },
                    React.createElement("select", { value: filterArea, onChange: e => setFilterArea(e.target.value), className: "p-2 rounded-xl text-xs" },
                        React.createElement("option", { value: "todos" }, "Todas as \u00E1reas"),
                        React.createElement("option", { value: "pessoal" }, "Pessoal"),
                        null),
                    React.createElement("select", { value: filterType, onChange: e => setFilterType(e.target.value), className: "p-2 rounded-xl text-xs" },
                        React.createElement("option", { value: "todos" }, "Entradas e sa\u00EDdas"),
                        React.createElement("option", { value: "entrada" }, "Entradas"),
                        React.createElement("option", { value: "saida" }, "Sa\u00EDdas")))),
            React.createElement("div", { className: "grid grid-cols-3 gap-2" },
                React.createElement("div", { className: "os-card p-2 rounded-xl text-center" },
                    React.createElement("p", { className: "text-[8px] text-gray-500 font-mono" }, "LAN\u00C7AMENTOS"),
                    React.createElement("p", { className: "font-usarmy text-white text-sm" }, filteredTransactions.length)),
                React.createElement("div", { className: "os-card p-2 rounded-xl text-center" },
                    React.createElement("p", { className: "text-[8px] text-gray-500 font-mono" }, "ENTRADAS"),
                    React.createElement("p", { className: "font-usarmy text-green-400 text-sm" }, money(filteredTransactions.filter(t => t.type === 'entrada').reduce((s, t) => s + Number(t.value || 0), 0)))),
                React.createElement("div", { className: "os-card p-2 rounded-xl text-center" },
                    React.createElement("p", { className: "text-[8px] text-gray-500 font-mono" }, "SA\u00CDDAS"),
                    React.createElement("p", { className: "font-usarmy text-red-400 text-sm" }, money(filteredTransactions.filter(t => t.type === 'saida').reduce((s, t) => s + Number(t.value || 0), 0))))),
            React.createElement("div", { className: "os-card p-4 rounded-xl mb-3" },
                React.createElement("div", { className: "flex items-center justify-between mb-3" },
                    React.createElement("p", { className: "font-usarmy text-[#d4af37] text-xs" }, "BLOCOS MENSAIS DO EXTRATO"),
                    React.createElement("span", { className: "text-[8px] text-gray-500 font-mono" }, "AGRUPADO POR M\u00CAS")),
                React.createElement("div", { className: "space-y-2 max-h-56 overflow-y-auto pr-1" }, monthlyExtractGroups.slice(0, 6).map(([ym, items]) => {
                    const totalIn = items.filter(i => i.type === 'entrada').reduce((s, i) => s + Number(i.value || 0), 0);
                    const totalOut = items.filter(i => i.type === 'saida').reduce((s, i) => s + Number(i.value || 0), 0);
                    return (React.createElement("button", { key: ym, onClick: () => setSelectedMonth(ym), className: "w-full text-left rounded-xl p-3 border border-white/10 bg-white/5" },
                        React.createElement("div", { className: "flex items-center justify-between gap-3" },
                            React.createElement("div", null,
                                React.createElement("p", { className: "font-usarmy text-white text-[11px]" }, monthLabel(ym).toUpperCase()),
                                React.createElement("p", { className: "text-[8px] text-gray-500 mt-1" },
                                    items.length,
                                    " movimento(s)")),
                            React.createElement("div", { className: "text-right text-[8px]" },
                                React.createElement("p", { className: "text-green-400" },
                                    "\u2191 ",
                                    money(totalIn)),
                                React.createElement("p", { className: "text-red-400 mt-1" },
                                    "\u2193 ",
                                    money(totalOut))))));
                }))),
            React.createElement("div", { className: "space-y-2" },
                filteredTransactions.length === 0 && (React.createElement("div", { className: "os-card p-10 rounded-xl text-center text-gray-600 font-usarmy text-xs" }, "SEM LAN\u00C7AMENTOS")),
                filteredTransactions.map(t => {
                    var _a;
                    const isPE = t.isPersonalExpense || PERSONAL_EXPENSE_CATS.includes(t.category);
                    const catIcon = CAT_ICONS[t.category] || 'circle-dot';
                    const displayDescription = String(t.description || '')
                        .replace(/^Sinal\s+OS\s+(#?\d+)/i, '#$1')
                        .replace(/^Saldo\s+OS\s+(#?\d+)/i, '#$1')
                        .replace(/^OS\s+(#?\d+)/i, '#$1')
                        .replace(/^##/, '#');
                    return (React.createElement("div", { key: t.id, className: "os-card p-3 rounded-xl border border-white/5" },
                        React.createElement("div", { className: "flex items-start gap-3" },
                            React.createElement("div", { className: "w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center mt-0.5", style: { background: t.type === 'entrada' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)' } },
                                React.createElement(BankUiIcon, { name: catIcon, size: 16, color: t.type === 'entrada' ? '#22c55e' : '#ef4444' })),
                            React.createElement("div", { className: "flex-1 min-w-0" },
                                React.createElement("div", { className: "flex flex-wrap items-center gap-1 mb-1" },
                                    React.createElement(TypeBadge, { type: t.type }),
                                    React.createElement(AreaBadge, { area: t.area, size: "xs" }),
                                    React.createElement("span", { className: "text-[8px] px-1.5 py-0.5 rounded-full bg-white/5 text-gray-500 border border-white/10" }, t.category),
                                    isPE && t.area === 'oficina' && (React.createElement("span", { className: "text-[8px] px-1.5 py-0.5 rounded-full font-bold border", style: { color: '#a855f7', background: 'rgba(168,85,247,0.1)', borderColor: 'rgba(168,85,247,0.3)' } }, "PESSOAL")),
                                    t.syncSource === 'office' && (React.createElement("span", { className: "text-[8px] px-1.5 py-0.5 rounded-full font-bold border text-blue-400 bg-blue-500/10 border-blue-500/30" }, "SYNC")),
                                    t.syncSource === 'fixed_bill' && (React.createElement("span", { className: "text-[8px] px-1.5 py-0.5 rounded-full font-bold border text-emerald-400 bg-emerald-500/10 border-emerald-500/30" }, "FIXA"))),
                                React.createElement("p", { className: "text-sm font-semibold text-white truncate" }, displayDescription),
                                React.createElement("p", { className: "text-[10px] text-gray-500 mt-0.5" }, (_a = t.date) === null || _a === void 0 ? void 0 :
                                    _a.split('-').reverse().join('/'),
                                    " ",
                                    t.obs ? `• ${t.obs}` : '')),
                            React.createElement("div", { className: "text-right flex-shrink-0" },
                                React.createElement("p", { className: `font-usarmy text-sm ${t.type === 'entrada' ? 'text-green-400' : 'text-red-400'}` },
                                    t.type === 'saida' ? '-' : '+·',
                                    money(t.value)),
                                React.createElement("div", { className: "flex gap-1 mt-2 justify-end" },
                                    React.createElement("button", { onClick: () => editTransaction(t), className: "btn-icon text-[#d4af37] w-8 h-8", "aria-label": "Editar" },
                                        React.createElement(BankUiIcon, { name: "pencil", size: 14, color: "#d4af37" })),
                                    React.createElement("button", { onClick: () => setConfirmDelete(t.id), className: "btn-icon text-red-500 w-8 h-8", "aria-label": "Excluir" },
                                        React.createElement(BankUiIcon, { name: "trash-2", size: 14, color: "#ef4444" })))))));
                })))),
        tab === 'fixas' && (React.createElement("div", { className: "fixas-tab-fix animate-fadeIn" },
            React.createElement(MonthNav, null),
            React.createElement("div", { className: "os-card p-3 rounded-xl border border-white/5" },
                React.createElement("div", { className: "flex items-center justify-between gap-3" },
                    React.createElement("div", null,
                        React.createElement("p", { className: "font-usarmy text-[#d4af37] text-xs" },
                            "CONTAS FIXAS DE ",
                            monthLabel(selectedMonth).toUpperCase()),
                        React.createElement("p", { className: "text-[9px] text-gray-500 font-mono" }, "Mostra contas antigas recorrentes, novas contas do m\u00EAs e pr\u00F3ximos meses pelo calend\u00E1rio")),
                    React.createElement("div", { className: "text-right" },
                        React.createElement("p", { className: "font-usarmy text-white text-sm" }, money(fixedBillsSelectedSummary.total)),
                        React.createElement("p", { className: "text-[8px] text-gray-500" },
                            "Pendente ",
                            money(fixedBillsSelectedSummary.pending))))),
            billsAlerts.filter(b => b.urgent || b.overdue).length > 0 && (React.createElement("div", { className: "rounded-xl overflow-hidden", style: { border: '1px solid rgba(234,179,8,0.3)' } },
                React.createElement("div", { className: "p-2 flex items-center gap-2", style: { background: 'rgba(234,179,8,0.1)' } },
                    React.createElement(BankUiIcon, { name: "shield-alert", size: 16, color: "#facc15" }),
                    React.createElement("span", { className: "font-usarmy text-yellow-400 text-xs" }, "CONTAS URGENTES")),
                billsAlerts.filter(b => !b.paid && (b.urgent || b.overdue)).map(b => (React.createElement("div", { key: b.id, className: "p-3 border-t border-yellow-500/10 flex items-center justify-between gap-3" },
                    React.createElement("div", null,
                        React.createElement("p", { className: "text-sm font-bold text-white" }, b.name),
                        React.createElement("p", { className: "text-[9px]", style: { color: b.overdue ? '#ef4444' : '#eab308' } }, b.overdue ? `Venceu há ${Math.abs(b.daysUntil)} dias` : b.daysUntil === 0 ? 'Vence HOJE' : `Vence em ${b.daysUntil} dias`)),
                    React.createElement("div", { className: "flex items-center gap-2" },
                        React.createElement("p", { className: "font-usarmy text-yellow-400 text-sm" }, money(b.value)),
                        React.createElement("button", { onClick: () => toggleBillPaid(b), className: "btn-icon w-8 h-8 text-emerald-400", "aria-label": "Marcar como paga", title: "Marcar como paga" },
                            React.createElement(BankUiIcon, { name: "check", size: 14, color: "#22c55e" })))))))),
            !showBillForm && (React.createElement("button", { onClick: () => { setShowBillForm(true); setEditingBillId(null); setBillForm({ name: '', value: '', date: `${selectedMonth}-01`, area: 'pessoal', active: true }); }, className: "gold-gradient w-full p-4 rounded-xl font-usarmy text-xs flex items-center justify-center gap-2" },
                React.createElement(BankUiIcon, { name: "plus", size: 16, color: "#d4af37" }),
                "NOVA CONTA FIXA")),
            showBillForm && (React.createElement("div", { className: "os-card p-4 rounded-xl" },
                React.createElement("p", { className: "font-usarmy text-[#d4af37] text-xs mb-3" }, editingBillId ? 'EDITAR CONTA FIXA' : 'NOVA CONTA FIXA'),
                React.createElement("input", { type: "text", value: billForm.name, placeholder: "Nome da conta (ex: Aluguel, Internet...)", onChange: e => setBillForm(p => ({ ...p, name: e.target.value })), className: "w-full p-3 rounded-xl mb-3 text-sm" }),
                React.createElement("div", { className: "grid grid-cols-2 gap-3 mb-3" },
                    React.createElement("div", null,
                        React.createElement("p", { className: "text-[9px] text-gray-500 font-mono mb-1" }, "DATA"),
                        React.createElement("input", { type: "date", value: billForm.date, onChange: e => setBillForm(p => ({ ...p, date: e.target.value })), className: "w-full p-3 rounded-xl text-sm" })),
                    React.createElement("div", null,
                        React.createElement("p", { className: "text-[9px] text-gray-500 font-mono mb-1" }, "VALOR (R$)"),
                        React.createElement("input", { type: "text", inputMode: "decimal", inputMode: "decimal", step: "0.01", value: billForm.value, placeholder: "0,00", onChange: e => setBillForm(p => ({ ...p, value: e.target.value })), className: "w-full p-3 rounded-xl text-sm" }))),
                React.createElement("div", { className: "mb-3" },
                    React.createElement("p", { className: "text-[9px] text-gray-500 font-mono mb-1" }, "\u00C1REA"),
                    React.createElement("select", { value: billForm.area, onChange: e => setBillForm(p => ({ ...p, area: e.target.value })), className: "w-full p-3 rounded-xl text-sm" },
                        React.createElement("option", { value: "pessoal" }, "Pessoal"),
                        null)),
                React.createElement("div", { className: "grid grid-cols-2 gap-3" },
                    React.createElement("button", { onClick: saveBill, className: "gold-gradient p-3 rounded-xl font-usarmy text-xs" }, editingBillId ? 'ATUALIZAR' : 'SALVAR'),
                    React.createElement("button", { onClick: () => { setEditingBillId(null); setBillForm({ name: '', value: '', date: isoToday(), area: 'pessoal', active: true }); setShowBillForm(false); }, className: "p-3 rounded-xl border border-white/10 text-gray-400 font-usarmy text-xs" }, "CANCELAR")))),
            fixedBills.length > 0 && (React.createElement("div", { className: "os-card p-3 rounded-xl" },
                React.createElement("div", { className: "flex justify-between items-center" },
                    React.createElement("span", { className: "font-usarmy text-xs text-gray-400" }, "TOTAL FIXO DO M\u00CAS"),
                    React.createElement("span", { className: "font-usarmy text-[#d4af37] text-sm" }, money(fixedBillsSelectedSummary.total))),
                React.createElement("div", { className: "grid grid-cols-2 gap-2 mt-2" }, ['pessoal'].map(area => {
                    const m = AREA_META[area];
                    const total = fixedBillsForSelectedMonth.filter(b => (b.area || 'pessoal') === area).reduce((s, b) => s + Number(b.value || 0), 0);
                    return total > 0 ? (React.createElement("div", { key: area, className: "bg-white/5 rounded-lg p-2" },
                        React.createElement("p", { className: "text-[8px] font-mono", style: { color: m.color } }, m.label),
                        React.createElement("p", { className: "font-usarmy text-xs text-white" }, money(total)))) : null;
                })))),
            React.createElement("div", { className: "space-y-2" },
                fixedBillsForSelectedMonth.length === 0 && (React.createElement("div", { className: "os-card p-10 rounded-xl text-center text-gray-600 font-usarmy text-xs" }, "NENHUMA CONTA FIXA NESTE M\u00CAS")),
                fixedBillsForSelectedMonth.map(b => {
                    const meta = AREA_META[b.area || 'oficina'];
                    const status = getBillMonthStatus(b, selectedMonth);
                    const { paid, urgent, overdue, waiting, daysUntil, dueDate, started } = status;
                    const badgeBorder = paid
                        ? 'rgba(34,197,94,0.25)'
                        : overdue
                            ? 'rgba(239,68,68,0.25)'
                            : urgent
                                ? 'rgba(234,179,8,0.25)'
                                : waiting
                                    ? 'rgba(59,130,246,0.2)'
                                    : undefined;
                    return (React.createElement("div", { key: b.id, className: "os-card p-3 rounded-xl", style: { borderColor: badgeBorder } },
                        React.createElement("div", { className: "flex items-start justify-between gap-3" },
                            React.createElement("div", { className: "flex items-start gap-3 flex-1" },
                                React.createElement("div", { className: "w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center relative", style: { background: paid ? 'rgba(34,197,94,0.12)' : meta.bg } },
                                    React.createElement(FixedBillIcon, { icon: getFixedBillIconKey(b.name), color: paid ? '#22c55e' : meta.color, size: 16 }),
                                    React.createElement("span", { className: "absolute -bottom-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-black/85 border border-white/10 flex items-center justify-center font-usarmy text-[8px] leading-none", style: { color: paid ? '#22c55e' : meta.color } }, String(b.day).padStart(2, '0'))),
                                React.createElement("div", null,
                                    React.createElement("p", { className: "text-sm font-bold text-white" }, b.name),
                                    React.createElement("div", { className: "flex items-center gap-2 mt-0.5 flex-wrap" },
                                        React.createElement(AreaBadge, { area: b.area || 'oficina', size: "xs" }),
                                        React.createElement("span", { className: "text-[8px] px-1.5 py-0.5 rounded-full bg-white/5 text-gray-400 border border-white/10" }, dueDate ? `VENC. ${String(dueDate.getDate()).padStart(2, '0')}` : `INÍCIO ${String(b.day).padStart(2, '0')}`),
                                        paid && (React.createElement("span", { className: "text-[8px] font-bold px-1.5 py-0.5 rounded-full border text-emerald-400 bg-emerald-500/10 border-emerald-500/30" }, "PAGA")),
                                        !paid && !started && (React.createElement("span", { className: "text-[8px] font-bold px-1.5 py-0.5 rounded-full border text-blue-400 bg-blue-500/10 border-blue-500/30" }, "AGUARDANDO IN\u00CDCIO")),
                                        !paid && started && waiting && (React.createElement("span", { className: "text-[8px] font-bold px-1.5 py-0.5 rounded-full border text-blue-400 bg-blue-500/10 border-blue-500/30" }, "AGUARDANDO")),
                                        (urgent || overdue) && (React.createElement("span", { className: "text-[8px] font-bold", style: { color: overdue ? '#ef4444' : '#eab308' } }, overdue ? 'VENCIDA' : daysUntil === 0 ? 'HOJE!' : `${daysUntil}d`))))),
                            React.createElement("div", { className: "text-right" },
                                React.createElement("p", { className: "font-usarmy text-[#d4af37] text-sm" }, money(b.value)),
                                React.createElement("div", { className: "flex gap-1 mt-1.5 justify-end" },
                                    React.createElement("button", { onClick: () => toggleBillPaid(b), className: `btn-icon w-8 h-8 ${paid ? 'text-emerald-400' : 'text-gray-400'}`, "aria-label": paid ? 'Desmarcar como paga' : 'Marcar como paga', title: paid ? 'Desmarcar como paga' : 'Marcar como paga' },
                                        React.createElement(BankUiIcon, { name: "check", size: 14, color: paid ? '#22c55e' : '#9ca3af' })),
                                    React.createElement("button", { onClick: () => editBill(b), className: "btn-icon text-[#d4af37] w-8 h-8", "aria-label": "Editar" },
                                        React.createElement(BankUiIcon, { name: "pencil", size: 14, color: "#d4af37" })),
                                    React.createElement("button", { onClick: () => removeFixedBill(b.id), className: "btn-icon text-red-500 w-8 h-8", "aria-label": "Excluir" },
                                        React.createElement(BankUiIcon, { name: "trash-2", size: 14, color: "#ef4444" })))))));
                })))),
        tab === 'cartoes' && (React.createElement("div", { className: "space-y-4 animate-fadeIn" },
            !selectedCard && (React.createElement(React.Fragment, null,
                React.createElement(MonthNav, null),
                React.createElement("div", { className: "os-card p-4 rounded-xl" },
                    React.createElement("div", { className: "flex items-center justify-between gap-3 mb-3" },
                        React.createElement("div", null,
                            React.createElement("p", { className: "font-usarmy text-[#d4af37] text-xs" }, "CART\u00D5ES CADASTRADOS"),
                            React.createElement("p", { className: "text-[9px] text-gray-500 font-mono" }, "Cadastre os cart\u00F5es e toque em um card para abrir o extrato")),
                        React.createElement("div", { className: "text-right" },
                            React.createElement("p", { className: "font-usarmy text-white text-sm" }, cards.length),
                            React.createElement("p", { className: "text-[8px] text-gray-600" }, "cart\u00F5es"))),
                    React.createElement("div", { className: "grid grid-cols-2 gap-2" },
                        React.createElement("div", { className: "bg-white/5 rounded-lg p-3" },
                            React.createElement("p", { className: "text-[8px] text-gray-500 font-mono" }, "FATURAS DO M\u00CAS"),
                            React.createElement("p", { className: "font-usarmy text-red-400 text-sm" }, money(cardEntries.filter(e => getCardInvoiceMonth(e, cards.find(c => c.id === e.cardId)) === selectedMonth).reduce((s, e) => s + Number(e.value || 0), 0)))),
                        React.createElement("div", { className: "bg-white/5 rounded-lg p-3" },
                            React.createElement("p", { className: "text-[8px] text-gray-500 font-mono" }, "OFICINA"),
                            React.createElement("p", { className: "font-usarmy text-[#d4af37] text-sm" }, money(cardEntries.filter(e => e.area === 'oficina' && getCardInvoiceMonth(e, cards.find(c => c.id === e.cardId)) === selectedMonth).reduce((s, e) => s + Number(e.value || 0), 0)))))),
                !showCardForm && (React.createElement("button", { onClick: () => { setShowCardForm(true); setEditingCardId(null); setCardForm(emptyCardForm); }, className: "gold-gradient w-full p-4 rounded-xl font-usarmy text-xs flex items-center justify-center gap-2" },
                    React.createElement(BankUiIcon, { name: "plus", size: 16, color: "#d4af37" }),
                    "NOVO CART\u00C3O")),
                showCardForm && (React.createElement("div", { className: "os-card p-4 rounded-xl" },
                    React.createElement("p", { className: "font-usarmy text-[#d4af37] text-xs mb-3" }, editingCardId ? 'EDITAR CARTÃO' : 'NOVO CARTÃO'),
                    React.createElement("input", { type: "text", value: cardForm.name, placeholder: "Nome do cart\u00E3o", onChange: e => setCardForm(p => ({ ...p, name: e.target.value })), className: "w-full p-3 rounded-xl mb-3 text-sm" }),
                    React.createElement("div", { className: "grid grid-cols-2 gap-3 mb-3" },
                        React.createElement("input", { type: "text", value: cardForm.brand, placeholder: "Bandeira / banco", onChange: e => setCardForm(p => ({ ...p, brand: e.target.value })), className: "w-full p-3 rounded-xl text-sm" }),
                        React.createElement("input", { type: "text", value: cardForm.final, placeholder: "Final 4 d\u00EDgitos", onChange: e => setCardForm(p => ({ ...p, final: e.target.value.replace(/\D/g, '').slice(-4) })), className: "w-full p-3 rounded-xl text-sm" })),
                    React.createElement("div", { className: "grid grid-cols-2 gap-3 mb-3" },
                        React.createElement("div", null,
                            React.createElement("p", { className: "text-[9px] text-gray-500 font-mono mb-1" }, "LIMITE (opcional)"),
                            React.createElement("input", { type: "text", inputMode: "decimal", inputMode: "decimal", step: "0.01", value: cardForm.limit, placeholder: "0,00", onChange: e => setCardForm(p => ({ ...p, limit: e.target.value })), className: "w-full p-3 rounded-xl text-sm" })),
                        React.createElement("div", null,
                            React.createElement("p", { className: "text-[9px] text-gray-500 font-mono mb-1" }, "VENCIMENTO"),
                            React.createElement("input", { type: "text", inputMode: "decimal", min: "1", max: "31", value: cardForm.dueDay, placeholder: "Dia", onChange: e => setCardForm(p => ({ ...p, dueDay: e.target.value.replace(/\D/g, '').slice(0, 2) })), className: "w-full p-3 rounded-xl text-sm" }))),
                    React.createElement("div", { className: "grid grid-cols-2 gap-3 mb-4" },
                        React.createElement("div", null,
                            React.createElement("p", { className: "text-[9px] text-gray-500 font-mono mb-1" }, "FECHAMENTO"),
                            React.createElement("input", { type: "text", inputMode: "decimal", min: "1", max: "31", value: cardForm.closingDay, placeholder: "Dia", onChange: e => setCardForm(p => ({ ...p, closingDay: e.target.value.replace(/\D/g, '').slice(0, 2) })), className: "w-full p-3 rounded-xl text-sm" })),
                        React.createElement("div", null,
                            React.createElement("p", { className: "text-[9px] text-gray-500 font-mono mb-1" }, "MELHOR DIA DE COMPRA"),
                            React.createElement("input", { type: "text", inputMode: "decimal", min: "1", max: "31", value: cardForm.bestPurchaseDay, placeholder: "Dia", onChange: e => setCardForm(p => ({ ...p, bestPurchaseDay: e.target.value.replace(/\D/g, '').slice(0, 2) })), className: "w-full p-3 rounded-xl text-sm" }))),
                    React.createElement("div", { className: "grid grid-cols-2 gap-3" },
                        React.createElement("button", { onClick: saveCard, className: "gold-gradient p-3 rounded-xl font-usarmy text-xs" }, editingCardId ? 'ATUALIZAR' : 'SALVAR'),
                        React.createElement("button", { onClick: () => { setEditingCardId(null); setCardForm(emptyCardForm); setShowCardForm(false); }, className: "p-3 rounded-xl border border-white/10 text-gray-400 font-usarmy text-xs" }, "CANCELAR")))),
                React.createElement("div", { className: "space-y-2" },
                    cards.length === 0 && (React.createElement("div", { className: "os-card p-10 rounded-xl text-center text-gray-600 font-usarmy text-xs" }, "NENHUM CART\u00C3O CADASTRADO")),
                    cards.map(card => {
                        const monthEntries = cardEntries.filter(entry => entry.cardId === card.id && getCardInvoiceMonth(entry, card) === selectedMonth);
                        const cardTotal = monthEntries.reduce((s, entry) => s + Number(entry.value || 0), 0);
                        const cardCount = monthEntries.length;
                        return (React.createElement("div", { key: card.id, className: "os-card p-3 rounded-xl border border-white/5" },
                            React.createElement("div", { className: "flex items-start justify-between gap-3" },
                                React.createElement("button", { onClick: () => { setSelectedCardId(card.id); setShowCardEntryForm(false); setEditingCardEntryId(null); setCardEntryForm(emptyCardEntryForm); }, className: "flex-1 text-left flex items-start gap-3" },
                                    React.createElement("div", { className: "w-10 h-10 rounded-xl flex items-center justify-center", style: { background: 'rgba(212,175,55,0.12)' } },
                                        React.createElement(BankUiIcon, { name: "credit-card", size: 16, color: "#d4af37" })),
                                    React.createElement("div", { className: "min-w-0" },
                                        React.createElement("p", { className: "text-sm font-bold text-white truncate" }, card.name),
                                        React.createElement("div", { className: "flex flex-wrap items-center gap-1 mt-1" },
                                            card.brand && React.createElement("span", { className: "text-[8px] px-1.5 py-0.5 rounded-full bg-white/5 text-gray-400 border border-white/10" }, card.brand),
                                            card.final && React.createElement("span", { className: "text-[8px] px-1.5 py-0.5 rounded-full bg-white/5 text-gray-400 border border-white/10" },
                                                "FINAL ",
                                                card.final),
                                            React.createElement("span", { className: "text-[8px] px-1.5 py-0.5 rounded-full bg-white/5 text-gray-500 border border-white/10" },
                                                cardCount,
                                                " fat. m\u00EAs")),
                                        card.limit ? React.createElement("p", { className: "text-[10px] text-gray-500 mt-1" },
                                            "Limite: ",
                                            money(card.limit)) : null,
                                        card.dueDay ? React.createElement("p", { className: "text-[10px] text-gray-500 mt-1" },
                                            "Vencimento: dia ",
                                            String(card.dueDay).padStart(2, '0')) : null,
                                        card.closingDay ? React.createElement("p", { className: "text-[10px] text-gray-500 mt-1" },
                                            "Fechamento: dia ",
                                            String(card.closingDay).padStart(2, '0')) : null,
                                        card.bestPurchaseDay ? React.createElement("p", { className: "text-[10px] text-gray-500 mt-1" },
                                            "Melhor compra: dia ",
                                            String(card.bestPurchaseDay).padStart(2, '0')) : null)),
                                React.createElement("div", { className: "text-right flex-shrink-0" },
                                    React.createElement("p", { className: "font-usarmy text-red-400 text-sm" }, money(cardTotal)),
                                    React.createElement("div", { className: "flex gap-1 mt-2 justify-end" },
                                        React.createElement("button", { onClick: () => editCard(card), className: "btn-icon text-[#d4af37] w-8 h-8", "aria-label": "Editar cart\u00E3o" },
                                            React.createElement(BankUiIcon, { name: "pencil", size: 14, color: "#d4af37" })),
                                        React.createElement("button", { onClick: () => setConfirmDeleteCard(card.id), className: "btn-icon text-red-500 w-8 h-8", "aria-label": "Excluir cart\u00E3o" },
                                            React.createElement(BankUiIcon, { name: "trash-2", size: 14, color: "#ef4444" })))))));
                    })))),
            selectedCard && (React.createElement(React.Fragment, null,
                React.createElement(MonthNav, null),
                React.createElement("div", { className: "flex items-center justify-between gap-3" },
                    React.createElement("button", { onClick: () => { setSelectedCardId(null); setEditingCardEntryId(null); setShowCardEntryForm(false); setCardEntryForm(emptyCardEntryForm); }, className: "btn-icon text-gray-400", "aria-label": "Voltar aos cart\u00F5es" },
                        React.createElement(BankUiIcon, { name: "arrow-left", size: 20, color: "#9ca3af" })),
                    React.createElement("div", { className: "flex-1 min-w-0 text-center" },
                        React.createElement("p", { className: "font-usarmy text-[#d4af37] text-sm truncate" }, selectedCard.name),
                        React.createElement("p", { className: "text-[9px] text-gray-500 font-mono" }, "EXTRATO DO CART\u00C3O")),
                    React.createElement("button", { onClick: () => {
                            if (showCardEntryForm) {
                                setEditingCardEntryId(null);
                                setCardEntryForm(emptyCardEntryForm);
                                setShowCardEntryForm(false);
                            }
                            else {
                                setEditingCardEntryId(null);
                                setCardEntryForm(prev => ({ ...emptyCardEntryForm, area: prev.area || 'pessoal', category: getCats(prev.area || 'pessoal', 'saida')[0], date: `${selectedMonth}-01` }));
                                setShowCardEntryForm(true);
                            }
                        }, className: "btn-icon text-[#d4af37]", "aria-label": "Novo lan\u00E7amento do cart\u00E3o" },
                        React.createElement(BankUiIcon, { name: "plus-circle", size: 20, color: "#d4af37" }))),
                React.createElement("div", { className: "grid grid-cols-3 gap-2" },
                    React.createElement("div", { className: "os-card p-3 rounded-xl text-center" },
                        React.createElement("p", { className: "text-[8px] text-gray-500 font-mono" },
                            "FATURA ",
                            selectedMonth.split('-').reverse().join('/')),
                        React.createElement("p", { className: "font-usarmy text-red-400 text-sm" }, money(selectedCardSummary.total))),
                    React.createElement("div", { className: "os-card p-3 rounded-xl text-center" },
                        React.createElement("p", { className: "text-[8px] text-gray-500 font-mono" }, "PESSOAL"),
                        React.createElement("p", { className: "font-usarmy text-indigo-300 text-sm" }, money(selectedCardSummary.pessoal))),
                    React.createElement("div", { className: "os-card p-3 rounded-xl text-center" },
                        React.createElement("p", { className: "text-[8px] text-gray-500 font-mono" }, "OFICINA"),
                        React.createElement("p", { className: "font-usarmy text-[#d4af37] text-sm" }, money(selectedCardSummary.oficina)))),
                (selectedCard.brand || selectedCard.final || selectedCard.limit || selectedCard.dueDay || selectedCard.closingDay || selectedCard.bestPurchaseDay) && (React.createElement("div", { className: "os-card p-3 rounded-xl" },
                    React.createElement("div", { className: "flex flex-wrap items-center gap-2" },
                        selectedCard.brand && React.createElement("span", { className: "text-[8px] px-2 py-1 rounded-full bg-white/5 text-gray-400 border border-white/10" }, selectedCard.brand),
                        selectedCard.final && React.createElement("span", { className: "text-[8px] px-2 py-1 rounded-full bg-white/5 text-gray-400 border border-white/10" },
                            "FINAL ",
                            selectedCard.final),
                        selectedCard.limit && React.createElement("span", { className: "text-[8px] px-2 py-1 rounded-full bg-white/5 text-gray-400 border border-white/10" },
                            "LIMITE ",
                            money(selectedCard.limit)),
                        selectedCard.dueDay && React.createElement("span", { className: "text-[8px] px-2 py-1 rounded-full bg-white/5 text-gray-400 border border-white/10" },
                            "VENCE DIA ",
                            String(selectedCard.dueDay).padStart(2, '0')),
                        selectedCard.closingDay && React.createElement("span", { className: "text-[8px] px-2 py-1 rounded-full bg-white/5 text-gray-400 border border-white/10" },
                            "FECHA DIA ",
                            String(selectedCard.closingDay).padStart(2, '0')),
                        getCardBestPurchaseDay(selectedCard) && React.createElement("span", { className: "text-[8px] px-2 py-1 rounded-full bg-white/5 text-gray-400 border border-white/10" },
                            "MELHOR COMPRA DIA ",
                            String(getCardBestPurchaseDay(selectedCard)).padStart(2, '0'))))),
                showCardEntryForm && (React.createElement("div", { className: "os-card p-4 rounded-xl" },
                    React.createElement("p", { className: "font-usarmy text-[#d4af37] text-xs mb-2" }, editingCardEntryId ? 'EDITAR GASTO DO CARTÃO' : 'NOVO GASTO NO CARTÃO'),
                    React.createElement("p", { className: "text-[9px] text-gray-500 font-mono mb-4" },
                        (selectedCard === null || selectedCard === void 0 ? void 0 : selectedCard.closingDay) ? `Fechamento dia ${String(selectedCard.closingDay).padStart(2, '0')}` : 'Fechamento não informado',
                        " ",
                        (selectedCard === null || selectedCard === void 0 ? void 0 : selectedCard.dueDay) ? `• vencimento dia ${String(selectedCard.dueDay).padStart(2, '0')}` : '',
                        " ",
                        getCardBestPurchaseDay(selectedCard) ? `• melhor compra dia ${String(getCardBestPurchaseDay(selectedCard)).padStart(2, '0')}` : ''),
                    React.createElement("p", { className: "text-[9px] text-gray-500 font-mono mb-2" }, "\u00C1REA"),
                    React.createElement("div", { className: "grid grid-cols-2 gap-2 mb-4" }, ['pessoal'].map(area => {
                        const meta = AREA_META[area];
                        const active = cardEntryForm.area === area;
                        return (React.createElement("button", { key: area, onClick: () => handleCardAreaChange(area), className: "p-3 rounded-xl flex items-center gap-2 transition-all", style: { background: active ? meta.bg : 'rgba(255,255,255,0.04)', border: `1.5px solid ${active ? meta.color : 'rgba(255,255,255,0.08)'}`, color: active ? meta.color : '#6b7280' } },
                            React.createElement(BankUiIcon, { name: meta.icon, size: 16, color: active ? meta.color : "#6b7280" }),
                            React.createElement("span", { className: "font-usarmy text-[10px]" }, meta.label)));
                    })),
                    React.createElement("p", { className: "text-[9px] text-gray-500 font-mono mb-2" }, "CATEGORIA DO GASTO"),
                    React.createElement("select", { value: cardEntryForm.category, onChange: e => setCardEntryForm(prev => ({ ...prev, category: e.target.value })), className: "w-full p-3 rounded-xl mb-4 text-sm" }, getCats(cardEntryForm.area, 'saida').map(cat => React.createElement("option", { key: cat, value: cat }, cat))),
                    React.createElement("div", { className: "grid grid-cols-2 gap-3 mb-3" },
                        React.createElement("div", null,
                            React.createElement("p", { className: "text-[9px] text-gray-500 font-mono mb-1" }, "DATA DA COMPRA"),
                            React.createElement("input", { type: "date", value: cardEntryForm.date, onChange: e => setCardEntryForm(prev => ({ ...prev, date: e.target.value })), className: "w-full p-3 rounded-xl text-sm" })),
                        React.createElement("div", null,
                            React.createElement("p", { className: "text-[9px] text-gray-500 font-mono mb-1" }, "VALOR TOTAL (R$)"),
                            React.createElement("input", { type: "text", inputMode: "decimal", inputMode: "decimal", step: "0.01", min: "0", value: cardEntryForm.totalValue, onChange: e => setCardEntryForm(prev => ({ ...prev, totalValue: e.target.value })), className: "w-full p-3 rounded-xl text-sm" }))),
                    React.createElement("p", { className: "text-[9px] text-gray-500 font-mono mb-1" }, "DESCRI\u00C7\u00C3O"),
                    React.createElement("input", { type: "text", value: cardEntryForm.description, placeholder: "Ex: Compra de pe\u00E7a, mercado...", onChange: e => setCardEntryForm(prev => ({ ...prev, description: e.target.value })), className: "w-full p-3 rounded-xl mb-3 text-sm" }),
                    React.createElement("div", { className: "rounded-xl p-3 mb-3", style: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' } },
                        React.createElement("div", { className: "flex items-center justify-between gap-3" },
                            React.createElement("div", null,
                                React.createElement("p", { className: "text-[9px] text-gray-500 font-mono" }, "PAGAMENTO PARCELADO"),
                                React.createElement("p", { className: "text-[10px] text-gray-500 mt-1" }, "Se ativado, o sistema lan\u00E7a cada parcela na fatura conforme o fechamento do cart\u00E3o.")),
                            React.createElement("button", { onClick: () => setCardEntryForm(prev => ({ ...prev, isInstallment: !prev.isInstallment, installmentCount: !prev.isInstallment ? (prev.installmentCount || '2') : '2' })), className: "px-3 py-2 rounded-xl font-usarmy text-[10px] border", style: {
                                    color: cardEntryForm.isInstallment ? '#d4af37' : '#9ca3af',
                                    borderColor: cardEntryForm.isInstallment ? 'rgba(212,175,55,0.35)' : 'rgba(255,255,255,0.1)',
                                    background: cardEntryForm.isInstallment ? 'rgba(212,175,55,0.08)' : 'rgba(255,255,255,0.03)'
                                } }, cardEntryForm.isInstallment ? 'SIM' : 'NÃO')),
                        cardEntryForm.isInstallment && (React.createElement("div", { className: "mt-3 grid grid-cols-2 gap-3" },
                            React.createElement("div", null,
                                React.createElement("p", { className: "text-[9px] text-gray-500 font-mono mb-1" }, "QUANTIDADE DE PARCELAS"),
                                React.createElement("input", { type: "text", inputMode: "decimal", min: "2", max: "48", value: cardEntryForm.installmentCount, onChange: e => setCardEntryForm(prev => ({ ...prev, installmentCount: e.target.value.replace(/\D/g, '').slice(0, 2) })), className: "w-full p-3 rounded-xl text-sm" })),
                            React.createElement("div", { className: "rounded-xl p-3 flex flex-col justify-center", style: { background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.12)' } },
                                React.createElement("p", { className: "text-[9px] text-gray-500 font-mono" }, "VALOR ESTIMADO POR PARCELA"),
                                React.createElement("p", { className: "font-usarmy text-[#d4af37] text-sm mt-1" }, money(Number(cardEntryForm.totalValue || 0) / Math.max(parseInt(cardEntryForm.installmentCount || 1, 10) || 1, 1))))))),
                    React.createElement("div", { className: "os-card p-3 rounded-xl mb-4", style: { border: '1px solid rgba(255,255,255,0.08)' } },
                        React.createElement("div", { className: "flex items-center justify-between gap-3" },
                            React.createElement("div", null,
                                React.createElement("p", { className: "font-usarmy text-white text-xs" }, "COMPRA RECORRENTE MENSAL"),
                                React.createElement("p", { className: "text-[9px] text-gray-500 mt-1" }, "Streaming, assinatura ou cobran\u00E7a mensal at\u00E9 cancelar.")),
                            React.createElement("button", { type: "button", onClick: () => setCardEntryForm(prev => ({ ...prev, isRecurring: !prev.isRecurring, isInstallment: false })), className: "px-3 py-2 rounded-xl border font-usarmy text-[10px]", style: {
                                    color: cardEntryForm.isRecurring ? '#d4af37' : '#9ca3af',
                                    borderColor: cardEntryForm.isRecurring ? 'rgba(212,175,55,0.35)' : 'rgba(255,255,255,0.1)',
                                    background: cardEntryForm.isRecurring ? 'rgba(212,175,55,0.08)' : 'rgba(255,255,255,0.03)'
                                } }, cardEntryForm.isRecurring ? 'ATIVA' : 'NÃO')),
                        cardEntryForm.isRecurring && (React.createElement("div", { className: "grid grid-cols-2 gap-3 mt-3" },
                            React.createElement("div", null,
                                React.createElement("p", { className: "text-[9px] text-gray-500 font-mono mb-1" }, "GERAR POR MESES"),
                                React.createElement("input", { type: "text", inputMode: "decimal", min: "1", max: "120", value: cardEntryForm.recurrenceMonths, onChange: e => setCardEntryForm(prev => ({ ...prev, recurrenceMonths: e.target.value.replace(/\D/g, '').slice(0, 3) })), className: "w-full p-3 rounded-xl text-sm" })),
                            React.createElement("div", { className: "rounded-xl p-3 flex flex-col justify-center", style: { background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.12)' } },
                                React.createElement("p", { className: "text-[9px] text-gray-500 font-mono" }, "VALOR MENSAL"),
                                React.createElement("p", { className: "font-usarmy text-[#d4af37] text-sm mt-1" }, money(Number(cardEntryForm.totalValue || 0))))))),
                    React.createElement("p", { className: "text-[9px] text-gray-500 font-mono mb-1" }, "OBSERVA\u00C7\u00C3O (opcional)"),
                    React.createElement("input", { type: "text", value: cardEntryForm.obs, placeholder: "Detalhes extras...", onChange: e => setCardEntryForm(prev => ({ ...prev, obs: e.target.value })), className: "w-full p-3 rounded-xl mb-4 text-sm" }),
                    React.createElement("div", { className: "grid grid-cols-2 gap-3" },
                        React.createElement("button", { onClick: saveCardEntry, className: "gold-gradient p-4 rounded-xl font-usarmy text-xs" }, editingCardEntryId ? 'ATUALIZAR' : 'SALVAR GASTO'),
                        React.createElement("button", { onClick: () => { setEditingCardEntryId(null); setCardEntryForm(emptyCardEntryForm); setShowCardEntryForm(false); }, className: "p-4 rounded-xl border border-white/10 text-gray-400 font-usarmy text-xs" }, "CANCELAR")))),
                React.createElement("div", { className: "space-y-2" },
                    selectedCardEntriesGrouped.length === 0 && (React.createElement("div", { className: "os-card p-10 rounded-xl text-center text-gray-600 font-usarmy text-xs" }, "SEM LAN\u00C7AMENTOS NESTE CART\u00C3O")),
                    selectedCardEntriesGrouped.map(group => (React.createElement("div", { key: group.month, className: "space-y-2" },
                        React.createElement("div", { className: "os-card p-3 rounded-xl", style: { border: '1px solid rgba(212,175,55,0.15)' } },
                            React.createElement("div", { className: "flex items-center justify-between gap-3" },
                                React.createElement("div", null,
                                    React.createElement("p", { className: "font-usarmy text-[#d4af37] text-xs" }, monthLabel(group.month).toUpperCase()),
                                    React.createElement("p", { className: "text-[9px] text-gray-500 font-mono" }, group.dueDate ? `Fatura vence em ${group.dueDate.toLocaleDateString('pt-BR')}` : 'Sem vencimento definido')),
                                React.createElement("div", { className: "text-right" },
                                    React.createElement("p", { className: "font-usarmy text-white text-sm" }, money(group.summary.total)),
                                    React.createElement("p", { className: "text-[8px] text-gray-500" },
                                        "Pessoal ",
                                        money(group.summary.pessoal),
                                        " \u2022 Oficina ",
                                        money(group.summary.oficina))))),
                        group.entries.map(entry => {
                            var _a;
                            return (React.createElement("div", { key: entry.id, className: "os-card p-3 rounded-xl border border-white/5" },
                                React.createElement("div", { className: "flex items-start gap-3" },
                                    React.createElement("div", { className: "w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center mt-0.5", style: { background: 'rgba(239,68,68,0.12)' } },
                                        React.createElement(BankUiIcon, { name: CAT_ICONS[entry.category] || 'credit-card', size: 16, color: "#f87171" })),
                                    React.createElement("div", { className: "flex-1 min-w-0" },
                                        React.createElement("div", { className: "flex flex-wrap items-center gap-1 mb-1" },
                                            React.createElement(AreaBadge, { area: entry.area, size: "xs" }),
                                            React.createElement("span", { className: "text-[8px] px-1.5 py-0.5 rounded-full bg-white/5 text-gray-500 border border-white/10" }, entry.category),
                                            entry.isInstallment && React.createElement("span", { className: "text-[8px] px-1.5 py-0.5 rounded-full bg-[#d4af37]/10 text-[#d4af37] border border-[#d4af37]/20" },
                                                entry.installmentIndex,
                                                "/",
                                                entry.installmentCount),
                                            entry.isRecurring && React.createElement("span", { className: "text-[8px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/20" }, "RECORRENTE")),
                                        React.createElement("p", { className: "text-sm font-semibold text-white truncate" }, entry.description),
                                        React.createElement("p", { className: "text-[10px] text-gray-500 mt-0.5" }, (_a = entry.date) === null || _a === void 0 ? void 0 :
                                            _a.split('-').reverse().join('/'),
                                            entry.isInstallment ? ` • Parcela ${entry.installmentIndex}/${entry.installmentCount}` : '',
                                            entry.isRecurring ? ` • Recorrente mensal` : '',
                                            entry.purchaseDate && entry.purchaseDate !== entry.date ? ` • Início ${entry.purchaseDate.split('-').reverse().join('/')}` : '',
                                            entry.obs ? ` • ${entry.obs}` : '')),
                                    React.createElement("div", { className: "text-right flex-shrink-0" },
                                        React.createElement("p", { className: "font-usarmy text-sm text-red-400" },
                                            "-",
                                            money(entry.value)),
                                        entry.isInstallment && React.createElement("p", { className: "text-[9px] text-gray-500 mt-1" },
                                            "de ",
                                            money(entry.totalPurchaseValue || entry.value)),
                                        React.createElement("div", { className: "flex gap-1 mt-2 justify-end" },
                                            React.createElement("button", { onClick: () => editCardEntry(entry), className: "btn-icon text-[#d4af37] w-8 h-8", "aria-label": "Editar gasto do cart\u00E3o" },
                                                React.createElement(BankUiIcon, { name: "pencil", size: 14, color: "#d4af37" })),
                                            React.createElement("button", { onClick: () => setConfirmDeleteCardEntry(entry.id), className: "btn-icon text-red-500 w-8 h-8", "aria-label": "Excluir gasto do cart\u00E3o" },
                                                React.createElement(BankUiIcon, { name: "trash-2", size: 14, color: "#ef4444" })))))));
                        }))))))))),
        tab === 'fechamento' && (React.createElement("div", { className: "space-y-4 animate-fadeIn" },
            React.createElement(MonthNav, null),
            React.createElement("div", { className: "grid grid-cols-1 gap-3" }, [
                ['FECHAMENTO DO DIA', periodStats.today],
                ['FECHAMENTO DA SEMANA', periodStats.week],
                ['FECHAMENTO DO MÊS', periodStats.month]
            ].map(([title, stats]) => (React.createElement("div", { key: title, className: "os-card p-4 rounded-xl" },
                React.createElement("div", { className: "flex items-center justify-between mb-3" },
                    React.createElement("p", { className: "font-usarmy text-[#d4af37] text-xs" }, title),
                    React.createElement("span", { className: `text-xs font-usarmy ${stats.geral >= 0 ? 'text-green-400' : 'text-red-400'}` }, money(stats.geral))),
                React.createElement("div", { className: "grid grid-cols-2 gap-3" },
                    React.createElement("div", { className: "rounded-xl p-3", style: { background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.16)' } },
                        React.createElement("p", { className: "text-[8px] font-usarmy mb-2", style: { color: '#818cf8' } }, "PESSOAL"),
                        React.createElement("div", { className: "space-y-1 text-[10px]" },
                            React.createElement("div", { className: "flex justify-between text-gray-400" },
                                React.createElement("span", null, "Entradas"),
                                React.createElement("span", { className: "text-green-400" }, money(stats.pessoal.entrada))),
                            React.createElement("div", { className: "flex justify-between text-gray-400" },
                                React.createElement("span", null, "Sa\u00EDdas"),
                                React.createElement("span", { className: "text-red-400" }, money(stats.pessoal.saida))),
                            React.createElement("div", { className: "flex justify-between text-white pt-1 border-t border-white/10" },
                                React.createElement("span", null, "Saldo"),
                                React.createElement("span", null, money(stats.pessoal.saldo))))),
                    
           React.createElement("div", { className: "rounded-xl p-3", style: { background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.16)' } },
    React.createElement("p", { className: "text-[8px] font-usarmy mb-2", style: { color: '#d4af37' } }, "OFICINA"),
                        React.createElement("div", { className: "space-y-1 text-[10px]" },
                            React.createElement("div", { className: "flex justify-between text-gray-400" },
                                React.createElement("span", null, "Entradas"),
                                React.createElement("span", { className: "text-green-400" }, money(stats.oficina.entrada))),
                            React.createElement("div", { className: "flex justify-between text-gray-400" },
                                React.createElement("span", null, "Sa\u00EDdas"),
                                React.createElement("span", { className: "text-red-400" }, money(stats.oficina.saida))),
                            React.createElement("div", { className: "flex justify-between text-white pt-1 border-t border-white/10" },
                                React.createElement("span", null, "Saldo"),
                                React.createElement("span", null, money(stats.oficina.saldo))),
                            React.createElement("div", { className: "flex justify-between text-gray-400" },
                                React.createElement("span", null, "Pessoal na oficina"),
                                React.createElement("span", { style: { color: '#a855f7' } }, money(stats.oficina.pessoalNaOficina)))))))))),
                    React.createElement("div", { className: "rounded-xl p-4", style: { background: tacticalPressure.bg, border: `1px solid ${tacticalPressure.border}` } },


               React.createElement("p", { className: "text-[9px] font-usarmy", style: { color: tacticalPressure.color } }, "AN\u00C1LISE AUTOM\u00C1TICA V14"),
                React.createElement("p", { className: "text-sm font-bold text-white mt-1" }, tacticalPressure.label),
                React.createElement("p", { className: "text-[10px] text-gray-500 mt-2" }, tacticalPressure.hint)))),
        tab === 'relatorios' && (React.createElement("div", { className: "space-y-4 animate-fadeIn" },
            React.createElement(MonthNav, null),
            React.createElement("div", { className: "os-card p-4 rounded-xl" },
                React.createElement("p", { className: "font-usarmy text-[#d4af37] text-xs mb-3" },
                    "DEMONSTRATIVO \u2014 ",
                    monthLabel(selectedMonth).toUpperCase()),
                React.createElement("div", { className: "space-y-2 text-sm" }, [
                    ['Receita', monthlySummary.p.i, 'text-green-400'],
                    ['Despesa', monthlySummary.p.e, 'text-red-400', true],
                    ['= Resultado', monthlySummary.pSaved, monthlySummary.pSaved >= 0 ? 'text-[#818cf8]' : 'text-red-400', false, true],
              ].map(([label, val, cls, neg, highlight], i) => (React.createElement("div", { key: i, className: `flex justify-between items-center px-3 py-2 rounded-lg ${highlight ? 'bg-white/5 border border-white/10' : ''}` },
                    React.createElement("span", { className: highlight ? 'text-white font-semibold' : 'text-gray-400' }, label),
                    React.createElement("span", { className: `font-usarmy ${cls}` },
                        neg ? '-' : '',
                        money(val))))))),
            Object.keys(monthlySummary.catExpP).length > 0 && (React.createElement("div", { className: "os-card p-4 rounded-xl" },
                React.createElement("p", { className: "font-usarmy text-xs mb-3", style: { color: '#818cf8' } }, "DESPESAS PESSOAIS POR CATEGORIA"),
                React.createElement("div", { className: "space-y-2" }, Object.entries(monthlySummary.catExpP).sort((a, b) => b[1] - a[1]).map(([cat, val]) => (React.createElement("div", { key: cat },
                    React.createElement("div", { className: "flex justify-between text-xs mb-1" },
                        React.createElement("span", { className: "text-gray-400" }, cat),
                        React.createElement("span", { className: "font-usarmy text-white" }, money(val))),
                    React.createElement(ProgressBar, { value: val, total: monthlySummary.p.e, color: "#6366f1", height: 4 }))))))),
            Object.keys(monthlySummary.catExpW).length > 0 && (React.createElement("div", { className: "os-card p-4 rounded-xl" },
                React.createElement("p", { className: "font-usarmy text-xs mb-3", style: { color: '#d4af37' } }, "DESPESAS DA OFICINA POR CATEGORIA"),
                React.createElement("div", { className: "space-y-2" }, Object.entries(monthlySummary.catExpW).sort((a, b) => b[1] - a[1]).map(([cat, val]) => {
                    const isPE = PERSONAL_EXPENSE_CATS.includes(cat);
                    return (React.createElement("div", { key: cat },
                        React.createElement("div", { className: "flex justify-between text-xs mb-1" },
                            React.createElement("span", { className: "flex items-center gap-1.5 text-gray-400" },
                                cat,
                                isPE && React.createElement("span", { className: "text-[8px] px-1 rounded", style: { color: '#a855f7', background: 'rgba(168,85,247,0.1)' } }, "PESSOAL")),
                            React.createElement("span", { className: "font-usarmy text-white" }, money(val))),
                        React.createElement(ProgressBar, { value: val, total: monthlySummary.w.e, color: isPE ? '#a855f7' : '#d4af37', height: 4 })));
                })))),
            React.createElement("div", { className: "os-card p-4 rounded-xl" },
                React.createElement("p", { className: "font-usarmy text-[#d4af37] text-xs mb-3" }, "ATALHOS"),
                React.createElement("div", { className: "grid grid-cols-1 gap-2" },
                    React.createElement("button", { onClick: generateFinancialReportPDF, className: "p-3 rounded-xl border border-white/10 text-gray-300 font-usarmy text-xs flex items-center gap-2 justify-center" },
                        React.createElement(BankUiIcon, { name: "file-down", size: 16, color: "#d4af37" }),
                        " GERAR PDF DO RELAT\u00D3RIO"),
                    React.createElement("button", { onClick: () => setTab('lancamentos'), className: "p-3 rounded-xl border border-white/10 text-gray-300 font-usarmy text-xs flex items-center gap-2 justify-center" },
                        React.createElement("i", { "data-lucide": "plus-circle", className: "w-4 h-4" }),
                        " NOVO LAN\u00C7AMENTO"))))),
                    
                        
        confirmDeleteCard && (React.createElement("div", { className: "modal-overlay", onClick: () => setConfirmDeleteCard(null) },
            React.createElement("div", { className: "modal-content p-6", onClick: e => e.stopPropagation() },
                React.createElement("p", { className: "font-usarmy text-[#d4af37] text-sm mb-2" }, "EXCLUIR CART\u00C3O"),
                React.createElement("p", { className: "text-gray-400 text-sm mb-6" }, "O cart\u00E3o e todos os lan\u00E7amentos dele ser\u00E3o removidos."),
                React.createElement("div", { className: "grid grid-cols-2 gap-3" },
                    React.createElement("button", { onClick: () => setConfirmDeleteCard(null), className: "p-3 rounded-xl border border-white/10 text-gray-400 font-usarmy text-xs" }, "CANCELAR"),
                    React.createElement("button", { onClick: () => removeCard(confirmDeleteCard), className: "p-3 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 font-usarmy text-xs" }, "EXCLUIR"))))),
        confirmDeleteCardEntry && (React.createElement("div", { className: "modal-overlay", onClick: () => setConfirmDeleteCardEntry(null) },
            React.createElement("div", { className: "modal-content p-6", onClick: e => e.stopPropagation() },
                React.createElement("p", { className: "font-usarmy text-[#d4af37] text-sm mb-2" }, "EXCLUIR LAN\u00C7AMENTO DO CART\u00C3O"),
                React.createElement("p", { className: "text-gray-400 text-sm mb-6" }, "Tem certeza? Esta a\u00E7\u00E3o n\u00E3o pode ser desfeita."),
                React.createElement("div", { className: "grid grid-cols-2 gap-3" },
                    React.createElement("button", { onClick: () => setConfirmDeleteCardEntry(null), className: "p-3 rounded-xl border border-white/10 text-gray-400 font-usarmy text-xs" }, "CANCELAR"),
                    React.createElement("button", { onClick: () => removeCardEntry(confirmDeleteCardEntry), className: "p-3 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 font-usarmy text-xs" }, "EXCLUIR"))))),
        confirmDelete && (React.createElement("div", { className: "modal-overlay", onClick: () => setConfirmDelete(null) },
            React.createElement("div", { className: "modal-content p-6", onClick: e => e.stopPropagation() },
                React.createElement("p", { className: "font-usarmy text-[#d4af37] text-sm mb-2" }, "EXCLUIR LAN\u00C7AMENTO"),
                React.createElement("p", { className: "text-gray-400 text-sm mb-6" }, "Tem certeza? Esta a\u00E7\u00E3o n\u00E3o pode ser desfeita."),
                React.createElement("div", { className: "grid grid-cols-2 gap-3" },
                    React.createElement("button", { onClick: () => setConfirmDelete(null), className: "p-3 rounded-xl border border-white/10 text-gray-400 font-usarmy text-xs" }, "CANCELAR"),
                    React.createElement("button", { onClick: () => removeTransaction(confirmDelete), className: "p-3 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 font-usarmy text-xs" }, "EXCLUIR")))))));
};
const App = () => {
    return (React.createElement("div", { className: "min-h-screen pb-24 bg-[#050505]" },
        React.createElement("main", { role: "main", className: "p-4 max-w-lg mx-auto" },
            React.createElement(MyBankIntegrated, { orders: [], onBack: () => { }, onOpenOrder: () => { } }))));
};
SafeStorage.ready.finally(() => {
    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(React.createElement(DbProvider, null,
        React.createElement(App, null)));
});



        // Service Worker para PWA
        if ('serviceWorker' in navigator) {
            const swCode = `
                const CACHE_NAME = 'mybank-v2';
                const urlsToCache = [
                    './',
                    'https://cdn.tailwindcss.com',
                    'https://unpkg.com/react@18/umd/react.production.min.js',
                    'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
                    'https://unpkg.com/@babel/standalone/babel.min.js',
                    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
                    'https://unpkg.com/lucide@latest',
                    './icons/logo.jpg'
                ];

                self.addEventListener('install', event => {
                    event.waitUntil(
                        caches.open(CACHE_NAME)
                            .then(cache => cache.addAll(urlsToCache))
                            .catch(err => console.log('Cache failed:', err))
                    );
                    self.skipWaiting();
                });

                self.addEventListener('fetch', event => {
                    event.respondWith(
                        caches.match(event.request)
                            .then(response => {
                                if (response) {
                                    return response;
                                }
                                return fetch(event.request).catch(() => {
                                    if (event.request.destination === 'image') {
                                        return new Response('Offline', { status: 503 });
                                    }
                                });
                            })
                    );
                });

                self.addEventListener('activate', event => {
                    event.waitUntil(
                        caches.keys().then(cacheNames => {
                            return Promise.all(
                                cacheNames.map(cacheName => {
                                    if (cacheName !== CACHE_NAME) {
                                        return caches.delete(cacheName);
                                    }
                                })
                            );
                        })
                    );
                    self.clients.claim();
                });
            `;

            const blob = new Blob([swCode], { type: 'application/javascript' });
            const swUrl = URL.createObjectURL(blob);

            navigator.serviceWorker.register(swUrl)
                .then(registration => {
                    console.log('Service Worker registrado:', registration.scope);
                })
                .catch(error => {
                    console.log('Falha ao registrar Service Worker:', error);
                });
        }

        // Inicializa ícones Lucide
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => {
                if (typeof lucide !== 'undefined') {
                    try {
                        lucide.createIcons();
                    } catch (e) {
                        console.log('Erro ao criar ícones iniciais:', e);
                    }
                }
            }, 500);
        });
    

(function(){
    if (window.__alcantaraLucideFixInstalled) return;
    window.__alcantaraLucideFixInstalled = true;

    let lucideFixTimer = null;
    function refreshAlcantaraIcons(){
        clearTimeout(lucideFixTimer);
        lucideFixTimer = setTimeout(function(){
            try {
                if (window.lucide && typeof window.lucide.createIcons === 'function') {
                    window.lucide.createIcons();
                }
            } catch (e) {
                console.warn('Falha ao atualizar ícones Lucide:', e);
            }
        }, 40);
    }

    window.refreshAlcantaraIcons = refreshAlcantaraIcons;

    document.addEventListener('DOMContentLoaded', function(){
        refreshAlcantaraIcons();
        setTimeout(refreshAlcantaraIcons, 250);
        setTimeout(refreshAlcantaraIcons, 700);

        try {
            const root = document.getElementById('root') || document.body;
            const observer = new MutationObserver(function(){
                refreshAlcantaraIcons();
            });
            observer.observe(root, { childList: true, subtree: true });
        } catch (e) {}
    });

    window.addEventListener('load', refreshAlcantaraIcons);
    window.addEventListener('popstate', function(){ setTimeout(refreshAlcantaraIcons, 80); });
    window.addEventListener('hashchange', function(){ setTimeout(refreshAlcantaraIcons, 80); });

    document.addEventListener('click', function(e){
        if (e.target && e.target.closest && e.target.closest('button, [role="button"], .dashboard-premium-btn, .os-card')) {
            setTimeout(refreshAlcantaraIcons, 80);
            setTimeout(refreshAlcantaraIcons, 300);
        }
    }, true);
})();


(function(){
  function cleanVisibleText(root){
    if(!root) return;
    var walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{
      acceptNode:function(n){
        var p=n.parentNode;
        if(!p || /^(SCRIPT|STYLE|TEXTAREA|INPUT)$/i.test(p.nodeName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while(n=walker.nextNode()){
      n.nodeValue=n.nodeValue
        .replace(/OFICINA/g,'PESSOAL')
        .replace(/Oficina/g,'Pessoal')
        .replace(/oficina/g,'pessoal')
        .replace(/Alcantara Armeiro/g,'My Bank')
        .replace(/Airsoft Repairs/g,'Pessoal')
        .replace(/Airsoft Repair/g,'Pessoal');
    }
  }
  function polish(){
    cleanVisibleText(document.body);
    try{
      document.querySelectorAll('button').forEach(function(btn){
        if(btn.textContent && btn.textContent.trim().length < 18){
          btn.style.whiteSpace='nowrap';
        }
      });
      if(window.lucide && window.lucide.createIcons) window.lucide.createIcons();
    }catch(e){}
  }
  document.addEventListener('DOMContentLoaded',polish);
  setTimeout(polish,500);
  setTimeout(polish,1500);
})();


(function(){
  function migrateBankAreas(){
    try{
      Object.keys(localStorage).forEach(function(k){
        if(!/bank|alcantara/i.test(k)) return;
        var raw = localStorage.getItem(k);
        if(!raw || !/^[\[{]/.test(raw.trim())) return;
        try{
          var data = JSON.parse(raw);
          (function walk(x){
            if(Array.isArray(x)) return x.forEach(walk);
            if(x && typeof x === 'object'){
              if('area' in x) x.area = 'pessoal';
              Object.keys(x).forEach(function(key){ walk(x[key]); });
            }
          })(data);
          localStorage.setItem(k, JSON.stringify(data));
        }catch(e){}
      });
    }catch(e){}
  }
  document.addEventListener('DOMContentLoaded', migrateBankAreas);
  setTimeout(migrateBankAreas, 500);
})();


(function(){
  function replaceTopLogo(){
    try{
      var header=document.querySelector('header');
      if(!header)return;
      var target=header.querySelector('[data-lucide="arrow-left"]')||header.querySelector('[data-lucide="chevron-left"]');
      var holder=target ? target.closest('button,div,span') : header.querySelector('button');
      if(holder){
        holder.innerHTML='<img class="mybank-top-logo" src="./icons/logo.png" alt="My Bank">';
        holder.style.background='transparent';
        holder.style.border='none';
        holder.style.padding='0';
        holder.style.minWidth='38px';
        holder.style.minHeight='38px';
      }
    }catch(e){}
  }
  function polishSaldo(){
    try{
      document.querySelectorAll('.wallet-card,.wallet-personal').forEach(function(card){
        var txt=(card.textContent||'').toUpperCase();
        if(txt.indexOf('PESSOAL')<0 && txt.indexOf('SALDO')<0)return;
        var walker=document.createTreeWalker(card,NodeFilter.SHOW_TEXT,null);
        var n;
        while(n=walker.nextNode()){
          n.nodeValue=n.nodeValue.replace(/PESSOAL/gi,'SALDO');
        }
        card.style.display='flex';
        card.style.flexDirection='column';
        card.style.alignItems='center';
        card.style.justifyContent='center';
        card.style.textAlign='center';
        card.querySelectorAll('*').forEach(function(el){el.style.textAlign='center';});
      });
    }catch(e){}
  }
  function run(){
    replaceTopLogo();
    polishSaldo();
    if(window.lucide&&window.lucide.createIcons)window.lucide.createIcons();
  }
  document.addEventListener('DOMContentLoaded',run);
  window.addEventListener('load',function(){
    run();
    setTimeout(run,600);
    setTimeout(run,1400);
    setTimeout(function(){
      var s=document.getElementById('splashScreen');
      if(!s)return;
      s.classList.add('splash-hide');
      setTimeout(function(){if(s&&s.parentNode)s.parentNode.removeChild(s);},800);
    },2500);
  });
})();


// My Bank pessoal: proteção final contra dados/controles antigos de oficina.
window.addEventListener('mybank-storage-ready', function(){
  try{
    const tx = JSON.parse(SafeStorage.getItem('mybank_transactions') || '[]');
    if(Array.isArray(tx)){ SafeStorage.setItem('mybank_transactions', JSON.stringify(tx.map(t => ({...t, area:'pessoal'})))); }
    const bills = JSON.parse(SafeStorage.getItem('mybank_fixed') || '[]');
    if(Array.isArray(bills)){ SafeStorage.setItem('mybank_fixed', JSON.stringify(bills.map(b => ({...b, area:'pessoal'})))); }
  }catch(e){}
});


// CSS aplicado pelo index.html: mybank-fixas-corrigido-sem-erro-final
