import { useState, useRef, useEffect, useCallback } from 'react';
import {
  ShoppingCart,
  PlusCircle,
  FileSpreadsheet,
  Search,
  Plus,
  Minus,
  Check,
  Save,
  X,
  Package,
  Volume2,
  VolumeX,
  BookOpen,
  AlertTriangle,
  RefreshCw,
  RotateCcw,
  Smartphone,
  Printer,
  Trash2,
  Camera,
  CameraOff,
  Heart,
  Star
} from 'lucide-react';

// ==========================================
// ⚙️ CONFIGURATION - GOOGLE SHEETS WEB APP URL
// ==========================================
const SCRIPT_URL = import.meta.env.VITE_GOOGLE_APPS_SCRIPT_URL?.trim() ?? "";

const createItemId = () => Date.now() + Math.floor(Math.random() * 1000);

// ==========================================
// 🧠 SMART PRICE-PROTECTION ENGINE (FIFO)
// ==========================================
const normalizeExpiryMMYY = (raw) => {
  if (!raw) return '';
  const str = String(raw).trim();
  // Kung YYYY-MM-DD o YYYY-MM ang lumang nakasave, gawing MM/YY
  const isoMatch = str.match(/^(\d{4})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[2]}/${isoMatch[1].slice(2)}`;
  }
  return str;
};

const expiryToSortKey = (mmyy) => {
  const match = String(mmyy || '').match(/^(\d{2})\/(\d{2})$/);
  if (!match) return '9999-99';
  return `20${match[2]}-${match[1]}`;
};

const normalizeItem = (item) => {
  const validBatches = (item.batches || [])
    .filter((b) => Number(b.qty) > 0)
    .map((b) => ({
      qty: Number(b.qty),
      cost: Number(b.cost),
      price: Number(b.price),
      expiryDate: normalizeExpiryMMYY(b.expiryDate)
    }))
    .sort((a, b) => {
      if (a.expiryDate && b.expiryDate) {
        return expiryToSortKey(a.expiryDate).localeCompare(expiryToSortKey(b.expiryDate));
      }
      if (a.expiryDate) return -1;
      if (b.expiryDate) return 1;
      return 0;
    });

  const totalQty = validBatches.reduce((sum, b) => sum + b.qty, 0);

  if (validBatches.length === 0) {
    return {
      ...item,
      isFavorite: Boolean(item.isFavorite),
      batches: [],
      qty: 0,
      cost: Number(item.cost) || 0,
      price: Number(item.price) || 0,
      nearestExpiry: ''
    };
  }

  const activePrice = Math.max(...validBatches.map((b) => b.price));
  const currentCost = validBatches[0].cost;
  const nearestExpiry = validBatches.find((b) => b.expiryDate)?.expiryDate || '';

  return {
    ...item,
    isFavorite: Boolean(item.isFavorite),
    batches: validBatches,
    qty: totalQty,
    cost: currentCost,
    price: activePrice,
    nearestExpiry
  };
};

// Starts empty so deleted starter items don't come back
const DEFAULT_INVENTORY = [];

const PRINT_PRESETS = [
  { label: 'Xerox / Copy', price: 5 },
  { label: 'Print (Black & White)', price: 10 },
  { label: 'Print (Colored)', price: 15 },
  { label: 'Print (Picture / Full)', price: 20 }
];

const App = () => {
  const [activeTab, setActiveTab] = useState('sell');
  const [activeDrawer, setActiveDrawer] = useState(null); // 'tingi' | 'gcash' | 'print' | null
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [syncStatus, setSyncStatus] = useState(SCRIPT_URL ? 'Naka-konekta' : 'Local Mode');

  // Persisted Inventory, Utang, Daily Stats, and Service Logs
  const [inventory, setInventory] = useState(() => {
    const saved = localStorage.getItem('tindahan_inventory');
    if (saved) {
      try {
        return JSON.parse(saved).map(normalizeItem);
      } catch {
        return DEFAULT_INVENTORY;
      }
    }
    return DEFAULT_INVENTORY;
  });

  const [utangList, setUtangList] = useState(() => {
    const saved = localStorage.getItem('tindahan_utang');
    return saved ? JSON.parse(saved) : [];
  });

  const [dailyStats, setDailyStats] = useState(() => {
    const saved = localStorage.getItem('tindahan_stats');
    return saved
      ? JSON.parse(saved)
      : { sales: 0, profit: 0, puhunan: 0, serviceProfit: 0 };
  });

  const [serviceLogs, setServiceLogs] = useState(() => {
    const saved = localStorage.getItem('tindahan_service_logs');
    return saved ? JSON.parse(saved) : [];
  });

  // Bantay Bote (Softdrinks / Beer Glass Bottle Tracker)
  const [boteData, setBoteData] = useState(() => {
    const saved = localStorage.getItem('tindahan_bote');
    return saved
      ? JSON.parse(saved)
      : { totalOwned: 48, borrowedList: [] }; // 48 pcs = 2 cases default
  });
  const [boteCustomer, setBoteCustomer] = useState('');
  const [boteBrand, setBoteBrand] = useState('Softdrinks (Mismo/Kasalo)');
  const [boteQty, setBoteQty] = useState('1');
  const [boteDeposit, setBoteDeposit] = useState('10');
  const [showBoteForm, setShowBoteForm] = useState(false);

  useEffect(() => {
    localStorage.setItem('tindahan_bote', JSON.stringify(boteData));
  }, [boteData]);

  // Cart & Checkout States
  const [cart, setCart] = useState([]);
  const [cashTendered, setCashTendered] = useState('');
  const [utangCustomer, setUtangCustomer] = useState('');
  const [showUtangInput, setShowUtangInput] = useState(false);
  const [discountAmount, setDiscountAmount] = useState('');
  const [showDiscountBox, setShowDiscountBox] = useState(false);
  const [activeHulogId, setActiveHulogId] = useState(null);
  const [hulogAmount, setHulogAmount] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // GCash / Bank States
  const [gcashType, setGcashType] = useState('CASH-IN'); // 'CASH-IN' | 'CASH-OUT'
  const [gcashAmount, setGcashAmount] = useState('');
  const [gcashFee, setGcashFee] = useState('');

  // Printing Custom States
  const [customPrintName, setCustomPrintName] = useState('Print / Scan');
  const [customPrintQty, setCustomPrintQty] = useState('1');
  const [customPrintPrice, setCustomPrintPrice] = useState('');

  // Add Stock States
  const [newStock, setNewStock] = useState({
    barcode: '',
    name: '',
    qty: '',
    packCost: '',
    unitCost: '',
    costMode: 'unit', 
    targetProfit: '',
    targetPrice: '',
    expiryDate: '',
    isFavorite: false
  });

  const [showStockSuggestions, setShowStockSuggestions] = useState(false);

  const [message, setMessage] = useState(null);
  const toastTimerRef = useRef(null);
  const scanBufferRef = useRef({ chars: '', lastTime: 0 });
  const [cameraOpen, setCameraOpen] = useState(false);
  const [lastScannedText, setLastScannedText] = useState('');
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const scanIntervalRef = useRef(null);
  const lastCameraScanRef = useRef({ code: '', time: 0 });
  const processScanRef = useRef(null);
  const cartSectionRef = useRef(null);

  // Save to localStorage automatically
  useEffect(() => {
    localStorage.setItem('tindahan_inventory', JSON.stringify(inventory));
  }, [inventory]);

  useEffect(() => {
    localStorage.setItem('tindahan_utang', JSON.stringify(utangList));
  }, [utangList]);

  useEffect(() => {
    localStorage.setItem('tindahan_stats', JSON.stringify(dailyStats));
  }, [dailyStats]);

  useEffect(() => {
    localStorage.setItem('tindahan_service_logs', JSON.stringify(serviceLogs));
  }, [serviceLogs]);

  // ==========================================
  // 🔊 AUDIO FEEDBACK (BEEP)
  // ==========================================
  const playBeep = useCallback(
    (type = 'success') => {
      if (!soundEnabled) return;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        if (type === 'success') {
          osc.frequency.setValueAtTime(850, ctx.currentTime);
          gain.gain.setValueAtTime(0.12, ctx.currentTime);
          osc.start();
          osc.stop(ctx.currentTime + 0.1);
        } else {
          osc.frequency.setValueAtTime(280, ctx.currentTime);
          gain.gain.setValueAtTime(0.18, ctx.currentTime);
          osc.start();
          osc.stop(ctx.currentTime + 0.3);
        }
      } catch {
        // Ignore audio restrictions
      }
    },
    [soundEnabled]
  );

  const showMessage = useCallback((msg, type = 'success') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setMessage({ text: msg, type });
    toastTimerRef.current = setTimeout(() => setMessage(null), 4000);
  }, []);

  // ==========================================
  // 🔄 GOOGLE SHEETS SYNC + OFFLINE QUEUE
  // ==========================================
  const flushOfflineQueue = useCallback(async () => {
    if (!SCRIPT_URL) return true;
    const savedQueue = JSON.parse(localStorage.getItem('tindahan_offline_queue') || '[]');
    if (savedQueue.length === 0) return true;

    try {
      setSyncStatus(`Sine-send (${savedQueue.length})...`);
      await fetch(SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ queue: savedQueue })
      });
      localStorage.removeItem('tindahan_offline_queue');
      return true;
    } catch {
      setSyncStatus(`Offline (${savedQueue.length} naka-pila)`);
      return false;
    }
  }, []);

const pullFromSheets = useCallback(
    async (forceFromSheet = false) => {
      if (!SCRIPT_URL) return;
      setSyncStatus('Naglo-load...');

      // Kung pinindot mismo ang "I-Sync" button, huwag hayaang i-overwrite ng lumang offline queue ang Google Sheet
      if (forceFromSheet) {
        localStorage.removeItem('tindahan_offline_queue');
      } else {
        const flushed = await flushOfflineQueue();
        if (!flushed) return;
      }

      try {
        // Ang &t=${Date.now()} ay pumipigil sa browser na ibalik ang lumang cached data
        const res = await fetch(`${SCRIPT_URL}?action=getData&t=${Date.now()}`, {
          cache: 'no-store'
        });
        const data = await res.json();
        if (data.inventory && Array.isArray(data.inventory)) {
          setInventory(data.inventory.map(normalizeItem));
        }
        if (data.utangList && Array.isArray(data.utangList)) {
          setUtangList(data.utangList);
        }
        if (data.boteData) {
          setBoteData(data.boteData);
        }
        setSyncStatus('Naka-save sa Cloud');
      } catch {
        setSyncStatus('Offline (Saved sa Device)');
      }
    },
    [flushOfflineQueue]
  );

  useEffect(() => {
    pullFromSheets();
    window.addEventListener('online', pullFromSheets);
    return () => window.removeEventListener('online', pullFromSheets);
  }, [pullFromSheets]);

  const syncToSheets = async (action, payload) => {
    if (!SCRIPT_URL) return;
    const eventRecord = { action, timestamp: new Date().toISOString(), ...payload };

    setSyncStatus('Sine-save...');
    try {
      const savedQueue = JSON.parse(localStorage.getItem('tindahan_offline_queue') || '[]');
      const fullQueue = [...savedQueue, eventRecord];
      await fetch(SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ queue: fullQueue })
      });
      localStorage.removeItem('tindahan_offline_queue');
      setSyncStatus('🟢');
    } catch {
      const savedQueue = JSON.parse(localStorage.getItem('tindahan_offline_queue') || '[]');
      const updatedQueue = [...savedQueue, eventRecord];
      localStorage.setItem('tindahan_offline_queue', JSON.stringify(updatedQueue));
      setSyncStatus(`Offline (${updatedQueue.length} naka-pila)`);
    }
  };

  // ==========================================
  // 🛒 CART & BARCODE FUNCTIONS
  // ==========================================
  const addToCart = useCallback(
    (item) => {
      if (!item.isService && item.qty <= 0) {
        playBeep('error');
        return showMessage(`Ubos na ang stock ng ${item.name}!`, 'error');
      }

      let exceeded = false;
      setCart((prev) => {
        const existing = prev.find((i) => i.id === item.id);
        if (existing) {
          if (!item.isService && existing.cartQty >= item.qty) {
            exceeded = true;
            return prev;
          }
          return prev.map((i) =>
            i.id === item.id ? { ...i, cartQty: i.cartQty + (item.addQty || 1) } : i
          );
        }
        return [...prev, { ...item, cartQty: item.addQty || 1 }];
      });

      if (exceeded) {
        playBeep('error');
        return showMessage(`Hanggang ${item.qty} pcs lang ang natitirang stock!`, 'error');
      }

      playBeep('success');
      showMessage(`₱${item.price.toFixed(2)} — ${item.name} idinagdag!`, 'success');
    },
    [playBeep, showMessage]
  );

  const processBarcodeScan = useCallback(
    (rawBarcode) => {
      const barcode = rawBarcode.trim();
      if (!barcode) return;

      const scannedItem = inventory.find((item) => item.barcode === barcode);

      if (activeTab === 'sell') {
        if (scannedItem) {
          addToCart(scannedItem);
          setSearchQuery('');
        } else {
          playBeep('error');
          setActiveTab('stock');
          setNewStock({
            barcode,
            name: '',
            qty: '',
            packCost: '',
            unitCost: '',
            targetProfit: '',
            targetPrice: '',
            expiryDate: '',
            isFavorite: false
          });
          setSearchQuery('');
          showMessage(
            `Bagong item (${barcode})! Ilagay ang pangalan, puhunan, at presyo.`,
            'error'
          );
        }
      } else if (activeTab === 'stock') {
        playBeep('success');
        setShowStockSuggestions(false);

        setNewStock((prev) => {
          const isSameItem =
            (prev.barcode.trim() && prev.barcode.trim() === barcode) ||
            (scannedItem &&
              prev.name.trim().toLowerCase() === scannedItem.name.toLowerCase());

          const nextQty = isSameItem ? (parseInt(prev.qty, 10) || 0) + 1 : 1;

          const activeUnitCost =
            isSameItem && parseFloat(prev.unitCost) > 0
              ? parseFloat(prev.unitCost)
              : scannedItem
              ? scannedItem.cost
              : 0;

          showMessage(
            scannedItem
              ? `📦 ${scannedItem.name} — Bilang: ${nextQty} pcs (Puhunan: ₱${scannedItem.cost.toFixed(2)}/pc | Benta: ₱${scannedItem.price.toFixed(2)})`
              : `Barcode ${barcode} nailagay na! (Bilang: ${nextQty})`,
            'success'
          );

          return {
            ...prev,
            barcode,
            name: scannedItem ? scannedItem.name : prev.name,
            qty: String(nextQty),
            costMode: 'unit', // Naka-lock ang Puhunan/pc!
            unitCost: activeUnitCost > 0 ? activeUnitCost.toFixed(2) : prev.unitCost,
            packCost:
              activeUnitCost > 0
                ? (activeUnitCost * nextQty).toFixed(2)
                : prev.packCost,
            targetPrice:
              isSameItem && prev.targetPrice
                ? prev.targetPrice
                : scannedItem
                ? scannedItem.price.toFixed(2)
                : prev.targetPrice,
            isFavorite: scannedItem ? Boolean(scannedItem.isFavorite) : prev.isFavorite
          };
        });
      }
    },
    [activeTab, inventory, addToCart, playBeep, showMessage]
  );

  // ⭐ 
  const toggleFavorite = (itemId) => {
    const updatedInv = inventory.map((item) =>
      item.id === itemId ? { ...item, isFavorite: !item.isFavorite } : item
    );
    setInventory(updatedInv);
    syncToSheets('syncInventory', { inventory: updatedInv });
  };

  // Keep latest scan handler in a ref so the camera loop never uses stale inventory/cart state
  useEffect(() => {
    processScanRef.current = processBarcodeScan;
  }, [processBarcodeScan]);

  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
    setLastScannedText('');
  }, []);

  const startCamera = useCallback(async () => {
    try {
      // Load BarcodeDetector polyfill automatically for iOS Safari / older browsers
      if (!('BarcodeDetector' in window)) {
        const mod = await import(
          /* @vite-ignore */ 'https://fastly.jsdelivr.net/npm/barcode-detector@2/dist/es/pure.min.js'
        );
        window.BarcodeDetector = mod.BarcodeDetector;
      }

      const detector = new window.BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code']
      });

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      streamRef.current = stream;
      setCameraOpen(true);

      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 100);

      // Continuously check camera frames every 250ms
      scanIntervalRef.current = setInterval(async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) return;
        try {
          const barcodes = await detector.detect(videoRef.current);
          if (barcodes.length > 0) {
            const rawCode = barcodes[0].rawValue?.trim();
            if (!rawCode) return;

            const now = Date.now();
            // 2-second cooldown for the exact same barcode to prevent accidental double scans
            if (
              lastCameraScanRef.current.code === rawCode &&
              now - lastCameraScanRef.current.time < 2000
            ) {
              return;
            }

            lastCameraScanRef.current = { code: rawCode, time: now };
            setLastScannedText(rawCode);

            if (processScanRef.current) {
              processScanRef.current(rawCode);
            }
          }
        } catch {
          // Ignore single-frame decode errors
        }
      }, 250);
    } catch {
      playBeep('error');
      showMessage(
        'Hindi mabuksan ang camera. Siguraduhing naka-Allow ang Camera permission at naka-HTTPS.',
        'error'
      );
      stopCamera();
    }
  }, [playBeep, showMessage, stopCamera]);

  // Clean up camera if user leaves the page
  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  // Global Hardware Scanner Listener
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const now = Date.now();
      if (now - scanBufferRef.current.lastTime > 100) {
        scanBufferRef.current.chars = '';
      }
      scanBufferRef.current.lastTime = now;

      if (e.key === 'Enter') {
        if (scanBufferRef.current.chars.length >= 4) {
          e.preventDefault();
          processBarcodeScan(scanBufferRef.current.chars);
          scanBufferRef.current.chars = '';
        }
      } else if (e.key.length === 1) {
        scanBufferRef.current.chars += e.key;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [processBarcodeScan]);

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter' && searchQuery.trim() !== '') {
      e.preventDefault();
      processBarcodeScan(searchQuery);
    }
  };

  const updateCartQty = (id, change) => {
    const currentCartItem = cart.find((i) => i.id === id);
    if (!currentCartItem) return;

    if (!currentCartItem.isService) {
      const invItem = inventory.find((i) => i.id === id);
      if (invItem && change > 0 && currentCartItem.cartQty + change > invItem.qty) {
        playBeep('error');
        return showMessage(`Hanggang ${invItem.qty} pcs lang ang stock!`, 'error');
      }
    }

    setCart((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, cartQty: Math.max(1, item.cartQty + change) } : item
      )
    );
  };

  // ==========================================
  // 📱 GCASH / BANK / E-LOAD & 🖨️ PRINT HANDLERS
  // ==========================================
  const selectGcashMode = (mode) => {
    setGcashType(mode);
    const num = parseFloat(gcashAmount);
    if (num > 0) {
      if (mode === 'E-LOAD') {
        setGcashFee('5');
      } else {
        setGcashFee(String(Math.max(5, Math.ceil(num / 500) * 10)));
      }
    } else {
      setGcashFee(mode === 'E-LOAD' ? '5' : '');
    }
  };

  const handleGcashAmountChange = (val) => {
    setGcashAmount(val);
    const num = parseFloat(val);
    if (num > 0) {
      if (gcashType === 'E-LOAD') {
        // Fixed +₱5 patong for all E-Load amounts
        setGcashFee('5');
      } else {
        // Standard Sari-Sari Store Bracket: ₱10 fee per ₱500
        const suggestedFee = Math.max(5, Math.ceil(num / 500) * 10);
        setGcashFee(String(suggestedFee));
      }
    } else {
      setGcashFee('');
    }
  };

  const handleRecordGcash = () => {
    const amt = parseFloat(gcashAmount);
    const fee = parseFloat(gcashFee);

    if (!amt || amt <= 0 || isNaN(fee) || fee < 0) {
      playBeep('error');
      return showMessage('Ilagay ang Halaga ng GCash/Bank at ang Tubo (Fee).', 'error');
    }

    const logEntry = {
      id: createItemId(),
      type: `GCASH/BANK ${gcashType}`,
      principal: amt,
      fee: fee,
      time: new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
    };

    setDailyStats((prev) => ({
      ...prev,
      sales: prev.sales + fee,
      profit: prev.profit + fee,
      serviceProfit: (prev.serviceProfit || 0) + fee
    }));

    setServiceLogs((prev) => [logEntry, ...prev.slice(0, 29)]);
    syncToSheets('recordService', {
      serviceType: `GCASH/BANK ${gcashType}`,
      principal: amt,
      fee: fee,
      details: `📱 ${gcashType}: ₱${amt.toFixed(2)} (Tubo/Fee: ₱${fee.toFixed(2)})`
    });

    playBeep('success');
    showMessage(
      `Na-rekord ang ${gcashType} (₱${amt.toFixed(2)})! Tubo: ₱${fee.toFixed(2)}`,
      'success'
    );
    setGcashAmount('');
    setGcashFee('');
    setActiveDrawer(null);
  };

  const handleAddPrintPreset = (preset) => {
    addToCart({
      id: `PRINT-${preset.label}`,
      name: `🖨️ ${preset.label}`,
      price: preset.price,
      cost: 0,
      isService: true,
      addQty: 1
    });
  };

  const handleAddCustomPrint = () => {
    const qty = parseInt(customPrintQty, 10) || 1;
    const price = parseFloat(customPrintPrice);
    if (!price || price <= 0) {
      playBeep('error');
      return showMessage('Ilagay ang presyo kada pahina/piraso.', 'error');
    }
    addToCart({
      id: `PRINT-CUSTOM-${price}-${customPrintName}`,
      name: `🖨️ ${customPrintName.trim() || 'Print/Xerox'}`,
      price: price,
      cost: 0,
      isService: true,
      addQty: qty
    });
    setCustomPrintQty('1');
    setCustomPrintPrice('');
  };

  // ==========================================
  // 💳 CHECKOUT (GROCERIES + PRINT SERVICES)
  // ==========================================
  const deductCartFromInventory = () => {
    let saleTotal = 0;
    let totalCost = 0;
    let serviceRevenue = 0;
    const priceDropAlerts = [];

    cart
      .filter((c) => c.isService)
      .forEach((serviceItem) => {
        const rev = serviceItem.price * serviceItem.cartQty;
        saleTotal += rev;
        serviceRevenue += rev;
      });

    const updatedInventory = inventory.map((invItem) => {
      const cartItem = cart.find((c) => !c.isService && c.id === invItem.id);
      if (!cartItem) return invItem;

      let remainingToDeduct = cartItem.cartQty;
      const oldPrice = invItem.price;
      saleTotal += oldPrice * cartItem.cartQty;

      const updatedBatches = [];
      for (const batch of invItem.batches) {
        if (remainingToDeduct <= 0) {
          updatedBatches.push({ ...batch });
          continue;
        }
        const take = Math.min(batch.qty, remainingToDeduct);
        totalCost += take * batch.cost;
        remainingToDeduct -= take;
        if (batch.qty - take > 0) {
          updatedBatches.push({ ...batch, qty: batch.qty - take });
        }
      }

      const normalized = normalizeItem({
        ...invItem,
        batches: updatedBatches,
        cost: invItem.cost,
        price: oldPrice
      });

      if (normalized.qty > 0 && normalized.price < oldPrice) {
        priceDropAlerts.push(
          `${invItem.name} (₱${oldPrice.toFixed(2)} ➔ ₱${normalized.price.toFixed(2)})`
        );
      }
      return normalized;
    });

    return { updatedInventory, saleTotal, totalCost, serviceRevenue, priceDropAlerts };
  };

  const processCheckout = (isUtang = false) => {
    if (cart.length === 0) return;

    if (isUtang && !utangCustomer.trim()) {
      playBeep('error');
      return showMessage('Ilagay muna ang pangalan ng umutang.', 'error');
    }

    const {
      updatedInventory,
      saleTotal: rawSaleTotal,
      totalCost,
      serviceRevenue,
      priceDropAlerts
    } = deductCartFromInventory();

    const appliedDiscount = Math.min(
      rawSaleTotal,
      Math.max(0, parseFloat(discountAmount) || 0)
    );
    const saleTotal = Math.max(0, rawSaleTotal - appliedDiscount);
    const profitTotal = saleTotal - totalCost;

    const baseSummary = cart.map((i) => `${i.cartQty}x ${i.name}`).join(', ');
    const itemsSummaryWithDiscount =
      appliedDiscount > 0
        ? `${baseSummary} [Discount: -₱${appliedDiscount.toFixed(2)}]`
        : baseSummary;

    setInventory(updatedInventory);

    if (isUtang) {
      const newUtangRecord = {
        id: createItemId(),
        customer: utangCustomer.trim(),
        amount: saleTotal,
        cost: totalCost,
        profit: profitTotal,
        serviceRevenue: serviceRevenue,
        itemsSummary: itemsSummaryWithDiscount,
        date: new Date().toLocaleDateString('en-PH', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      };
      const updatedUtang = [newUtangRecord, ...utangList];
      setUtangList(updatedUtang);
      syncToSheets('recordUtang', {
        utang: newUtangRecord,
        inventory: updatedInventory,
        utangList: updatedUtang
      });
      showMessage(
        `Nailista sa utang ni ${utangCustomer.trim()}: ₱${saleTotal.toFixed(2)}${
          appliedDiscount > 0 ? ` (May Discount: -₱${appliedDiscount.toFixed(2)})` : ''
        }`,
        'success'
      );
    } else {
      setDailyStats((prev) => ({
        sales: prev.sales + saleTotal,
        profit: prev.profit + profitTotal,
        puhunan: prev.puhunan + totalCost,
        serviceProfit: (prev.serviceProfit || 0) + serviceRevenue
      }));

      if (serviceRevenue > 0) {
        const printSummary = cart
          .filter((c) => c.isService)
          .map((c) => `${c.cartQty}x ${c.name}`)
          .join(', ');
        setServiceLogs((prev) => [
          {
            id: createItemId(),
            type: printSummary,
            principal: serviceRevenue,
            fee: serviceRevenue,
            time: new Date().toLocaleTimeString('en-PH', {
              hour: '2-digit',
              minute: '2-digit'
            })
          },
          ...prev.slice(0, 29)
        ]);
      }

      // Kung may discount, isama sa pangalan ng huling item sa log para makita sa Sheet Ledger
      const ledgerItems =
        appliedDiscount > 0 && cart.length > 0
          ? cart.map((item, idx) =>
              idx === cart.length - 1
                ? { ...item, name: `${item.name} (Discount: -₱${appliedDiscount.toFixed(2)})` }
                : item
            )
          : cart;

      syncToSheets('recordSale', {
        items: ledgerItems,
        saleTotal,
        profitTotal,
        inventory: updatedInventory
      });

      if (priceDropAlerts.length > 0) {
        showMessage(
          `Bayad na (₱${saleTotal.toFixed(2)})! Bumaba na ang presyo ng: ${priceDropAlerts.join(', ')}.`,
          'success'
        );
      } else {
        showMessage(
          `Bayad na! Total: ₱${saleTotal.toFixed(2)}${
            appliedDiscount > 0 ? ` (Discount: -₱${appliedDiscount.toFixed(2)})` : ''
          }`,
          'success'
        );
      }
    }

    playBeep('success');
    setCart([]);
    setCashTendered('');
    setDiscountAmount('');
    setShowDiscountBox(false);
    setUtangCustomer('');
    setShowUtangInput(false);
  };

  const handleBayadPagmamahal = () => {
    if (cart.length === 0) return;

    const { updatedInventory, totalCost, priceDropAlerts } = deductCartFromInventory();
    const itemsSummary = cart.map((i) => `${i.cartQty}x ${i.name}`).join(', ');

    setInventory(updatedInventory);
    playBeep('success');

    syncToSheets('recordFamilyUse', {
      itemsSummary,
      totalCost,
      inventory: updatedInventory
    });

    if (priceDropAlerts.length > 0) {
      showMessage(
        `❤️ Bayad Pagmamahal! Binawas sa stock. Bumaba na ang presyo ng: ${priceDropAlerts.join(', ')}.`,
        'success'
      );
    } else {
      showMessage(
        `❤️ Bayad Pagmamahal! Binawas na sa stock (${itemsSummary}).`,
        'success'
      );
    }

    setCart([]);
    setCashTendered('');
    setUtangCustomer('');
    setShowUtangInput(false);
  };

  const markUtangPaid = (record) => {
    const updatedUtang = utangList.filter((u) => u.id !== record.id);
    setUtangList(updatedUtang);
    setDailyStats((prev) => ({
      sales: prev.sales + record.amount,
      profit: prev.profit + record.profit,
      puhunan: prev.puhunan + record.cost,
      serviceProfit: (prev.serviceProfit || 0) + (record.serviceRevenue || 0)
    }));
    setActiveHulogId(null);
    setHulogAmount('');
    playBeep('success');
    syncToSheets('payUtang', { record, utangList: updatedUtang });
    showMessage(
      `Buong bayad na ang utang ni ${record.customer} (₱${record.amount.toFixed(2)})!`,
      'success'
    );
  };

  const handlePartialUtangPayment = (record) => {
    const paid = parseFloat(hulogAmount);
    if (!paid || paid <= 0) {
      playBeep('error');
      return showMessage('Ilagay kung magkano ang ihuhulog na bayad.', 'error');
    }

    // If they pay the full amount (or more), treat it as full payment
    if (paid >= record.amount) {
      return markUtangPaid(record);
    }

    // Proportional split so Puhunan, Tubo, and Service Profit stay 100% accurate
    const ratio = paid / record.amount;
    const paidCost = record.cost * ratio;
    const paidProfit = record.profit * ratio;
    const paidService = (record.serviceRevenue || 0) * ratio;
    const remainingBalance = record.amount - paid;

    const updatedRecord = {
      ...record,
      amount: remainingBalance,
      cost: record.cost - paidCost,
      profit: record.profit - paidProfit,
      serviceRevenue: (record.serviceRevenue || 0) - paidService,
      itemsSummary: `${record.itemsSummary} [Hulog: -₱${paid.toFixed(2)}]`
    };

    const updatedUtang = utangList.map((u) =>
      u.id === record.id ? updatedRecord : u
    );

    setUtangList(updatedUtang);
    setDailyStats((prev) => ({
      sales: prev.sales + paid,
      profit: prev.profit + paidProfit,
      puhunan: prev.puhunan + paidCost,
      serviceProfit: (prev.serviceProfit || 0) + paidService
    }));

    // Sends partial payment to Google Sheets Ledger under 'BAYAD UTANG'
    const ledgerPartialRecord = {
      customer: `${record.customer} (HULOG)`,
      amount: paid,
      profit: paidProfit,
      itemsSummary: `Hulog sa utang (Natitirang balanse: ₱${remainingBalance.toFixed(2)})`
    };

    playBeep('success');
    syncToSheets('payUtang', {
      record: ledgerPartialRecord,
      utangList: updatedUtang
    });

    showMessage(
      `Tinanggap ang ₱${paid.toFixed(2)} na hulog ni ${record.customer}! Natitirang utang: ₱${remainingBalance.toFixed(2)}`,
      'success'
    );
    setActiveHulogId(null);
    setHulogAmount('');
  };

  // ==========================================
  // 🍾 BANTAY BOTE (DEPOSIT & BORROW TRACKER)
  // ==========================================
  const adjustTotalBote = (change) => {
    const updatedBote = {
      ...boteData,
      totalOwned: Math.max(0, (boteData.totalOwned || 0) + change)
    };
    setBoteData(updatedBote);
    syncToSheets('syncBote', { boteData: updatedBote });
  };

  const handleAddBorrowedBote = () => {
    const qty = parseInt(boteQty, 10) || 1;
    const deposit = parseFloat(boteDeposit) || 0;
    if (!boteCustomer.trim()) {
      playBeep('error');
      return showMessage('Ilagay ang pangalan ng kumuha ng bote.', 'error');
    }

    const newRecord = {
      id: createItemId(),
      customer: boteCustomer.trim(),
      brand: boteBrand,
      qty: qty,
      deposit: deposit,
      date: new Date().toLocaleDateString('en-PH', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    };

    const updatedBote = {
      ...boteData,
      borrowedList: [newRecord, ...(boteData.borrowedList || [])]
    };

    setBoteData(updatedBote);
    syncToSheets('syncBote', { boteData: updatedBote });

    playBeep('success');
    showMessage(
      deposit > 0
        ? `Nailista: ${qty}x bote kay ${newRecord.customer} (May Deposito: ₱${deposit.toFixed(2)})`
        : `Nailista: ${qty}x bote kay ${newRecord.customer} (Walang Deposito)`,
      'success'
    );
    setBoteCustomer('');
    setBoteQty('1');
    setShowBoteForm(false);
  };

  const handleReturnBote = (record) => {
    const updatedBote = {
      ...boteData,
      borrowedList: (boteData.borrowedList || []).filter((b) => b.id !== record.id)
    };
    
    setBoteData(updatedBote);
    syncToSheets('syncBote', { boteData: updatedBote });
    
    playBeep('success');
    showMessage(
      record.deposit > 0
        ? `Sinauli na ni ${record.customer} ang ${record.qty}x bote! Ibalik ang ₱${record.deposit.toFixed(2)} na deposito.`
        : `Sinauli na ni ${record.customer} ang ${record.qty}x bote!`,
      'success'
    );
  };

  // ==========================================
  // 📦 TAB 2: DAGDAG STOCK & TUBO CALCULATOR
  // ==========================================
  const unitCostPreview =
    parseFloat(newStock.unitCost) > 0
      ? parseFloat(newStock.unitCost)
      : newStock.packCost && newStock.qty && parseInt(newStock.qty, 10) > 0
      ? parseFloat(newStock.packCost) / parseInt(newStock.qty, 10)
      : 0;

// Kapag binago ang Ilang Piraso: Kung 'unit' mode (default), NAKA-LOCK ang Puhunan/pc!
  const handleQtyChange = (val) => {
    const qtyNum = parseInt(val, 10);
    setNewStock((prev) => {
      let nextUnit = prev.unitCost;
      let nextPack = prev.packCost;

      if (prev.costMode === 'pack' && qtyNum > 0 && parseFloat(prev.packCost) > 0) {
        // Nag-type muna sa Puhunan Pack bago naglagay ng Piraso (hal. bagong bili na pack)
        nextUnit = (parseFloat(prev.packCost) / qtyNum).toFixed(2);
      } else if (qtyNum > 0 && parseFloat(prev.unitCost) > 0) {
        // Naka-lock ang Puhunan/pc! Ang Pack Cost lang ang mag-a-adjust
        nextPack = (parseFloat(prev.unitCost) * qtyNum).toFixed(2);
      }
      return { ...prev, qty: val, unitCost: nextUnit, packCost: nextPack };
    });
  };

  // Kapag nag-type sa 4A (Puhunan Pack), tsaka lang siya magdi-divide sa bilang ng piraso
  const handlePackCostChange = (val) => {
    const packNum = parseFloat(val);
    const qtyNum = parseInt(newStock.qty, 10);
    setNewStock((prev) => ({
      ...prev,
      costMode: 'pack',
      packCost: val,
      unitCost:
        qtyNum > 0 && !isNaN(packNum) && packNum > 0
          ? (packNum / qtyNum).toFixed(2)
          : prev.unitCost
    }));
  };

  // Kapag nag-type sa 4B (Puhunan/pc), i-lock ang Puhunan/pc
  const handleUnitCostChange = (val) => {
    const unitNum = parseFloat(val);
    const qtyNum = parseInt(newStock.qty, 10);
    setNewStock((prev) => ({
      ...prev,
      costMode: 'unit',
      unitCost: val,
      packCost:
        qtyNum > 0 && !isNaN(unitNum) && unitNum > 0
          ? (unitNum * qtyNum).toFixed(2)
          : ''
    }));
  };

  // Pumili ng paninda mula sa Search Dropdown sa Tab 2 (Naka-lock ang Puhunan/pc)
  const selectStockSuggestion = (item) => {
    const isSameItem =
      newStock.barcode === item.barcode &&
      newStock.name.trim().toLowerCase() === item.name.toLowerCase();

    const nextQty = isSameItem
      ? (parseInt(newStock.qty, 10) || 0) + 1
      : parseInt(newStock.qty, 10) > 0
      ? parseInt(newStock.qty, 10)
      : 1;

    const unitCostVal = item.cost > 0 ? item.cost.toFixed(2) : '';
    const packCostVal = item.cost > 0 ? (item.cost * nextQty).toFixed(2) : '';

    setNewStock((prev) => ({
      ...prev,
      barcode: item.barcode.startsWith('ITEM-') ? '' : item.barcode,
      name: item.name,
      qty: String(nextQty),
      costMode: 'unit',
      unitCost: unitCostVal,
      packCost: packCostVal,
      targetPrice: item.price.toFixed(2),
      isFavorite: Boolean(item.isFavorite)
    }));
    setShowStockSuggestions(false);
    playBeep('success');
  };

  // Mabilisang dagdag sa Ilang Piraso (+1, +6, +8, +10, +12, +24) — Laging naka-lock ang Puhunan/pc!
  const addQuickStockQty = (addAmount) => {
    setNewStock((prev) => {
      const currentQty = parseInt(prev.qty, 10) || 0;
      const nextQty = Math.max(1, currentQty + addAmount);
      const unitNum = parseFloat(prev.unitCost);
      return {
        ...prev,
        costMode: 'unit',
        qty: String(nextQty),
        packCost:
          !isNaN(unitNum) && unitNum > 0
            ? (unitNum * nextQty).toFixed(2)
            : prev.packCost
      };
    });
  };

  // Auto-format sa MM/YY habang nagta-type (hal. "1126" -> "11/26")
  const handleExpiryMMYYChange = (rawVal) => {
    const digits = rawVal.replace(/\D/g, '').slice(0, 4);
    let formatted = digits;
    if (digits.length >= 3) {
      let mm = parseInt(digits.slice(0, 2), 10);
      if (mm > 12) mm = 12;
      if (mm < 1) mm = 1;
      formatted = `${String(mm).padStart(2, '0')}/${digits.slice(2)}`;
    }
    setNewStock((prev) => ({ ...prev, expiryDate: formatted }));
  };

  const applyQuickProfit = (amount, mode = 'peso') => {
    if (unitCostPreview <= 0) {
      playBeep('error');
      return showMessage('Ilagay muna ang Puhunan (sa Pack o Kada Piraso).', 'error');
    }
    const computed =
      mode === 'peso'
        ? unitCostPreview + amount
        : unitCostPreview * (1 + amount / 100);
    setNewStock((prev) => ({
      ...prev,
      targetProfit: String(amount),
      targetPrice: computed.toFixed(2)
    }));
  };

  const roundUpSellingPrice = () => {
    const current = parseFloat(newStock.targetPrice);
    if (!current || current <= 0) return;
    setNewStock((prev) => ({ ...prev, targetPrice: Math.ceil(current).toFixed(2) }));
  };

  const handleSaveStock = () => {
    const qtyNum = parseInt(newStock.qty, 10);
    const newPrice = parseFloat(newStock.targetPrice);
    const finalUnitCost = unitCostPreview;
    const finalPackCost =
      parseFloat(newStock.packCost) > 0
        ? parseFloat(newStock.packCost)
        : finalUnitCost * (qtyNum || 0);

    if (
      !newStock.name.trim() ||
      !qtyNum ||
      qtyNum <= 0 ||
      isNaN(finalUnitCost) ||
      finalUnitCost <= 0 ||
      isNaN(newPrice) ||
      newPrice <= 0
    ) {
      playBeep('error');
      return showMessage('Pakikumpleto ang Pangalan, Piraso, Puhunan, at Presyo.', 'error');
    }

    if (newStock.expiryDate && !/^\d{2}\/\d{2}$/.test(newStock.expiryDate.trim())) {
      playBeep('error');
      return showMessage('Gamitin ang MM/YY na format sa Expiration (hal. 12/26).', 'error');
    }

    const cleanBarcode = newStock.barcode.trim();
    const existingIndex = inventory.findIndex(
      (i) =>
        (cleanBarcode && i.barcode === cleanBarcode) ||
        i.name.toLowerCase() === newStock.name.trim().toLowerCase()
    );

    let updatedInv = [...inventory];

    if (existingIndex >= 0) {
      const existing = inventory[existingIndex];
      let updatedBatches = [...(existing.batches || [])];

      if (newPrice > existing.price && existing.qty > 0) {
        updatedBatches = updatedBatches.map((b) => ({ ...b, price: newPrice }));
        showMessage(
          `Tumaas ang puhunan! Ang buong stock ay itinaas na sa ₱${newPrice.toFixed(2)}.`,
          'success'
        );
      } else if (newPrice < existing.price && existing.qty > 0) {
        showMessage(
          `Naka-save! Mananatili ang ₱${existing.price.toFixed(2)} hanggang maubos ang ${existing.qty} pcs na lumang stock.`,
          'success'
        );
      } else {
        showMessage(`Nadagdagan ng ${qtyNum} pcs ang ${existing.name}!`, 'success');
      }

      updatedBatches.push({
        qty: qtyNum,
        cost: finalUnitCost,
        price: newPrice,
        expiryDate: newStock.expiryDate.trim() || ''
      });

      updatedInv[existingIndex] = normalizeItem({
        ...existing,
        barcode: cleanBarcode || existing.barcode,
        isFavorite: Boolean(newStock.isFavorite),
        batches: updatedBatches
      });
    } else {
      const id = createItemId();
      const newItem = normalizeItem({
        id,
        barcode: cleanBarcode || `ITEM-${id}`,
        name: newStock.name.trim(),
        isFavorite: Boolean(newStock.isFavorite),
        batches: [
          {
            qty: qtyNum,
            cost: finalUnitCost,
            price: newPrice,
            expiryDate: newStock.expiryDate.trim() || ''
          }
        ]
      });
      updatedInv = [...inventory, newItem];
      showMessage(`Bagong paninda na-save: ${newItem.name}`, 'success');
    }

    setInventory(updatedInv);
    playBeep('success');
    syncToSheets('addStock', {
      item: { ...newStock, packCost: finalPackCost.toFixed(2) },
      inventory: updatedInv
    });

    setNewStock({
      barcode: '',
      name: '',
      qty: '',
      packCost: '',
      unitCost: '',
      targetProfit: '',
      targetPrice: '',
      expiryDate: '',
      isFavorite: false
    });
  };

  const handleRemoveExpiredBatch = (itemId, batchIndex) => {
    const targetItem = inventory.find((i) => i.id === itemId);
    if (!targetItem) return;
    const targetBatch = targetItem.batches[batchIndex];
    if (!targetBatch) return;

    if (
      !window.confirm(
        `Alisin sa stock ang ${targetBatch.qty} pcs ng ${targetItem.name} (Expiry: ${targetBatch.expiryDate})?`
      )
    ) {
      return;
    }

    const updatedInv = inventory.map((item) => {
      if (item.id !== itemId) return item;
      const remainingBatches = item.batches.filter((_, idx) => idx !== batchIndex);
      return normalizeItem({ ...item, batches: remainingBatches });
    });

    setInventory(updatedInv);
    playBeep('success');
    syncToSheets('recordExpired', {
      name: targetItem.name,
      qty: targetBatch.qty,
      lossCost: targetBatch.qty * targetBatch.cost,
      expiryDate: targetBatch.expiryDate,
      inventory: updatedInv
    });
    showMessage(
      `Inalis na ang ${targetBatch.qty} pcs na expired/nasirang ${targetItem.name}.`,
      'success'
    );
  };

  const handleDeleteInventoryItem = (item) => {
    if (
      !window.confirm(
        `Sigurado ka bang buburahin na sa listahan ng paninda ang "${item.name}"?`
      )
    ) {
      return;
    }

    const updatedInv = inventory.filter((i) => i.id !== item.id);
    setInventory(updatedInv);
    playBeep('success');
    syncToSheets('deleteItem', {
      deletedName: item.name,
      inventory: updatedInv
    });
    showMessage(`Binura na sa inventory ang "${item.name}".`, 'success');
  };

  // ==========================================
  // 🎨 COMPUTED VALUES FOR RENDER
  // ==========================================
  const cartSubtotal = cart.reduce((sum, item) => sum + item.price * item.cartQty, 0);
  const cartCostTotal = cart.reduce((sum, cartItem) => {
    if (cartItem.isService) return sum;
    const invItem = inventory.find((i) => i.id === cartItem.id);
    const unitCost = invItem ? invItem.cost : cartItem.cost || 0;
    return sum + unitCost * cartItem.cartQty;
  }, 0);
  const maxProfitDiscount = Math.max(0, cartSubtotal - cartCostTotal);
  const validDiscount = Math.min(
    cartSubtotal,
    Math.max(0, parseFloat(discountAmount) || 0)
  );
  const cartTotal = Math.max(0, cartSubtotal - validDiscount);
  const cartItemCount = cart.reduce((sum, item) => sum + item.cartQty, 0);
  const sukliAmount =
    parseFloat(cashTendered) >= cartTotal ? parseFloat(cashTendered) - cartTotal : null;

  // Compute Tanggal-Butal (Round down to nearest ₱5 or ₱10)
  const butalTo5 = cartSubtotal > 5 ? Number((cartSubtotal % 5).toFixed(2)) : 0;
  const butalTo10 = cartSubtotal > 10 ? Number((cartSubtotal % 10).toFixed(2)) : 0;

  const filteredInventory = inventory.filter(
    (item) =>
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.barcode === searchQuery.trim()
  );

  const stockSuggestions = newStock.name.trim()
    ? inventory
        .filter(
          (item) =>
            item.name.toLowerCase().includes(newStock.name.trim().toLowerCase()) ||
            item.barcode.includes(newStock.name.trim())
        )
        .slice(0, 8)
    : [];

  // ⭐ Mga naka-Favorite 
  const noBarcodeItems = inventory.filter((i) => i.isFavorite);

  // Out of Stock
  const lowStockItems = inventory.filter((item) => item.qty === 0);

  // 📅 MM/YY Expiration Checker (Mag-e-expire ngayong buwan, susunod na buwan, o expired na)
  const expiringBatches = inventory.flatMap((item) =>
    (item.batches || [])
      .map((batch, batchIndex) => {
        if (!batch.expiryDate) return null;
        const match = String(batch.expiryDate).match(/^(\d{2})\/(\d{2})$/);
        if (!match) return null;

        const expMonth = parseInt(match[1], 10);
        const expYear = 2000 + parseInt(match[2], 10);
        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();

        const monthsLeft = (expYear - currentYear) * 12 + (expMonth - currentMonth);
        if (monthsLeft > 1) return null; // Ipakita lang kung 1 buwan o mas mababa na lang

        return {
          itemId: item.id,
          name: item.name,
          batchIndex,
          qty: batch.qty,
          cost: batch.cost,
          price: batch.price,
          expiryDate: batch.expiryDate,
          daysLeft: monthsLeft // <= 0 means ngayong buwan o lampas na
        };
      })
      .filter(Boolean)
  );
  const matchedExistingStock = inventory.find(
    (i) =>
      (newStock.barcode.trim() && i.barcode === newStock.barcode.trim()) ||
      (newStock.name.trim() && i.name.toLowerCase() === newStock.name.trim().toLowerCase())
  );

  const scrollToCart = () => {
    cartSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="min-h-screen bg-gray-100 font-sans pb-28 sm:pb-20">
      {/* COMPACT MOBILE-FRIENDLY HEADER */}
      <header className="bg-emerald-700 text-white shadow-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-3 py-2 sm:p-4 flex justify-between items-center gap-2">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-3xl font-black tracking-wide truncate">
              🏪 Tindahan POS
            </h1>
            <p className="text-emerald-100 text-xs sm:text-sm font-bold truncate">
              Status: {syncStatus}
            </p>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            {SCRIPT_URL && (
              <button
                onClick={() => pullFromSheets(true)}
                className="bg-emerald-800 hover:bg-emerald-900 px-2.5 py-2 sm:px-4 sm:py-3 rounded-xl sm:rounded-2xl font-bold flex items-center gap-1.5 text-xs sm:text-base active:scale-95 transition"
              >
                <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5" />
                <span>I-Sync</span>
              </button>
            )}
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`px-2.5 py-2 sm:px-4 sm:py-3 rounded-xl sm:rounded-2xl font-bold flex items-center gap-1.5 transition text-xs sm:text-base active:scale-95 ${
                soundEnabled ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {soundEnabled ? (
                <Volume2 className="w-4 h-4 sm:w-6 sm:h-6" />
              ) : (
                <VolumeX className="w-4 h-4 sm:w-6 sm:h-6" />
              )}
              <span className="hidden sm:inline">
                {soundEnabled ? 'Tunog: Bukas' : 'Tunog: Patay'}
              </span>
              <span className="sm:hidden">{soundEnabled ? 'Tunog' : 'Mute'}</span>
            </button>
          </div>
        </div>

        {/* 3 SIDE-BY-SIDE TABS (NEVER STACKS VERTICALLY ON MOBILE) */}
        <div className="grid grid-cols-3 max-w-6xl mx-auto border-t border-emerald-600/60">
          <button
            onClick={() => setActiveTab('sell')}
            className={`py-2.5 sm:py-4 px-1 text-xs sm:text-2xl font-black flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2.5 transition-colors ${
              activeTab === 'sell'
                ? 'bg-white text-emerald-800 border-b-4 border-emerald-800'
                : 'text-emerald-50 hover:bg-emerald-600'
            }`}
          >
            <ShoppingCart className="w-5 h-5 sm:w-7 sm:h-7" />
            <span>1. MAGBENTA</span>
          </button>
          <button
            onClick={() => setActiveTab('stock')}
            className={`py-2.5 sm:py-4 px-1 text-xs sm:text-2xl font-black flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2.5 transition-colors ${
              activeTab === 'stock'
                ? 'bg-white text-emerald-800 border-b-4 border-emerald-800'
                : 'text-emerald-50 hover:bg-emerald-600'
            }`}
          >
            <PlusCircle className="w-5 h-5 sm:w-7 sm:h-7" />
            <span className="truncate">2. STOCK</span>
          </button>
          <button
            onClick={() => setActiveTab('reports')}
            className={`py-2.5 sm:py-4 px-1 text-xs sm:text-2xl font-black flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2.5 transition-colors ${
              activeTab === 'reports'
                ? 'bg-white text-emerald-800 border-b-4 border-emerald-800'
                : 'text-emerald-50 hover:bg-emerald-600'
            }`}
          >
            <FileSpreadsheet className="w-5 h-5 sm:w-7 sm:h-7" />
            <span className="truncate">3. KITA & LISTA</span>
          </button>
        </div>
      </header>

      {/* FLOATING TOAST ALERT */}
      {message && (
        <div
          className={`fixed top-28 sm:top-36 left-1/2 transform -translate-x-1/2 px-5 py-3 sm:px-8 sm:py-4 rounded-2xl shadow-2xl z-50 text-base sm:text-2xl font-black text-white text-center transition-all w-[92%] max-w-xl ${
            message.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'
          }`}
        >
          {message.text}
        </div>
      )}

      <main className="max-w-6xl mx-auto mt-4 sm:mt-8 px-3 sm:px-4">
        {/* ==================== TAB 1: MAGBENTA ==================== */}
        {activeTab === 'sell' && (
          <div className="flex flex-col lg:flex-row gap-5 sm:gap-8">
            {/* LEFT COLUMN: SEARCH + 3 QUICK DRAWERS */}
            <div className="flex-1 space-y-4 sm:space-y-5">
              {/* SEARCH BAR + MOBILE CAMERA SCANNER */}
              <div className="bg-white p-4 sm:p-6 rounded-2xl sm:rounded-3xl shadow-md border-2 sm:border-4 border-emerald-100 space-y-3">
                <div className="flex justify-between items-center gap-2">
                  <label className="block text-gray-800 font-black text-lg sm:text-3xl">
                    🔍 I-scan o I-type ang Paninda:
                  </label>
                  <button
                    type="button"
                    onClick={() => (cameraOpen ? stopCamera() : startCamera())}
                    className={`px-3.5 py-2.5 sm:px-5 sm:py-3 rounded-xl sm:rounded-2xl font-black text-xs sm:text-lg flex items-center gap-2 shadow-sm transition shrink-0 ${
                      cameraOpen
                        ? 'bg-red-600 text-white hover:bg-red-700'
                        : 'bg-emerald-600 text-white hover:bg-emerald-700'
                    }`}
                  >
                    {cameraOpen ? (
                      <>
                        <CameraOff className="w-5 h-5 sm:w-6 sm:h-6" />
                        <span></span>
                      </>
                    ) : (
                      <>
                        <Camera className="w-5 h-5 sm:w-6 sm:h-6" />
                        <span></span>
                      </>
                    )}
                  </button>
                </div>

                {/* LIVE CAMERA VIEWFINDER (CONTINUOUS SCANNING) */}
                {cameraOpen && (
                  <div className="relative rounded-2xl overflow-hidden bg-black border-4 border-emerald-500 shadow-inner">
                    <video
                      ref={videoRef}
                      playsInline
                      muted
                      className="w-full h-52 sm:h-64 object-cover"
                    />
                    {/* Green Target Box Overlay */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-3/4 h-24 border-4 border-emerald-400 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
                    </div>
                    <div className="bg-gray-900/90 text-white px-4 py-2.5 flex justify-between items-center text-xs sm:text-base font-bold">
                      <span>🟢 Itapat ang barcode sa berdeng kahon (Tuloy-tuloy ang scan)</span>
                      {lastScannedText && (
                        <span className="bg-emerald-600 px-2.5 py-1 rounded-lg font-black">
                          ✓ {lastScannedText}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="relative">
                  <Search className="absolute left-3.5 sm:left-6 top-1/2 -translate-y-1/2 text-emerald-500 w-6 h-6 sm:w-10 sm:h-10" />
                  <input
                    type="text"
                    className="w-full text-xl sm:text-4xl py-3 sm:p-5 pl-11 sm:pl-20 pr-11 border-2 sm:border-4 border-emerald-300 rounded-xl sm:rounded-2xl focus:outline-none focus:border-emerald-600 bg-gray-50 font-bold"
                    placeholder="Hal. Canton, Nescafe..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 sm:right-5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-red-600 bg-gray-200 rounded-full p-1.5 sm:p-2"
                    >
                      <X className="w-5 h-5 sm:w-8 sm:h-8" />
                    </button>
                  )}
                </div>
              </div>

              {/* SEARCH RESULTS: ONLY SHOWN WHEN TYPING */}
              {searchQuery && (
                <div className="bg-white rounded-2xl sm:rounded-3xl shadow-lg border-2 border-gray-200 overflow-hidden">
                  {filteredInventory.length > 0 ? (
                    filteredInventory.map((item) => (
                      <div
                        key={item.id}
                        className="p-4 sm:p-6 border-b-2 border-gray-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4 bg-white hover:bg-emerald-50"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => toggleFavorite(item.id)}
                              title="Ilagay o alisin sa Tingi / Paborito"
                              className={`p-1.5 rounded-xl border-2 transition ${
                                item.isFavorite
                                  ? 'bg-amber-400 text-white border-amber-500'
                                  : 'bg-gray-100 text-gray-400 border-gray-200 hover:text-amber-500'
                              }`}
                            >
                              <Star className="w-5 h-5 fill-current" />
                            </button>
                            <h3 className="text-xl sm:text-3xl font-black text-gray-800">
                              {item.name}
                            </h3>
                          </div>
                          <p className="text-gray-500 text-sm sm:text-xl mt-1 font-bold flex flex-wrap items-center gap-1.5">
                            <Package className="w-4 h-4 sm:w-6 sm:h-6" /> Stock: {item.qty} pcs
                            {item.batches && item.batches.length > 1 && (
                              <span className="text-amber-600">
                                ({item.batches[0].qty} pcs sa lumang presyo)
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
                          <span className="text-2xl sm:text-4xl font-black text-emerald-700">
                            ₱{item.price.toFixed(2)}
                          </span>
                          <button
                            onClick={() => addToCart(item)}
                            disabled={item.qty <= 0}
                            className="bg-emerald-600 text-white px-5 py-3 sm:px-8 sm:py-5 rounded-xl sm:rounded-2xl text-lg sm:text-2xl font-black hover:bg-emerald-700 disabled:bg-gray-400 shadow-md active:scale-95 transition-transform"
                          >
                            {item.qty > 0 ? '+ IDAGDAG' : 'UBOS NA'}
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-6 sm:p-10 text-center space-y-3 sm:space-y-4">
                      <p className="text-gray-600 text-lg sm:text-2xl font-bold">
                        Walang nahanap na "{searchQuery}".
                      </p>
                      <button
                        onClick={() => {
                          setActiveTab('stock');
                          setNewStock((prev) => ({ ...prev, name: searchQuery }));
                          setSearchQuery('');
                        }}
                        className="bg-emerald-100 text-emerald-800 px-5 py-3 sm:px-6 sm:py-4 rounded-xl sm:rounded-2xl text-base sm:text-xl font-black hover:bg-emerald-200"
                      >
                        + Idagdag bilang Bagong Paninda
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 3 SIDE-BY-SIDE QUICK BUTTONS ON BOTH MOBILE & DESKTOP */}
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setActiveDrawer(activeDrawer === 'tingi' ? null : 'tingi')
                  }
                  className={`p-2.5 sm:p-4 rounded-xl sm:rounded-2xl border-2 sm:border-4 font-black text-xs sm:text-xl flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 transition shadow-sm text-center ${
                    activeDrawer === 'tingi'
                      ? 'bg-amber-500 text-white border-amber-700'
                      : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
                  }`}
                >
                  <span className="text-lg sm:text-xl">🥚</span>
                  <span className="leading-tight">Paborito ({noBarcodeItems.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setActiveDrawer(activeDrawer === 'gcash' ? null : 'gcash')
                  }
                  className={`p-2.5 sm:p-4 rounded-xl sm:rounded-2xl border-2 sm:border-4 font-black text-xs sm:text-xl flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 transition shadow-sm text-center ${
                    activeDrawer === 'gcash'
                      ? 'bg-blue-600 text-white border-blue-800'
                      : 'bg-blue-50 text-blue-900 border-blue-300 hover:bg-blue-100'
                  }`}
                >
                  <Smartphone className="w-5 h-5 sm:w-6 sm:h-6" />
                  <span className="leading-tight">GCash / Load</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setActiveDrawer(activeDrawer === 'print' ? null : 'print')
                  }
                  className={`p-2.5 sm:p-4 rounded-xl sm:rounded-2xl border-2 sm:border-4 font-black text-xs sm:text-xl flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 transition shadow-sm text-center ${
                    activeDrawer === 'print'
                      ? 'bg-purple-600 text-white border-purple-800'
                      : 'bg-purple-50 text-purple-900 border-purple-300 hover:bg-purple-100'
                  }`}
                >
                  <Printer className="w-5 h-5 sm:w-6 sm:h-6" />
                  <span className="leading-tight">Print / Xerox</span>
                </button>
              </div>

              {/* DRAWER 1: WALANG BARCODE / TINGI */}
              {activeDrawer === 'tingi' && (
                <div className="bg-white p-4 sm:p-6 rounded-2xl sm:rounded-3xl border-2 sm:border-4 border-amber-300 shadow-lg space-y-3 sm:space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-lg sm:text-2xl font-black text-amber-900">
                      🥚 Paborito
                    </h3>
                    <button
                      onClick={() => setActiveDrawer(null)}
                      className="text-gray-500 hover:text-gray-800 font-bold text-sm sm:text-lg px-2 py-1 bg-gray-100 rounded-lg"
                    >
                      Isara ✕
                    </button>
                  </div>
                  {noBarcodeItems.length === 0 ? (
                    <p className="text-gray-500 text-base sm:text-xl font-bold py-3">
                      Wala pang naka-save na panindang walang barcode. Sa "2. STOCK", iwanang blanko ang Barcode para lumabas dito (hal. Yelo, Itlog, Mantika).
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3">
                      {noBarcodeItems.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => addToCart(item)}
                          disabled={item.qty <= 0}
                          className="p-3 sm:p-4 rounded-xl sm:rounded-2xl border-2 border-amber-200 bg-amber-50 hover:bg-emerald-50 hover:border-emerald-400 text-left flex flex-col justify-between active:scale-95 transition disabled:opacity-40"
                        >
                          <span className="text-base sm:text-xl font-black text-gray-800 leading-snug">
                            {item.name}
                          </span>
                          <div className="mt-2 flex justify-between items-end">
                            <span className="text-lg sm:text-2xl font-black text-emerald-700">
                              ₱{item.price.toFixed(2)}
                            </span>
                            <span className="text-xs sm:text-sm font-bold text-gray-500">
                              {item.qty} pcs
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* DRAWER 2: GCASH / BANK & E-LOAD (+₱5 FIXED FEE) */}
              {activeDrawer === 'gcash' && (
                <div className="bg-white p-4 sm:p-6 rounded-2xl sm:rounded-3xl border-2 sm:border-4 border-blue-300 shadow-lg space-y-4 sm:space-y-5">
                  <div className="flex justify-between items-center">
                    <h3 className="text-lg sm:text-2xl font-black text-blue-900 flex items-center gap-2">
                      <Smartphone className="w-6 h-6 sm:w-7 sm:h-7" /> GCash, Bank at E-Load
                    </h3>
                    <button
                      onClick={() => setActiveDrawer(null)}
                      className="text-gray-500 hover:text-gray-800 font-bold text-sm sm:text-lg px-2 py-1 bg-gray-100 rounded-lg"
                    >
                      Isara ✕
                    </button>
                  </div>

                  {/* 3 MODE BUTTONS: CASH-IN, CASH-OUT, E-LOAD */}
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    <button
                      type="button"
                      onClick={() => selectGcashMode('CASH-IN')}
                      className={`py-3 sm:py-4 px-2 rounded-xl sm:rounded-2xl font-black text-xs sm:text-xl border-2 sm:border-4 transition ${
                        gcashType === 'CASH-IN'
                          ? 'bg-blue-600 text-white border-blue-800 shadow-md'
                          : 'bg-gray-100 text-gray-700 border-gray-300'
                      }`}
                    >
                      📥 CASH-IN
                    </button>
                    <button
                      type="button"
                      onClick={() => selectGcashMode('CASH-OUT')}
                      className={`py-3 sm:py-4 px-2 rounded-xl sm:rounded-2xl font-black text-xs sm:text-xl border-2 sm:border-4 transition ${
                        gcashType === 'CASH-OUT'
                          ? 'bg-indigo-600 text-white border-indigo-800 shadow-md'
                          : 'bg-gray-100 text-gray-700 border-gray-300'
                      }`}
                    >
                      📤 CASH-OUT
                    </button>
                    <button
                      type="button"
                      onClick={() => selectGcashMode('E-LOAD')}
                      className={`py-3 sm:py-4 px-2 rounded-xl sm:rounded-2xl font-black text-xs sm:text-xl border-2 sm:border-4 transition ${
                        gcashType === 'E-LOAD'
                          ? 'bg-emerald-600 text-white border-emerald-800 shadow-md'
                          : 'bg-gray-100 text-gray-700 border-gray-300'
                      }`}
                    >
                      📲 E-LOAD (+₱5)
                    </button>
                  </div>

                  <div>
                    <label className="block text-gray-700 font-black mb-2 text-sm sm:text-lg">
                      {gcashType === 'E-LOAD'
                        ? 'Pumili o I-type ang Load (Laging +₱5 Tubo):'
                        : 'Pumili o I-type ang Halaga ng GCash/Bank (₱):'}
                    </label>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
                      {(gcashType === 'E-LOAD'
                        ? [10, 15, 20, 30, 50, 100]
                        : [100, 200, 500, 1000, 2000, 5000]
                      ).map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => handleGcashAmountChange(String(amt))}
                          className={`py-2 rounded-xl font-black text-sm sm:text-lg border-2 ${
                            Number(gcashAmount) === amt
                              ? 'bg-blue-600 text-white border-blue-700'
                              : 'bg-blue-50 text-blue-900 border-blue-200 hover:bg-blue-100'
                          }`}
                        >
                          ₱{amt}
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:gap-4">
                      <div>
                        <span className="text-gray-600 font-bold text-xs sm:text-base">
                          {gcashType === 'E-LOAD' ? 'Halaga ng Load (₱):' : 'Halaga (₱):'}
                        </span>
                        <input
                          type="number"
                          value={gcashAmount}
                          onChange={(e) => handleGcashAmountChange(e.target.value)}
                          placeholder={gcashType === 'E-LOAD' ? '50' : '1000'}
                          className="w-full mt-1 p-3 sm:p-4 border-2 sm:border-4 border-blue-300 rounded-xl sm:rounded-2xl text-xl sm:text-3xl font-black text-center"
                        />
                      </div>
                      <div>
                        <span className="text-gray-600 font-bold text-xs sm:text-base">
                          Tubo / Patong Mo (₱):
                        </span>
                        <input
                          type="number"
                          value={gcashFee}
                          onChange={(e) => setGcashFee(e.target.value)}
                          placeholder={gcashType === 'E-LOAD' ? '5' : '20'}
                          className="w-full mt-1 p-3 sm:p-4 border-2 sm:border-4 border-emerald-400 rounded-xl sm:rounded-2xl text-xl sm:text-3xl font-black text-emerald-700 text-center"
                        />
                      </div>
                    </div>
                  </div>

                  {parseFloat(gcashAmount) > 0 && (
                    <div className="bg-blue-50 p-3 sm:p-4 rounded-xl sm:rounded-2xl border-2 border-blue-300 space-y-1">
                      {gcashType === 'CASH-IN' && (
                        <>
                          <p className="text-base sm:text-xl font-black text-blue-900">
                            💵 Kunin sa Customer: ₱
                            {(
                              parseFloat(gcashAmount) + (parseFloat(gcashFee) || 0)
                            ).toFixed(2)}
                          </p>
                          <p className="text-sm sm:text-lg font-bold text-gray-700">
                            📱 I-send sa GCash/Bank: ₱
                            {parseFloat(gcashAmount).toFixed(2)}
                          </p>
                        </>
                      )}
                      {gcashType === 'CASH-OUT' && (
                        <>
                          <p className="text-base sm:text-xl font-black text-indigo-900">
                            💵 Ibigay na Cash: ₱
                            {parseFloat(gcashAmount).toFixed(2)}
                          </p>
                          <p className="text-sm sm:text-lg font-bold text-emerald-700">
                            ✅ Kunin na Tubo / Fee: ₱
                            {(parseFloat(gcashFee) || 0).toFixed(2)}
                          </p>
                        </>
                      )}
                      {gcashType === 'E-LOAD' && (
                        <>
                          <p className="text-base sm:text-xl font-black text-emerald-900">
                            💵 Kunin na Bayad sa Load: ₱
                            {(
                              parseFloat(gcashAmount) + (parseFloat(gcashFee) || 0)
                            ).toFixed(2)}
                          </p>
                          <p className="text-sm sm:text-lg font-bold text-gray-700">
                            📲 I-load sa Customer: ₱{parseFloat(gcashAmount).toFixed(2)} (Tubo: +₱{(parseFloat(gcashFee) || 0).toFixed(2)})
                          </p>
                        </>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleRecordGcash}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black text-lg sm:text-2xl py-4 sm:py-5 rounded-xl sm:rounded-2xl shadow-lg flex justify-center items-center gap-2"
                  >
                    <Check className="w-6 h-6 sm:w-8 sm:h-8" /> I-REKORD ANG {gcashType}
                  </button>
                </div>
              )}

              {/* DRAWER 3: PRINT / XEROX / SCAN SERVICES */}
              {activeDrawer === 'print' && (
                <div className="bg-white p-4 sm:p-6 rounded-2xl sm:rounded-3xl border-2 sm:border-4 border-purple-300 shadow-lg space-y-4 sm:space-y-5">
                  <div className="flex justify-between items-center">
                    <h3 className="text-lg sm:text-2xl font-black text-purple-900 flex items-center gap-2">
                      <Printer className="w-6 h-6 sm:w-7 sm:h-7" /> Print, Xerox at Scan
                    </h3>
                    <button
                      onClick={() => setActiveDrawer(null)}
                      className="text-gray-500 hover:text-gray-800 font-bold text-sm sm:text-lg px-2 py-1 bg-gray-100 rounded-lg"
                    >
                      Isara ✕
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                    {PRINT_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => handleAddPrintPreset(preset)}
                        className="p-3 sm:p-4 rounded-xl sm:rounded-2xl border-2 border-purple-300 bg-purple-50 hover:bg-purple-100 text-left flex justify-between items-center active:scale-95 transition gap-2"
                      >
                        <div className="min-w-0">
                          <span className="block text-sm sm:text-xl font-black text-gray-800 leading-tight">
                            {preset.label}
                          </span>
                          <span className="text-xs sm:text-sm font-bold text-purple-700">
                            + Idagdag
                          </span>
                        </div>
                        <span className="text-xl sm:text-3xl font-black text-purple-800 shrink-0">
                          ₱{preset.price}
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="bg-gray-50 p-3.5 sm:p-4 rounded-xl sm:rounded-2xl border-2 border-gray-200 space-y-3">
                    <label className="block text-gray-700 font-black text-sm sm:text-lg">
                      Ibang Presyo o Maraming Pahina:
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3">
                      <div className="col-span-2 sm:col-span-1">
                        <span className="text-xs sm:text-sm font-bold text-gray-600">
                          Serbisyo:
                        </span>
                        <input
                          type="text"
                          value={customPrintName}
                          onChange={(e) => setCustomPrintName(e.target.value)}
                          className="w-full p-2.5 sm:p-3 border-2 border-gray-300 rounded-xl font-bold text-base sm:text-lg bg-white"
                        />
                      </div>
                      <div>
                        <span className="text-xs sm:text-sm font-bold text-gray-600">
                          Ilang Piraso:
                        </span>
                        <input
                          type="number"
                          value={customPrintQty}
                          onChange={(e) => setCustomPrintQty(e.target.value)}
                          className="w-full p-2.5 sm:p-3 border-2 border-gray-300 rounded-xl font-black text-lg sm:text-xl text-center bg-white"
                        />
                      </div>
                      <div>
                        <span className="text-xs sm:text-sm font-bold text-gray-600">
                          Presyo/Isa (₱):
                        </span>
                        <input
                          type="number"
                          value={customPrintPrice}
                          onChange={(e) => setCustomPrintPrice(e.target.value)}
                          placeholder="0.00"
                          className="w-full p-2.5 sm:p-3 border-2 border-purple-400 rounded-xl font-black text-lg sm:text-xl text-center bg-white"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleAddCustomPrint}
                      className="w-full bg-purple-600 hover:bg-purple-700 text-white font-black text-base sm:text-xl py-3 rounded-xl"
                    >
                      + Idagdag sa Basket
                    </button>
                  </div>
                </div>
              )}

            </div>

            {/* RIGHT COLUMN: GIANT BASKET & SUKLI CALCULATOR */}
            <div ref={cartSectionRef} className="w-full lg:w-[460px] scroll-mt-28">
              <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl border-2 sm:border-4 border-gray-200 overflow-hidden lg:sticky lg:top-36">
                <div className="bg-gray-800 text-white p-4 sm:p-5 flex justify-between items-center">
                  <h2 className="text-xl sm:text-3xl font-black flex items-center gap-2 sm:gap-3">
                    🛒 Bayarin ({cartItemCount})
                  </h2>
                  {cart.length > 0 && (
                    <button
                      onClick={() => {
                        setCart([]);
                        setCashTendered('');
                        setShowUtangInput(false);
                      }}
                      className="text-xs sm:text-sm bg-gray-700 hover:bg-red-600 px-3 py-1.5 sm:py-2 rounded-xl font-bold"
                    >
                      Burahin Lahat
                    </button>
                  )}
                </div>

                <div className="p-3 sm:p-4 min-h-[180px] sm:min-h-[240px] max-h-[360px] sm:max-h-[400px] overflow-y-auto bg-gray-50 space-y-2.5 sm:space-y-3">
                  {cart.length === 0 ? (
                    <div className="text-center text-gray-400 py-10 sm:py-16">
                      <ShoppingCart className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-2 opacity-20" />
                      <p className="text-lg sm:text-2xl font-bold">Walang laman ang basket</p>
                    </div>
                  ) : (
                    cart.map((item) => (
                      <div
                        key={item.id}
                        className="bg-white p-3 sm:p-4 rounded-xl sm:rounded-2xl shadow-sm border-2 border-gray-100"
                      >
                        <div className="flex justify-between items-start mb-2 sm:mb-3 gap-2">
                          <span className="text-lg sm:text-2xl font-black text-gray-800 leading-snug">
                            {item.name}
                          </span>
                          <button
                            onClick={() =>
                              setCart((prev) => prev.filter((i) => i.id !== item.id))
                            }
                            className="text-red-500 bg-red-50 hover:bg-red-100 p-1.5 sm:p-2 rounded-xl shrink-0"
                          >
                            <X className="w-5 h-5 sm:w-6 sm:h-6" />
                          </button>
                        </div>
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2 sm:gap-3 bg-gray-100 rounded-xl sm:rounded-2xl p-1.5 sm:p-2 border-2 border-gray-200">
                            <button
                              onClick={() => updateCartQty(item.id, -1)}
                              className="p-2 sm:p-3 bg-white shadow-sm rounded-lg sm:rounded-xl text-red-600"
                            >
                              <Minus className="w-4 h-4 sm:w-5 sm:h-5" />
                            </button>
                            <span className="w-8 sm:w-10 text-center font-black text-lg sm:text-2xl">
                              {item.cartQty}
                            </span>
                            <button
                              onClick={() => updateCartQty(item.id, 1)}
                              className="p-2 sm:p-3 bg-white shadow-sm rounded-lg sm:rounded-xl text-emerald-600"
                            >
                              <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
                            </button>
                          </div>
                          <span className="font-black text-emerald-700 text-2xl sm:text-3xl">
                            ₱{(item.price * item.cartQty).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* TOTAL & SUKLI SECTION */}
                <div className="bg-white p-4 sm:p-6 border-t-4 border-gray-200 space-y-3 sm:space-y-4">
                  {/* DISCOUNT / TROPA / TANGGAL-BUTAL SECTION */}
                  {cart.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <button
                          type="button"
                          onClick={() => setShowDiscountBox(!showDiscountBox)}
                          className={`px-3 py-1.5 rounded-xl font-black text-xs sm:text-sm border-2 transition flex items-center gap-1.5 ${
                            validDiscount > 0
                              ? 'bg-purple-600 text-white border-purple-700'
                              : 'bg-purple-50 text-purple-900 border-purple-300 hover:bg-purple-100'
                          }`}
                        >
                          <span>🏷️ {validDiscount > 0 ? `May Discount: -₱${validDiscount.toFixed(2)}` : 'Magbigay Discount'}</span>
                        </button>
                        {validDiscount > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setDiscountAmount('');
                              setShowDiscountBox(false);
                            }}
                            className="text-xs font-bold text-red-600 hover:underline"
                          >
                            Alisin ang Discount ✕
                          </button>
                        )}
                      </div>

                      {showDiscountBox && (
                        <div className="bg-purple-50 p-3 rounded-2xl border-2 border-purple-300 space-y-2.5">
                          <label className="block text-purple-900 font-black text-xs sm:text-sm">
                            Pumili ng Discount:
                          </label>

                          <div className="flex flex-wrap gap-1.5">
                            {/* TANGGAL BUTAL BUTTONS */}
                            {butalTo5 > 0 && (
                              <button
                                type="button"
                                onClick={() => setDiscountAmount(String(butalTo5))}
                                className="px-2.5 py-1.5 bg-amber-200 hover:bg-amber-300 text-amber-950 rounded-xl font-black text-xs border border-amber-400"
                              >
                                Tanggal Butal (-₱{butalTo5} ➔ ₱{(cartSubtotal - butalTo5).toFixed(0)})
                              </button>
                            )}
                            {butalTo10 > 0 && butalTo10 !== butalTo5 && (
                              <button
                                type="button"
                                onClick={() => setDiscountAmount(String(butalTo10))}
                                className="px-2.5 py-1.5 bg-amber-200 hover:bg-amber-300 text-amber-950 rounded-xl font-black text-xs border border-amber-400"
                              >
                                Tanggal Butal (-₱{butalTo10} ➔ ₱{(cartSubtotal - butalTo10).toFixed(0)})
                              </button>
                            )}

                            {/* BALIK-PUHUNAN (TROPA / FAMILY COST PRICE) */}
                            {maxProfitDiscount > 0 && (
                              <button
                                type="button"
                                onClick={() => setDiscountAmount(maxProfitDiscount.toFixed(2))}
                                className="px-2.5 py-1.5 bg-pink-200 hover:bg-pink-300 text-pink-950 rounded-xl font-black text-xs border border-pink-400"
                              >
                                Libre (-₱{maxProfitDiscount.toFixed(2)})
                              </button>
                            )}

                            {/* FIXED PESO DISCOUNTS */}
                            {[5, 10, 20]
                              .filter((d) => d < cartSubtotal)
                              .map((d) => (
                                <button
                                  key={d}
                                  type="button"
                                  onClick={() => setDiscountAmount(String(d))}
                                  className={`px-2.5 py-1.5 rounded-xl font-black text-xs border ${
                                    Number(discountAmount) === d
                                      ? 'bg-purple-600 text-white border-purple-800'
                                      : 'bg-white text-purple-900 border-purple-300'
                                  }`}
                                >
                                  -₱{d}
                                </button>
                              ))}
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-purple-900 shrink-0">
                              Ibang Halaga (₱):
                            </span>
                            <input
                              type="number"
                              value={discountAmount}
                              onChange={(e) => setDiscountAmount(e.target.value)}
                              placeholder="0.00"
                              className="w-full p-2 rounded-xl border-2 border-purple-300 font-black text-base text-center bg-white"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* KABUUAN DISPLAY */}
                  <div className="flex justify-between items-end">
                    <div>
                      <span className="text-gray-500 text-lg sm:text-2xl font-bold block">
                        KABUUAN:
                      </span>
                      {validDiscount > 0 && (
                        <span className="text-xs sm:text-sm font-bold text-gray-400 line-through">
                          Dating ₱{cartSubtotal.toFixed(2)}
                        </span>
                      )}
                    </div>
                    <span className="text-3xl sm:text-5xl font-black text-gray-900">
                      ₱{cartTotal.toFixed(2)}
                    </span>
                  </div>

                  <button
                    onClick={() => processCheckout(false)}
                    disabled={cart.length === 0}
                    className="w-full bg-emerald-600 text-white text-xl sm:text-3xl font-black py-4 sm:py-5 rounded-xl sm:rounded-2xl shadow-xl hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-gray-300 flex justify-center items-center gap-2 sm:gap-3"
                  >
                    <Check className="w-7 h-7 sm:w-9 sm:h-9" /> BAYARAN NA (CASH)
                  </button>

                  {cart.length > 0 && !showUtangInput && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setShowUtangInput(true)}
                        className="w-full bg-amber-100 text-amber-900 text-sm sm:text-base font-black py-3 px-3 rounded-xl sm:rounded-2xl border-2 border-amber-300 hover:bg-amber-200 flex justify-center items-center gap-1.5"
                      >
                        <BookOpen className="w-5 h-5 shrink-0" />
                        <span>Ilista sa Utang</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleBayadPagmamahal}
                        className="w-full bg-pink-100 text-pink-900 text-sm sm:text-base font-black py-3 px-3 rounded-xl sm:rounded-2xl border-2 border-pink-300 hover:bg-pink-200 flex justify-center items-center gap-1.5 active:scale-95 transition"
                      >
                        <Heart className="w-5 h-5 text-pink-600 fill-pink-600 shrink-0" />
                        <span>Bayad Pagmamahal</span>
                      </button>
                    </div>
                  )}

                  {showUtangInput && (
                    <div className="bg-amber-50 p-3 sm:p-4 rounded-xl sm:rounded-2xl border-2 border-amber-300 space-y-2.5 sm:space-y-3">
                      <label className="block font-black text-amber-900 text-sm sm:text-lg">
                        Pangalan ng Umutang:
                      </label>
                      <input
                        type="text"
                        value={utangCustomer}
                        onChange={(e) => setUtangCustomer(e.target.value)}
                        placeholder="Palayaw o Buong Pangalan"
                        className="w-full p-2.5 sm:p-3 rounded-xl border-2 border-amber-400 text-lg sm:text-2xl font-bold bg-white"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => processCheckout(true)}
                          className="flex-1 bg-amber-600 text-white font-black text-base sm:text-xl py-2.5 sm:py-3 rounded-xl hover:bg-amber-700"
                        >
                          I-Save sa Utang
                        </button>
                        <button
                          onClick={() => setShowUtangInput(false)}
                          className="px-4 bg-gray-200 text-gray-700 font-bold rounded-xl text-sm sm:text-base"
                        >
                          Kansela
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* STICKY MOBILE BOTTOM CHECKOUT BAR */}
            {cart.length > 0 && (
              <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-gray-900 text-white px-4 py-3 shadow-2xl z-40 flex justify-between items-center border-t-2 border-emerald-500">
                <div>
                  <span className="text-xs text-emerald-300 font-bold block">
                    🛒 {cartItemCount} item sa basket
                  </span>
                  <span className="text-2xl font-black">₱{cartTotal.toFixed(2)}</span>
                </div>
                <button
                  onClick={scrollToCart}
                  className="bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-black text-base shadow-md active:scale-95 transition"
                >
                  Bayaran ➔
                </button>
              </div>
            )}
          </div>
        )}

        {/* ==================== TAB 2: DAGDAG STOCK ==================== */}
        {activeTab === 'stock' && (
          <div className="bg-white rounded-2xl sm:rounded-3xl shadow-xl border-2 sm:border-4 border-emerald-100 overflow-hidden">
            <div className="bg-emerald-50 p-4 sm:p-8 border-b-2 sm:border-b-4 border-emerald-100">
              <h2 className="text-xl sm:text-4xl font-black text-emerald-900">
                📦 Magpasok ng Bagong Stock
              </h2>
              <p className="text-emerald-700 text-sm sm:text-xl mt-1 font-semibold">
                I-scan ang barcode o iwanang blanko kung walang barcode (hal. Yelo, Itlog).
              </p>
            </div>

            <div className="p-4 sm:p-8 grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-10">
              {/* LEFT: ITEM DETAILS */}
              <div className="space-y-4 sm:space-y-5">
                <div>
                  <div className="flex justify-between items-center mb-1.5 sm:mb-2">
                    <label className="block text-gray-800 font-black text-base sm:text-2xl">
                      Barcode (I-scan o Blanko):
                    </label>
                    <button
                      type="button"
                      onClick={() => (cameraOpen ? stopCamera() : startCamera())}
                      className={`px-3 py-1.5 rounded-xl font-black text-xs sm:text-base flex items-center gap-1.5 ${
                        cameraOpen
                          ? 'bg-red-600 text-white'
                          : 'bg-emerald-600 text-white'
                      }`}
                    >
                      {cameraOpen ? <CameraOff className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
                      <span>{cameraOpen ? '' : ''}</span>
                    </button>
                  </div>

                  {cameraOpen && (
                    <div className="mb-3 relative rounded-2xl overflow-hidden bg-black border-4 border-emerald-500">
                      <video
                        ref={videoRef}
                        playsInline
                        muted
                        className="w-full h-48 object-cover"
                      />
                      <div className="bg-gray-900 text-white px-3 py-2 text-xs sm:text-sm font-bold text-center">
                        🟢 Itapat ang barcode ng bagong paninda
                      </div>
                    </div>
                  )}

                  <input
                    type="text"
                    value={newStock.barcode}
                    onChange={(e) => {
                      const val = e.target.value;
                      const existing = inventory.find((i) => i.barcode === val.trim());
                      setNewStock((prev) => ({
                        ...prev,
                        barcode: val,
                        name: existing ? existing.name : prev.name,
                        targetPrice: existing ? existing.price.toFixed(2) : prev.targetPrice,
                        isFavorite: existing ? Boolean(existing.isFavorite) : prev.isFavorite
                      }));
                    }}
                    className="w-full p-3.5 sm:p-4 border-2 sm:border-4 border-gray-300 rounded-xl sm:rounded-2xl text-lg sm:text-2xl font-bold focus:border-emerald-500"
                    placeholder="I-scan o iwanang blanko..."
                  />
                </div>

                <div className="relative">
                  <div className="flex justify-between items-center mb-1.5 sm:mb-2">
                    <label className="block text-gray-800 font-black text-base sm:text-2xl">
                      Pangalan ng Paninda:
                    </label>
                    {(newStock.name || newStock.barcode || newStock.qty) && (
                      <button
                        type="button"
                        onClick={() => {
                          setNewStock({
                            barcode: '',
                            name: '',
                            qty: '',
                            packCost: '',
                            unitCost: '',
                            targetProfit: '',
                            targetPrice: '',
                            expiryDate: '',
                            isFavorite: false
                          });
                          setShowStockSuggestions(false);
                        }}
                        className="text-xs sm:text-sm bg-gray-200 hover:bg-red-100 text-gray-700 hover:text-red-700 px-2.5 py-1 rounded-lg font-black"
                      >
                        ✕ I-Clear
                      </button>
                    )}
                  </div>

                  <div className="relative">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-emerald-500 w-5 h-5 sm:w-6 sm:h-6" />
                    <input
                      type="text"
                      value={newStock.name}
                      onFocus={() => setShowStockSuggestions(true)}
                      onChange={(e) => {
                        const val = e.target.value;
                        setShowStockSuggestions(true);
                        const exactMatch = inventory.find(
                          (i) => i.name.toLowerCase() === val.trim().toLowerCase()
                        );
                        setNewStock((prev) => ({
                          ...prev,
                          name: val,
                          unitCost: exactMatch
                            ? exactMatch.cost.toFixed(2)
                            : prev.unitCost,
                          targetPrice: exactMatch
                            ? exactMatch.price.toFixed(2)
                            : prev.targetPrice,
                          isFavorite: exactMatch
                            ? Boolean(exactMatch.isFavorite)
                            : prev.isFavorite
                        }));
                      }}
                      className="w-full p-3.5 sm:p-4 pl-11 sm:pl-12 border-2 sm:border-4 border-gray-300 rounded-xl sm:rounded-2xl text-lg sm:text-2xl font-bold focus:border-emerald-500"
                      placeholder="Type Here..."
                    />
                  </div>

                  {/* AUTO-SUGGEST SEARCH DROPDOWN LIST */}
                  {showStockSuggestions && stockSuggestions.length > 0 && (
                    <div className="absolute z-30 left-0 right-0 mt-1 bg-white rounded-2xl shadow-2xl border-2 border-emerald-400 max-h-64 overflow-y-auto divide-y divide-gray-100">
                      <div className="bg-emerald-50 px-3 py-1.5 flex justify-between items-center text-xs font-black text-emerald-800">
                        <span>Pumili sa Naka-rekord na Paninda (1-Tap Auto-Fill):</span>
                        <button
                          type="button"
                          onClick={() => setShowStockSuggestions(false)}
                          className="text-gray-500 hover:text-gray-800"
                        >
                          Isara ✕
                        </button>
                      </div>
                      {stockSuggestions.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => selectStockSuggestion(item)}
                          className="w-full p-3 text-left hover:bg-emerald-50 flex justify-between items-center gap-2 transition"
                        >
                          <div className="min-w-0">
                            <span className="font-black text-base sm:text-lg text-gray-900 block truncate">
                              {item.name}
                            </span>
                            <span className="text-xs sm:text-sm font-bold text-gray-500">
                              Stock: {item.qty} pcs | Dating Puhunan: ₱{item.cost.toFixed(2)}/pc
                            </span>
                          </div>
                          <span className="font-black text-base sm:text-xl text-emerald-700 shrink-0">
                            ₱{item.price.toFixed(2)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* PAST RECORDED COST & PRICE COMPARISON BOX */}
                  {matchedExistingStock && (
                    <div className="mt-2.5 bg-emerald-50 p-3 sm:p-4 rounded-2xl border-2 border-emerald-300 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-emerald-900 font-black text-sm sm:text-base">
                          📌 Naka-rekord na ({matchedExistingStock.qty} pcs natitira):
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handleUnitCostChange(matchedExistingStock.cost.toFixed(2))
                          }
                          className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 rounded-lg font-black"
                        >
                          Gamitin Dating Puhunan
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div className="bg-white p-2.5 rounded-xl border border-emerald-200">
                          <span className="text-xs font-bold text-gray-500 block">
                            DATING PUHUNAN / PC:
                          </span>
                          <span className="text-lg sm:text-2xl font-black text-gray-800">
                            ₱{matchedExistingStock.cost.toFixed(2)}
                          </span>
                        </div>
                        <div className="bg-white p-2.5 rounded-xl border border-emerald-200">
                          <span className="text-xs font-bold text-gray-500 block">
                            DATING BENTA / PC:
                          </span>
                          <span className="text-lg sm:text-2xl font-black text-emerald-700">
                            ₱{matchedExistingStock.price.toFixed(2)}
                          </span>
                        </div>
                      </div>
                      {unitCostPreview > 0 && (
                        <p
                          className={`text-xs sm:text-sm font-black px-2.5 py-1.5 rounded-lg ${
                            unitCostPreview > matchedExistingStock.cost
                              ? 'bg-red-100 text-red-800'
                              : unitCostPreview < matchedExistingStock.cost
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {unitCostPreview > matchedExistingStock.cost
                            ? `⚠️ Tumaas ang puhunan ng +₱${(
                                unitCostPreview - matchedExistingStock.cost
                              ).toFixed(2)} kada piraso!`
                            : unitCostPreview < matchedExistingStock.cost
                            ? `📉 Mas mura ang bagong puhunan ng -₱${(
                                matchedExistingStock.cost - unitCostPreview
                              ).toFixed(2)} kada piraso!`
                            : '✅ Pareho lang sa dating puhunan kada piraso.'}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* 3. ILANG PIRASO + QUICK ADD PACK BUTTONS + PUHUNAN */}
                <div className="space-y-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-gray-800 font-black mb-1 text-sm sm:text-lg">
                        3. Ilang Piraso?
                      </label>
                      <input
                        type="number"
                        value={newStock.qty}
                        onChange={(e) => handleQtyChange(e.target.value)}
                        className="w-full p-3 sm:p-4 border-2 sm:border-4 border-emerald-400 rounded-xl sm:rounded-2xl text-xl sm:text-2xl font-black text-center focus:border-emerald-600 bg-white"
                        placeholder="-"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-800 font-black mb-1 text-sm sm:text-lg">
                        Pack Price:
                      </label>
                      <input
                        type="number"
                        value={newStock.packCost}
                        onChange={(e) => handlePackCostChange(e.target.value)}
                        className="w-full p-3 sm:p-4 border-2 sm:border-4 border-gray-300 rounded-xl sm:rounded-2xl text-xl sm:text-2xl font-black text-center focus:border-emerald-500"
                        placeholder="-"
                      />
                    </div>
                    <div>
                      <label className="block text-emerald-800 font-black mb-1 text-sm sm:text-lg">
                        Price/pc:
                      </label>
                      <input
                        type="number"
                        value={newStock.unitCost}
                        onChange={(e) => handleUnitCostChange(e.target.value)}
                        className="w-full p-3 sm:p-4 border-2 sm:border-4 border-emerald-400 bg-emerald-50/40 rounded-xl sm:rounded-2xl text-xl sm:text-2xl font-black text-center focus:border-emerald-600"
                        placeholder="-"
                      />
                    </div>
                  </div>

                  {/* MABILISANG DAGDAG BILANG BUTTONS */}
                  <div className="flex flex-wrap items-center gap-1.5 bg-gray-50 p-2.5 rounded-xl border border-gray-200">
                    <span className="text-xs font-black text-gray-600 mr-1">
                      Dagdag Bilang (o i-scan ulit):
                    </span>
                    {[
                      { label: '-1', val: -1 },
                      { label: '+1', val: 1 },
                      { label: '+6', val: 6 },
                      { label: '+10', val: 10 },
                      { label: '+12', val: 12 },
                      { label: '+24', val: 24 }
                    ].map((btn) => (
                      <button
                        key={btn.label}
                        type="button"
                        onClick={() => addQuickStockQty(btn.val)}
                        className={`px-2.5 py-1.5 rounded-lg font-black text-xs sm:text-sm border transition active:scale-95 ${
                          btn.val < 0
                            ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                            : 'bg-emerald-100 text-emerald-900 border-emerald-300 hover:bg-emerald-200'
                        }`}
                      >
                        {btn.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* MM/YY EXPIRATION DATE & FAVORITE STAR TOGGLE */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-gray-800 font-black mb-1 text-sm sm:text-lg">
                      📅 Expiration (Optional):
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={5}
                        value={newStock.expiryDate || ''}
                        onChange={(e) => handleExpiryMMYYChange(e.target.value)}
                        placeholder="MM/YY"
                        className="w-full p-3 border-2 sm:border-4 border-gray-300 rounded-xl sm:rounded-2xl text-lg sm:text-xl font-black text-center focus:border-emerald-500 bg-white"
                      />
                      {newStock.expiryDate && (
                        <button
                          type="button"
                          onClick={() => setNewStock({ ...newStock, expiryDate: '' })}
                          className="px-3 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-xl text-xs sm:text-sm"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() =>
                        setNewStock((prev) => ({ ...prev, isFavorite: !prev.isFavorite }))
                      }
                      className={`w-full p-3 sm:p-3.5 rounded-xl sm:rounded-2xl border-2 sm:border-4 font-black text-sm sm:text-base flex items-center justify-center gap-2 transition ${
                        newStock.isFavorite
                          ? 'bg-amber-400 text-amber-950 border-amber-600 shadow-sm'
                          : 'bg-gray-50 text-gray-600 border-gray-300 hover:bg-amber-50'
                      }`}
                    >
                      <Star
                        className={`w-5 h-5 ${
                          newStock.isFavorite ? 'fill-amber-950' : ''
                        }`}
                      />
                      <span>
                        {newStock.isFavorite
                          ? '⭐'
                          : 'Paborito'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              {/* RIGHT: TUBO & SELLING PRICE CALCULATOR */}
              <div className="bg-gray-100 p-4 sm:p-8 rounded-2xl sm:rounded-3xl border-2 sm:border-4 border-gray-200 space-y-4 sm:space-y-6">
                <h3 className="font-black text-gray-800 text-xl sm:text-3xl">
                  Calculator ng Presyo
                </h3>

                <div className="bg-white p-3.5 sm:p-5 rounded-xl sm:rounded-2xl shadow-sm flex justify-between items-center border-2 border-gray-200">
                  <span className="text-gray-600 text-base sm:text-2xl font-bold">
                    Puhunan kada piraso:
                  </span>
                  <span className="text-2xl sm:text-4xl font-black text-gray-900">
                    ₱{unitCostPreview.toFixed(2)}
                  </span>
                </div>

                <div>
                  <label className="block text-gray-700 font-black mb-2 sm:mb-3 text-sm sm:text-xl">
                    Pumili ng Idadagdag na Tubo kada Piraso:
                  </label>
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    {[1, 2, 3, 5].map((peso) => (
                      <button
                        key={peso}
                        type="button"
                        onClick={() => applyQuickProfit(peso, 'peso')}
                        className="bg-emerald-100 hover:bg-emerald-200 text-emerald-900 font-black text-base sm:text-xl py-2.5 sm:py-3 rounded-xl border-2 border-emerald-300"
                      >
                        + ₱{peso}.00
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => applyQuickProfit(15, 'percent')}
                      className="bg-blue-100 hover:bg-blue-200 text-blue-900 font-black text-base sm:text-xl py-2.5 sm:py-3 rounded-xl border-2 border-blue-300"
                    >
                      + 15%
                    </button>
                    <button
                      type="button"
                      onClick={() => applyQuickProfit(20, 'percent')}
                      className="bg-blue-100 hover:bg-blue-200 text-blue-900 font-black text-base sm:text-xl py-2.5 sm:py-3 rounded-xl border-2 border-blue-300"
                    >
                      + 20%
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex flex-wrap justify-between items-center gap-2 mb-2 sm:mb-3">
                    <label className="text-gray-800 font-black text-base sm:text-2xl">
                      5. Presyo ng Benta:
                    </label>
                    <button
                      type="button"
                      onClick={roundUpSellingPrice}
                      className="bg-amber-100 hover:bg-amber-200 text-amber-900 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl font-black text-xs sm:text-base border-2 border-amber-300"
                    >
                      ⬆️ Gawing Buong Piso
                    </button>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-4 bg-white p-2 rounded-xl sm:rounded-2xl border-2 sm:border-4 border-emerald-500">
                    <span className="text-3xl sm:text-5xl font-black text-gray-400 pl-3 sm:pl-4">
                      ₱
                    </span>
                    <input
                      type="number"
                      value={newStock.targetPrice}
                      onChange={(e) =>
                        setNewStock({ ...newStock, targetPrice: e.target.value })
                      }
                      className="w-full p-2 sm:p-3 text-3xl sm:text-5xl font-black text-emerald-700 outline-none"
                      placeholder="0.00"
                    />
                  </div>
                  {newStock.targetPrice && unitCostPreview > 0 && (
                    <p className="text-emerald-800 font-black text-base sm:text-xl mt-2.5 sm:mt-3">
                      ✅ Malinis na Tubo/pc: ₱
                      {(parseFloat(newStock.targetPrice) - unitCostPreview).toFixed(2)}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="p-4 sm:p-8 bg-gray-50 border-t-2 sm:border-t-4 border-gray-200">
              <button
                onClick={handleSaveStock}
                className="w-full bg-emerald-600 text-white text-xl sm:text-3xl font-black py-4 sm:py-6 rounded-xl sm:rounded-2xl shadow-xl hover:bg-emerald-700 active:bg-emerald-800 flex justify-center items-center gap-3"
              >
                <Save className="w-7 h-7 sm:w-10 sm:h-10" /> I-SAVE ANG BAGONG STOCK
              </button>
            </div>
          </div>
        )}

        {/* ==================== TAB 3: KITA AT LISTAHAN ==================== */}
        {activeTab === 'reports' && (
          <div className="space-y-5 sm:space-y-8">
            {/* DAILY MONEY CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
              <div className="bg-white p-5 sm:p-8 rounded-2xl sm:rounded-3xl shadow-xl border-t-8 border-blue-500">
                <p className="text-gray-500 font-black text-base sm:text-xl mb-1 sm:mb-2">
                  Kabuuang Benta at Serbisyo
                </p>
                <h3 className="text-3xl sm:text-5xl font-black text-gray-900">
                  ₱{dailyStats.sales.toFixed(2)}
                </h3>
              </div>
              <div className="bg-white p-5 sm:p-8 rounded-2xl sm:rounded-3xl shadow-xl border-t-8 border-amber-500">
                <p className="text-gray-500 font-black text-base sm:text-xl mb-1 sm:mb-2">
                  Itatabing Puhunan (Pang-Grocery)
                </p>
                <h3 className="text-3xl sm:text-5xl font-black text-gray-900">
                  ₱{dailyStats.puhunan.toFixed(2)}
                </h3>
                <p className="text-gray-400 font-bold text-xs sm:text-sm mt-1 sm:mt-2">
                  *Hindi kasama ang GCash principal
                </p>
              </div>
              <div className="bg-white p-5 sm:p-8 rounded-2xl sm:rounded-3xl shadow-xl border-t-8 border-emerald-500">
                <p className="text-gray-500 font-black text-base sm:text-xl mb-1 sm:mb-2">
                  Malinis na Tubo (Kabuuang Kita)
                </p>
                <h3 className="text-3xl sm:text-5xl font-black text-emerald-600">
                  ₱{dailyStats.profit.toFixed(2)}
                </h3>
                <p className="text-emerald-700 font-bold text-xs sm:text-sm mt-1 sm:mt-2">
                  Kasama ang ₱{(dailyStats.serviceProfit || 0).toFixed(2)} mula sa GCash at Print
                </p>
              </div>
            </div>

            {/* ACTION BUTTONS: NEW DAY RESET & FULL STORAGE CLEAR */}
            <div className="flex flex-col sm:flex-row justify-end gap-3 sm:gap-4">
              <button
                onClick={() => {
                  if (window.confirm('I-reset ang bilang ng benta at kita para sa bagong araw?')) {
                    setDailyStats({ sales: 0, profit: 0, puhunan: 0, serviceProfit: 0 });
                    setServiceLogs([]);
                    showMessage('Na-reset na ang benta para sa bagong araw!', 'success');
                  }
                }}
                className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-4 py-3 sm:px-6 rounded-xl sm:rounded-2xl font-black text-sm sm:text-lg flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-5 h-5" /> Bagong Araw (Reset Kita Ngayon)
              </button>

            </div>

            {/* RECENT GCASH & PRINT LOGS */}
            {serviceLogs.length > 0 && (
              <div className="bg-white rounded-2xl sm:rounded-3xl shadow-xl border-2 sm:border-4 border-blue-100 overflow-hidden">
                <div className="bg-blue-50 p-4 sm:p-5 border-b-2 border-blue-200">
                  <h3 className="text-lg sm:text-2xl font-black text-blue-900 flex items-center gap-2">
                    <Smartphone className="w-6 h-6" /> Talaan ng GCash / Bank at Print
                  </h3>
                </div>
                <div className="p-4 sm:p-5 grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[260px] overflow-y-auto">
                  {serviceLogs.map((log) => (
                    <div
                      key={log.id}
                      className="p-3 rounded-xl sm:rounded-2xl bg-blue-50/50 border border-blue-200 flex justify-between items-center gap-2"
                    >
                      <div className="min-w-0">
                        <span className="font-black text-base sm:text-lg text-gray-800 block truncate">
                          {log.type}
                        </span>
                        <span className="text-xs sm:text-sm text-gray-500 font-bold">
                          Oras: {log.time} | Halaga: ₱{Number(log.principal).toFixed(2)}
                        </span>
                      </div>
                      <span className="text-base sm:text-xl font-black text-emerald-700 shrink-0">
                        +₱{Number(log.fee).toFixed(2)} Tubo
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            

            {/* UTANG & PAUBOS NA STOCK */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-8">
              {/* LISTA NG UTANG (FIXED MOBILE VIEW) */}
              <div className="bg-white rounded-2xl sm:rounded-3xl shadow-xl border-2 sm:border-4 border-amber-100 overflow-hidden">
                <div className="bg-amber-50 p-4 sm:p-6 border-b-2 border-amber-200">
                  <h3 className="text-lg sm:text-2xl font-black text-amber-900 flex items-center gap-2">
                    <BookOpen className="w-6 h-6 sm:w-7 sm:h-7" /> Lista ng Utang ({utangList.length})
                  </h3>
                </div>
                <div className="p-3 sm:p-6 space-y-3 sm:space-y-4 max-h-[460px] overflow-y-auto">
                  {utangList.length === 0 ? (
                    <p className="text-gray-400 text-base sm:text-xl font-bold text-center py-6 sm:py-8">
                      Walang nakalistang utang.
                    </p>
                  ) : (
                    utangList.map((u) => (
                      <div
                        key={u.id}
                        className="p-3.5 sm:p-4 rounded-2xl bg-amber-50/60 border-2 border-amber-200 space-y-3"
                      >
                        <div className="flex justify-between items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <h4 className="text-lg sm:text-2xl font-black text-gray-900 break-words">
                              {u.customer}
                            </h4>
                            <p className="text-gray-600 font-bold text-xs sm:text-base break-words mt-0.5">
                              {u.itemsSummary}
                            </p>
                            <p className="text-gray-400 text-xs font-semibold mt-1">
                              {u.date}
                            </p>
                          </div>
                          <div className="text-right shrink-0 pl-2">
                            <span className="text-xs font-bold text-amber-700 block">
                              Balanse:
                            </span>
                            <div className="text-xl sm:text-3xl font-black text-amber-800">
                              ₱{u.amount.toFixed(2)}
                            </div>
                          </div>
                        </div>

                        {/* PANTAY NA 2-COLUMN BUTTONS SA MOBILE */}
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              if (activeHulogId === u.id) {
                                setActiveHulogId(null);
                                setHulogAmount('');
                              } else {
                                setActiveHulogId(u.id);
                                setHulogAmount('');
                              }
                            }}
                            className="w-full bg-amber-200 hover:bg-amber-300 text-amber-900 py-2.5 px-3 rounded-xl font-black text-xs sm:text-base flex items-center justify-center gap-1"
                          >
                            <span>💵 Hulog (Partial)</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => markUtangPaid(u)}
                            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 px-3 rounded-xl font-black text-xs sm:text-base flex items-center justify-center gap-1"
                          >
                            <span>✓ Buong Bayad</span>
                          </button>
                        </div>

                        {/* MOBILE-SAFE HULOG INPUT DRAWER (WALANG OVERFLOW) */}
                        {activeHulogId === u.id && (
                          <div className="bg-white p-3 sm:p-4 rounded-xl border-2 border-amber-400 space-y-2.5">
                            <label className="block text-amber-900 font-black text-xs sm:text-base">
                              Magkano ang ihuhulog ni {u.customer}?
                            </label>
                            <div className="flex gap-1.5 flex-wrap">
                              {[10, 20, 50, 100, 200, 500]
                                .filter((amt) => amt < u.amount)
                                .map((amt) => (
                                  <button
                                    key={amt}
                                    type="button"
                                    onClick={() => setHulogAmount(String(amt))}
                                    className={`px-3 py-1.5 rounded-lg font-black text-xs sm:text-sm border ${
                                      Number(hulogAmount) === amt
                                        ? 'bg-amber-500 text-white border-amber-600'
                                        : 'bg-amber-100 hover:bg-amber-200 text-amber-900 border-amber-300'
                                    }`}
                                  >
                                    ₱{amt}
                                  </button>
                                ))}
                            </div>

                            <div className="flex flex-col sm:flex-row gap-2">
                              <input
                                type="number"
                                value={hulogAmount}
                                onChange={(e) => setHulogAmount(e.target.value)}
                                placeholder="Ilagay ang halaga (₱)..."
                                className="w-full min-w-0 p-2.5 sm:p-3 border-2 border-amber-300 rounded-xl font-black text-base sm:text-lg text-center bg-gray-50 focus:bg-white focus:border-amber-500 outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => handlePartialUtangPayment(u)}
                                className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 sm:py-3 rounded-xl font-black text-sm sm:text-base shrink-0 shadow-sm active:scale-95 transition"
                              >
                                ✓ I-Save ang Hulog
                              </button>
                            </div>

                            {parseFloat(hulogAmount) > 0 &&
                              parseFloat(hulogAmount) < u.amount && (
                                <p className="text-xs sm:text-sm font-bold text-gray-600 text-center sm:text-left">
                                  Natitirang balanse:{' '}
                                  <span className="text-amber-800 font-black">
                                    ₱{(u.amount - parseFloat(hulogAmount)).toFixed(2)}
                                  </span>
                                </p>
                              )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="bg-white rounded-2xl sm:rounded-3xl shadow-xl border-2 sm:border-4 border-red-100 overflow-hidden">
                <div className="bg-red-50 p-4 sm:p-6 border-b-2 border-red-200">
                  <h3 className="text-lg sm:text-2xl font-black text-red-900 flex items-center gap-2">
                    <AlertTriangle className="w-6 h-6 sm:w-7 sm:h-7" /> Ubos na Stock ({lowStockItems.length})
                  </h3>
                  <p className="text-red-700 font-semibold text-xs sm:text-base mt-0.5">
                    Mga panindang wala nang stock:
                  </p>
                </div>
                <div className="p-4 sm:p-6 space-y-2.5 sm:space-y-3 max-h-[420px] overflow-y-auto">
                  {lowStockItems.length === 0 ? (
                    <p className="text-gray-400 text-base sm:text-xl font-bold text-center py-6 sm:py-8">
                      Walang paubos na paninda sa ngayon.
                    </p>
                  ) : (
                    lowStockItems.map((item) => (
                      <div
                        key={item.id}
                        className="p-3.5 sm:p-4 rounded-xl sm:rounded-2xl bg-red-50/50 border-2 border-red-200 flex justify-between items-center gap-2"
                      >
                        <div className="min-w-0">
                          <h4 className="text-lg sm:text-2xl font-black text-gray-900 truncate">
                            {item.name}
                          </h4>
                          <p className="text-gray-500 font-bold text-sm sm:text-base">
                            Presyo: ₱{item.price.toFixed(2)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteInventoryItem(item)}
                          className="bg-red-600 hover:bg-red-700 active:scale-95 transition text-white px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-xl font-black text-xs sm:text-base flex items-center gap-1.5 shrink-0 shadow-sm"
                        >
                          <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
                          <span>Burahin</span>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
            
            {/* 🍾 BANTAY BOTE AT DEPOSITO (SOFTDRINKS / BEER) */}
            {(() => {
              const borrowedCount = (boteData.borrowedList || []).reduce(
                (sum, b) => sum + Number(b.qty || 0),
                0
              );
              const inStoreCount = Math.max(0, (boteData.totalOwned || 0) - borrowedCount);
              const totalHeldDeposit = (boteData.borrowedList || []).reduce(
                (sum, b) => sum + Number(b.deposit || 0),
                0
              );

              return (
                <div className="bg-white rounded-2xl sm:rounded-3xl shadow-xl border-2 sm:border-4 border-teal-200 overflow-hidden">
                  <div className="bg-teal-50 p-4 sm:p-6 border-b-2 border-teal-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                      <h3 className="text-lg sm:text-2xl font-black text-teal-900 flex items-center gap-2">
                        <span>🍾 Bantay Bote</span>
                      </h3>
                      <p className="text-teal-700 font-semibold text-xs sm:text-base mt-0.5">
                        Subaybayan ang kabuuang bote, hiram ng customer, at iniwang deposito:
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowBoteForm(!showBoteForm)}
                      className="w-full sm:w-auto bg-teal-600 hover:bg-teal-700 text-white px-4 py-2.5 rounded-xl font-black text-sm sm:text-base shadow-sm"
                    >
                      {showBoteForm ? '✕ Isara' : '+ Maglista ng Hiram na Bote'}
                    </button>
                  </div>

                  <div className="p-4 sm:p-6 space-y-5">
                    {/* 3 BOTE SUMMARY CARDS */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="p-3.5 sm:p-4 rounded-2xl bg-gray-50 border-2 border-gray-200 flex flex-col justify-between">
                        <span className="text-xs sm:text-sm font-black text-gray-500">
                          KABUUANG BOTE NG TINDAHAN
                        </span>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-2xl sm:text-3xl font-black text-gray-900">
                            {boteData.totalOwned || 0} pcs
                          </span>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => adjustTotalBote(-1)}
                              className="px-2.5 py-1 bg-gray-200 hover:bg-gray-300 rounded-lg font-black text-sm"
                            >
                              -1
                            </button>
                            <button
                              type="button"
                              onClick={() => adjustTotalBote(1)}
                              className="px-2.5 py-1 bg-teal-100 hover:bg-teal-200 text-teal-900 rounded-lg font-black text-sm"
                            >
                              +1
                            </button>
                            <button
                              type="button"
                              onClick={() => adjustTotalBote(24)}
                              className="px-2.5 py-1 bg-teal-600 text-white rounded-lg font-black text-xs"
                            >
                              +1 Case
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="p-3.5 sm:p-4 rounded-2xl bg-emerald-50 border-2 border-emerald-200">
                        <span className="text-xs sm:text-sm font-black text-emerald-800">
                          NASA TINDAHAN NGAYON
                        </span>
                        <div className="text-2xl sm:text-3xl font-black text-emerald-700 mt-2">
                          {inStoreCount} pcs
                        </div>
                      </div>

                      <div className="p-3.5 sm:p-4 rounded-2xl bg-amber-50 border-2 border-amber-200">
                        <span className="text-xs sm:text-sm font-black text-amber-900">
                          NASA CUSTOMER / HIRAM NA BOTE
                        </span>
                        <div className="flex justify-between items-baseline mt-2">
                          <span className="text-2xl sm:text-3xl font-black text-amber-800">
                            {borrowedCount} pcs
                          </span>
                          <span className="text-xs sm:text-sm font-black text-teal-800 bg-teal-100 px-2.5 py-1 rounded-lg">
                            Deposito: ₱{totalHeldDeposit.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* FORM PARA MAGLISTA NG KUMUHA NG BOTE */}
                    {showBoteForm && (
                      <div className="bg-teal-50/70 p-4 rounded-2xl border-2 border-teal-300 space-y-3">
                        <h4 className="font-black text-teal-900 text-base sm:text-lg">
                          📝 Ilista ang Kumuha / Nag-deposito ng Bote
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs sm:text-sm font-bold text-gray-700 mb-1">
                              Pangalan ng Customer:
                            </label>
                            <input
                              type="text"
                              value={boteCustomer}
                              onChange={(e) => setBoteCustomer(e.target.value)}
                              placeholder="Palayaw o Buong Pangalan"
                              className="w-full p-2.5 sm:p-3 rounded-xl border-2 border-teal-300 font-bold text-base bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-xs sm:text-sm font-bold text-gray-700 mb-1">
                              Anong Bote:
                            </label>
                            <select
                              value={boteBrand}
                              onChange={(e) => setBoteBrand(e.target.value)}
                              className="w-full p-2.5 sm:p-3 rounded-xl border-2 border-teal-300 font-bold text-base bg-white"
                            >
                              <option value="Softdrinks (Mismo / Kasalo)">
                                Softdrinks (Mismo / Kasalo)
                              </option>
                              <option value="Softdrinks (Litro / 1.5L)">
                                Softdrinks (Litro / 1.5L)
                              </option>
                              <option value="Beer (Red Horse / Grande / San Mig)">
                                Beer (Red Horse / Grande / San Mig)
                              </option>
                            </select>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs sm:text-sm font-bold text-gray-700 mb-1">
                              Ilang Bote ang Kinuha?
                            </label>
                            <input
                              type="number"
                              value={boteQty}
                              onChange={(e) => setBoteQty(e.target.value)}
                              className="w-full p-2.5 rounded-xl border-2 border-teal-300 font-black text-lg text-center bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-xs sm:text-sm font-bold text-gray-700 mb-1">
                              Iniwan na Deposito (₱):
                            </label>
                            <input
                              type="number"
                              value={boteDeposit}
                              onChange={(e) => setBoteDeposit(e.target.value)}
                              className="w-full p-2.5 rounded-xl border-2 border-teal-300 font-black text-lg text-center bg-white"
                            />
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          <span className="text-xs font-bold text-gray-600 self-center mr-1">
                            Mabilisang Deposito:
                          </span>
                          {[
                            { label: 'Walang Deposito (₱0)', val: 0 },
                            { label: '₱5', val: 5 },
                            { label: '₱10', val: 10 },
                            { label: '₱20', val: 20 },
                            { label: '₱50', val: 50 }
                          ].map((d) => (
                            <button
                              key={d.label}
                              type="button"
                              onClick={() => setBoteDeposit(String(d.val))}
                              className={`px-2.5 py-1 rounded-lg font-black text-xs border ${
                                Number(boteDeposit) === d.val
                                  ? 'bg-teal-600 text-white border-teal-700'
                                  : 'bg-white text-teal-900 border-teal-300'
                              }`}
                            >
                              {d.label}
                            </button>
                          ))}
                        </div>

                        <button
                          type="button"
                          onClick={handleAddBorrowedBote}
                          className="w-full bg-teal-600 hover:bg-teal-700 text-white py-3 rounded-xl font-black text-base shadow-md"
                        >
                          ✓ I-Save sa Listahan ng Bote
                        </button>
                      </div>
                    )}

                    {/* LISTAHAN NG MGA HIRAM NA BOTE */}
                    <div className="space-y-2.5 max-h-[340px] overflow-y-auto">
                      {(boteData.borrowedList || []).length === 0 ? (
                        <p className="text-gray-400 text-sm sm:text-lg font-bold text-center py-4">
                          Walang nakahiram na bote sa ngayon. Nasa tindahan lahat!
                        </p>
                      ) : (
                        boteData.borrowedList.map((b) => (
                          <div
                            key={b.id}
                            className="p-3.5 rounded-2xl bg-gray-50 border-2 border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="text-base sm:text-xl font-black text-gray-900">
                                  {b.customer} — {b.qty}x Bote
                                </h4>
                                <span
                                  className={`px-2.5 py-0.5 rounded-lg font-black text-xs ${
                                    b.deposit > 0
                                      ? 'bg-teal-100 text-teal-900 border border-teal-300'
                                      : 'bg-red-100 text-red-800 border border-red-300'
                                  }`}
                                >
                                  {b.deposit > 0
                                    ? `May Deposito: ₱${Number(b.deposit).toFixed(2)} (Ibalik pag sinauli)`
                                    : 'Walang Deposito (Singilin ang bote)'}
                                </span>
                              </div>
                              <p className="text-xs sm:text-sm font-bold text-gray-500 mt-0.5">
                                {b.brand} • {b.date}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleReturnBote(b)}
                              className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl font-black text-xs sm:text-sm shrink-0"
                            >
                              ✓ Sinauli na ang Bote
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* EXPIRING / EXPIRED ITEMS ALERT CARD */}
            <div className="bg-white rounded-2xl sm:rounded-3xl shadow-xl border-2 sm:border-4 border-orange-200 overflow-hidden">
              <div className="bg-orange-50 p-4 sm:p-6 border-b-2 border-orange-200">
                <h3 className="text-lg sm:text-2xl font-black text-orange-900 flex items-center gap-2">
                  <AlertTriangle className="w-6 h-6 sm:w-7 sm:h-7 text-orange-600" />
                  Malapit nang Ma-Expire / Expired ({expiringBatches.length})
                </h3>
                <p className="text-orange-800 font-semibold text-xs sm:text-base mt-0.5">
                  Mga panindang mag-e-expire (Ibenta agad o alisin kung sira na):
                </p>
              </div>
              <div className="p-4 sm:p-6 space-y-3 max-h-[380px] overflow-y-auto">
                {expiringBatches.length === 0 ? (
                  <p className="text-gray-400 text-base sm:text-xl font-bold text-center py-6">
                    Walang malapit nang ma-expire na paninda.
                  </p>
                ) : (
                  expiringBatches.map((b) => (
                    <div
                      key={`${b.itemId}-${b.batchIndex}`}
                      className="p-3.5 sm:p-4 rounded-xl sm:rounded-2xl bg-orange-50/60 border-2 border-orange-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3"
                    >
                      <div>
                        <h4 className="text-lg sm:text-2xl font-black text-gray-900">
                          {b.name} ({b.qty} pcs)
                        </h4>
                        <p className="text-sm sm:text-base font-bold text-gray-600">
                          Expiry Date: <span className="text-red-700 font-black">{b.expiryDate}</span> | Puhunan: ₱{b.cost.toFixed(2)}/pc
                        </p>
                      </div>
                      <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
                        <span
                          className={`px-3 py-1.5 rounded-xl font-black text-xs sm:text-base ${
                            b.daysLeft < 0
                              ? 'bg-red-600 text-white'
                              : b.daysLeft === 0
                              ? 'bg-red-100 text-red-800 border border-red-300'
                              : 'bg-orange-200 text-orange-900'
                          }`}
                        >
                          {b.daysLeft < 0
                            ? 'EXPIRED NA!'
                            : b.daysLeft === 0
                            ? 'Ngayong buwan na!'
                            : `${b.daysLeft} buwan na lang`}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveExpiredBatch(b.itemId, b.batchIndex)}
                          className="bg-red-100 hover:bg-red-200 text-red-800 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl font-black text-xs sm:text-base flex items-center gap-1"
                        >
                          <Trash2 className="w-4 h-4" /> Bawas Expired
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;