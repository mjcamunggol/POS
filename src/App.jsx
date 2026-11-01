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
  CameraOff
} from 'lucide-react';

// ==========================================
// ⚙️ CONFIGURATION - GOOGLE SHEETS WEB APP URL
// ==========================================
const SCRIPT_URL = import.meta.env.VITE_GOOGLE_APPS_SCRIPT_URL?.trim() ?? "";

const createItemId = () => Date.now() + Math.floor(Math.random() * 1000);

// ==========================================
// 🧠 SMART PRICE-PROTECTION ENGINE (FIFO)
// ==========================================
const normalizeItem = (item) => {
  const validBatches = (item.batches || [])
    .filter((b) => Number(b.qty) > 0)
    .map((b) => ({
      qty: Number(b.qty),
      cost: Number(b.cost),
      price: Number(b.price),
      expiryDate: b.expiryDate || ''
    }))
    // Unahin ibenta ang batch na may pinakamalapit na expiration date (FEFO)
    .sort((a, b) => {
      if (a.expiryDate && b.expiryDate) return a.expiryDate.localeCompare(b.expiryDate);
      if (a.expiryDate) return -1;
      if (b.expiryDate) return 1;
      return 0;
    });

  const totalQty = validBatches.reduce((sum, b) => sum + b.qty, 0);

  if (validBatches.length === 0) {
    return {
      ...item,
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
  { label: 'Xerox / Copy', price: 3 },
  { label: 'Print (Black & White)', price: 5 },
  { label: 'Print (Colored)', price: 10 },
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
    targetProfit: '',
    targetPrice: '',
    expiryDate: ''
  });

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

const pullFromSheets = useCallback(async () => {
    if (!SCRIPT_URL) return;
    setSyncStatus('Naglo-load...');
    const flushed = await flushOfflineQueue();
    if (!flushed) return;

    try {
      const res = await fetch(`${SCRIPT_URL}?action=getData`);
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
      setSyncStatus('🟢');
    } catch {
      setSyncStatus('Offline (Saved sa Device)');
    }
  }, [flushOfflineQueue]);

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
            targetProfit: '',
            targetPrice: ''
          });
          setSearchQuery('');
          showMessage(
            `Bagong item (${barcode})! Ilagay ang pangalan, puhunan, at presyo.`,
            'error'
          );
        }
      } else if (activeTab === 'stock') {
        playBeep('success');
        setNewStock((prev) => ({
          ...prev,
          barcode,
          name: scannedItem ? scannedItem.name : prev.name,
          targetPrice: scannedItem ? scannedItem.price.toFixed(2) : prev.targetPrice
        }));
        showMessage(
          scannedItem
            ? `Nahanap: ${scannedItem.name} (Presyo: ₱${scannedItem.price.toFixed(2)})`
            : `Barcode ${barcode} nailagay na!`,
          'success'
        );
      }
    },
    [activeTab, inventory, addToCart, playBeep, showMessage]
  );

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

    const { updatedInventory, saleTotal, totalCost, serviceRevenue, priceDropAlerts } =
      deductCartFromInventory();
    const profitTotal = saleTotal - totalCost;

    setInventory(updatedInventory);

    if (isUtang) {
      const newUtangRecord = {
        id: createItemId(),
        customer: utangCustomer.trim(),
        amount: saleTotal,
        cost: totalCost,
        profit: profitTotal,
        serviceRevenue: serviceRevenue,
        itemsSummary: cart.map((i) => `${i.cartQty}x ${i.name}`).join(', '),
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
        `Nailista sa utang ni ${utangCustomer.trim()}: ₱${saleTotal.toFixed(2)}`,
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

      syncToSheets('recordSale', {
        items: cart,
        saleTotal,
        profitTotal,
        inventory: updatedInventory
      });

      if (priceDropAlerts.length > 0) {
        showMessage(
          `Bayad na! Bumaba na ang presyo ng: ${priceDropAlerts.join(', ')} dahil ubos na ang lumang stock.`,
          'success'
        );
      } else {
        showMessage(`Bayad na! Total: ₱${saleTotal.toFixed(2)}`, 'success');
      }
    }

    playBeep('success');
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
    newStock.packCost && newStock.qty && parseInt(newStock.qty, 10) > 0
      ? parseFloat(newStock.packCost) / parseInt(newStock.qty, 10)
      : 0;

  const applyQuickProfit = (amount, mode = 'peso') => {
    if (unitCostPreview <= 0) {
      playBeep('error');
      return showMessage('Ilagay muna ang "Ilang Piraso" at "Puhunan sa Pack".', 'error');
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
    const packCostNum = parseFloat(newStock.packCost);
    const newPrice = parseFloat(newStock.targetPrice);

    if (
      !newStock.name.trim() ||
      !qtyNum ||
      qtyNum <= 0 ||
      isNaN(packCostNum) ||
      packCostNum <= 0 ||
      isNaN(newPrice) ||
      newPrice <= 0
    ) {
      playBeep('error');
      return showMessage('Pakikumpleto ang Pangalan, Piraso, Puhunan, at Presyo.', 'error');
    }

    const unitCost = packCostNum / qtyNum;
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
        cost: unitCost,
        price: newPrice,
        expiryDate: newStock.expiryDate || ''
      });

      updatedInv[existingIndex] = normalizeItem({
        ...existing,
        barcode: cleanBarcode || existing.barcode,
        batches: updatedBatches
      });
    } else {
      const id = createItemId();
      const newItem = normalizeItem({
        id,
        barcode: cleanBarcode || `ITEM-${id}`,
        name: newStock.name.trim(),
        batches: [
          {
            qty: qtyNum,
            cost: unitCost,
            price: newPrice,
            expiryDate: newStock.expiryDate || ''
          }
        ]
      });
      updatedInv = [...inventory, newItem];
      showMessage(`Bagong paninda na-save: ${newItem.name}`, 'success');
    }

    setInventory(updatedInv);
    playBeep('success');
    syncToSheets('addStock', { item: newStock, inventory: updatedInv });
    
    setNewStock({
      barcode: '',
      name: '',
      qty: '',
      packCost: '',
      targetProfit: '',
      targetPrice: '',
      expiryDate: ''
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

  // ==========================================
  // 🎨 COMPUTED VALUES FOR RENDER
  // ==========================================
  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.cartQty, 0);
  const cartItemCount = cart.reduce((sum, item) => sum + item.cartQty, 0);
  const sukliAmount =
    parseFloat(cashTendered) >= cartTotal ? parseFloat(cashTendered) - cartTotal : null;

  const filteredInventory = inventory.filter(
    (item) =>
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.barcode === searchQuery.trim()
  );

  const noBarcodeItems = inventory.filter(
    (i) => !i.barcode || i.barcode.startsWith('ITEM-') || i.barcode.startsWith('N/A-')
  );

  const lowStockItems = inventory.filter((item) => item.qty <= 5);
  const expiringBatches = inventory.flatMap((item) =>
    (item.batches || [])
      .map((batch, batchIndex) => {
        if (!batch.expiryDate) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const exp = new Date(batch.expiryDate + 'T00:00:00');
        const daysLeft = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));
        if (daysLeft > 14) return null; // Ipakita lang kung 14 days o mas mababa na lang
        return {
          itemId: item.id,
          name: item.name,
          batchIndex,
          qty: batch.qty,
          cost: batch.cost,
          price: batch.price,
          expiryDate: batch.expiryDate,
          daysLeft
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
                onClick={pullFromSheets}
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
                          <h3 className="text-xl sm:text-3xl font-black text-gray-800">
                            {item.name}
                          </h3>
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
                  <span className="leading-tight">Tingi ({noBarcodeItems.length})</span>
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
                      🥚 Panindang Walang Barcode / Tingi
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
                  <div className="flex justify-between items-end">
                    <span className="text-gray-500 text-lg sm:text-2xl font-bold">KABUUAN:</span>
                    <span className="text-3xl sm:text-5xl font-black text-gray-900">
                      ₱{cartTotal.toFixed(2)}
                    </span>
                  </div>

                  {cart.length > 0 && (
                    <div className="bg-emerald-50 p-3 sm:p-4 rounded-xl sm:rounded-2xl border-2 border-emerald-200 space-y-2.5 sm:space-y-3">
                      <label className="block text-emerald-900 font-black text-sm sm:text-lg">
                        💵 Pera ng Bumibili (Compute Sukli):
                      </label>
                      <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                        {[20, 50, 100, 200, 500, 1000].map((bill) => (
                          <button
                            key={bill}
                            type="button"
                            onClick={() => setCashTendered(String(bill))}
                            className={`py-2 rounded-xl font-black text-sm sm:text-lg border-2 ${
                              Number(cashTendered) === bill
                                ? 'bg-emerald-600 text-white border-emerald-700'
                                : 'bg-white text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                            }`}
                          >
                            ₱{bill}
                          </button>
                        ))}
                      </div>
                      <input
                        type="number"
                        value={cashTendered}
                        onChange={(e) => setCashTendered(e.target.value)}
                        placeholder="O i-type ang binigay na pera..."
                        className="w-full p-2.5 sm:p-3 rounded-xl border-2 border-emerald-300 text-lg sm:text-2xl font-black text-center bg-white"
                      />
                      {sukliAmount !== null && (
                        <div className="flex justify-between items-center bg-white p-2.5 sm:p-3 rounded-xl border-2 border-emerald-500">
                          <span className="text-base sm:text-xl font-black text-gray-700">
                            SUKLI:
                          </span>
                          <span className="text-2xl sm:text-4xl font-black text-emerald-600">
                            ₱{sukliAmount.toFixed(2)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    onClick={() => processCheckout(false)}
                    disabled={cart.length === 0}
                    className="w-full bg-emerald-600 text-white text-xl sm:text-3xl font-black py-4 sm:py-5 rounded-xl sm:rounded-2xl shadow-xl hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-gray-300 flex justify-center items-center gap-2 sm:gap-3"
                  >
                    <Check className="w-7 h-7 sm:w-9 sm:h-9" /> BAYARAN NA (CASH)
                  </button>

                  {cart.length > 0 && !showUtangInput && (
                    <button
                      onClick={() => setShowUtangInput(true)}
                      className="w-full bg-amber-100 text-amber-900 text-base sm:text-xl font-black py-3 rounded-xl sm:rounded-2xl border-2 border-amber-300 hover:bg-amber-200 flex justify-center items-center gap-2"
                    >
                      <BookOpen className="w-5 h-5 sm:w-6 sm:h-6" /> Ilista muna sa Utang
                    </button>
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
                        placeholder="Hal. Ate Nena..."
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
              <div className="space-y-4 sm:space-y-6">
                <div>
                  <div className="flex justify-between items-center mb-1.5 sm:mb-2">
                    <label className="block text-gray-800 font-black text-base sm:text-2xl">
                      1. Barcode (I-scan o Blanko):
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
                      <span>{cameraOpen ? 'Isara Camera' : ''}</span>
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
                        targetPrice: existing ? existing.price.toFixed(2) : prev.targetPrice
                      }));
                    }}
                    className="w-full p-3.5 sm:p-5 border-2 sm:border-4 border-gray-300 rounded-xl sm:rounded-2xl text-lg sm:text-2xl font-bold focus:border-emerald-500"
                    placeholder="I-scan o iwanang blanko..."
                  />
                </div>

                <div>
                  <label className="block text-gray-800 font-black mb-1.5 sm:mb-2 text-base sm:text-2xl">
                    2. Pangalan ng Paninda:
                  </label>
                  <input
                    type="text"
                    value={newStock.name}
                    onChange={(e) => setNewStock({ ...newStock, name: e.target.value })}
                    className="w-full p-3.5 sm:p-5 border-2 sm:border-4 border-gray-300 rounded-xl sm:rounded-2xl text-lg sm:text-2xl font-bold focus:border-emerald-500"
                    placeholder="Hal. Lucky Me, Yelo, Itlog..."
                  />
                  {matchedExistingStock && (
                    <p className="mt-2 text-emerald-700 font-black text-sm sm:text-lg bg-emerald-50 p-2.5 sm:p-3 rounded-xl border border-emerald-200">
                      📌 Naka-rekord na: May {matchedExistingStock.qty} pcs pa (Presyo: ₱
                      {matchedExistingStock.price.toFixed(2)})
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 sm:gap-6">
                  <div>
                    <label className="block text-gray-800 font-black mb-1.5 sm:mb-2 text-base sm:text-2xl">
                      3. Ilang Piraso?
                    </label>
                    <input
                      type="number"
                      value={newStock.qty}
                      onChange={(e) => setNewStock({ ...newStock, qty: e.target.value })}
                      className="w-full p-3.5 sm:p-5 border-2 sm:border-4 border-gray-300 rounded-xl sm:rounded-2xl text-xl sm:text-3xl font-black text-center focus:border-emerald-500"
                      placeholder="Hal. 24"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-800 font-black mb-1.5 sm:mb-2 text-base sm:text-2xl">
                      4. Puhunan Pack:
                    </label>
                    <input
                      type="number"
                      value={newStock.packCost}
                      onChange={(e) => setNewStock({ ...newStock, packCost: e.target.value })}
                      className="w-full p-3.5 sm:p-5 border-2 sm:border-4 border-gray-300 rounded-xl sm:rounded-2xl text-xl sm:text-3xl font-black text-center focus:border-emerald-500"
                      placeholder="Hal. 300"
                    />
                  </div>
                  <div>
                  <label className="block text-gray-800 font-black mb-1.5 sm:mb-2 text-base sm:text-2xl">
                    📅 Expiration Date (Optional — kung pagkain/gamot):
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={newStock.expiryDate || ''}
                      onChange={(e) =>
                        setNewStock({ ...newStock, expiryDate: e.target.value })
                      }
                      className="flex-1 p-3.5 sm:p-4 border-2 sm:border-4 border-gray-300 rounded-xl sm:rounded-2xl text-lg sm:text-2xl font-bold focus:border-emerald-500 bg-white"
                    />
                    {newStock.expiryDate && (
                      <button
                        type="button"
                        onClick={() => setNewStock({ ...newStock, expiryDate: '' })}
                        className="px-4 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-xl text-sm sm:text-base"
                      >
                        Burahin
                      </button>
                    )}
                  </div>
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
                    <AlertTriangle className="w-6 h-6 sm:w-7 sm:h-7" /> Paubos na Stock ({lowStockItems.length})
                  </h3>
                  <p className="text-red-700 font-semibold text-xs sm:text-base mt-0.5">
                    Mga panindang 5 piraso o mas mababa na lang ang natitira:
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
                        <span
                          className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl font-black text-sm sm:text-xl shrink-0 ${
                            item.qty === 0
                              ? 'bg-red-600 text-white'
                              : 'bg-amber-200 text-amber-900'
                          }`}
                        >
                          {item.qty === 0 ? 'UBOS NA' : `${item.qty} pcs`}
                        </span>
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
                              placeholder="Hal. Kuya Jun..."
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
                  Mga panindang mag-e-expire sa loob ng 14 araw (Ibenta agad o alisin kung sira na):
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
                            b.daysLeft <= 0
                              ? 'bg-red-600 text-white'
                              : 'bg-orange-200 text-orange-900'
                          }`}
                        >
                          {b.daysLeft <= 0
                            ? 'EXPIRED NA!'
                            : `${b.daysLeft} araw na lang`}
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