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
  Trash2
} from 'lucide-react';

// ==========================================
// ⚙️ CONFIGURATION - GOOGLE SHEETS WEB APP URL
// ==========================================
// Paste your deployed Google Apps Script Web App URL inside the quotes:
const SCRIPT_URL = "";

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
      price: Number(b.price)
    }));

  const totalQty = validBatches.reduce((sum, b) => sum + b.qty, 0);

  if (validBatches.length === 0) {
    return {
      ...item,
      batches: [],
      qty: 0,
      cost: Number(item.cost) || 0,
      price: Number(item.price) || 0
    };
  }

  const activePrice = Math.max(...validBatches.map((b) => b.price));
  const currentCost = validBatches[0].cost;

  return {
    ...item,
    batches: validBatches,
    qty: totalQty,
    cost: currentCost,
    price: activePrice
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

  // Cart & Checkout States
  const [cart, setCart] = useState([]);
  const [cashTendered, setCashTendered] = useState('');
  const [utangCustomer, setUtangCustomer] = useState('');
  const [showUtangInput, setShowUtangInput] = useState(false);
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
    targetPrice: ''
  });

  const [message, setMessage] = useState(null);
  const toastTimerRef = useRef(null);
  const scanBufferRef = useRef({ chars: '', lastTime: 0 });

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
    toastTimerRef.current = setTimeout(() => setMessage(null), 5000);
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
      setSyncStatus('Naka-save sa Cloud');
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
      setSyncStatus('Naka-save sa Cloud');
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
  // 📱 GCASH / BANK & 🖨️ PRINT HANDLERS
  // ==========================================
  const handleGcashAmountChange = (val) => {
    setGcashAmount(val);
    const num = parseFloat(val);
    if (num > 0) {
      // Standard Sari-Sari Store Bracket: ₱10 fee per ₱500
      const suggestedFee = Math.max(5, Math.ceil(num / 500) * 10);
      setGcashFee(String(suggestedFee));
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

    // Only the Fee (Tubo) is added to Sales and Profit so Grocery Puhunan is never distorted
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

    // Calculate service items in cart (Print/Xerox) — 0 cost, no inventory deduction
    cart
      .filter((c) => c.isService)
      .forEach((serviceItem) => {
        const rev = serviceItem.price * serviceItem.cartQty;
        saleTotal += rev;
        serviceRevenue += rev;
      });

    // Deduct physical store items from FIFO batches
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
    playBeep('success');
    syncToSheets('payUtang', { record, utangList: updatedUtang });
    showMessage(
      `Bayad na ang utang ni ${record.customer} (₱${record.amount.toFixed(2)})!`,
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

      updatedBatches.push({ qty: qtyNum, cost: unitCost, price: newPrice });
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
        batches: [{ qty: qtyNum, cost: unitCost, price: newPrice }]
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
      targetPrice: ''
    });
  };

  // ==========================================
  // 🎨 COMPUTED VALUES FOR RENDER
  // ==========================================
  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.cartQty, 0);
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
  const matchedExistingStock = inventory.find(
    (i) =>
      (newStock.barcode.trim() && i.barcode === newStock.barcode.trim()) ||
      (newStock.name.trim() && i.name.toLowerCase() === newStock.name.trim().toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-100 font-sans pb-20">
      {/* CLEAN HEADER */}
      <header className="bg-emerald-700 text-white shadow-lg sticky top-0 z-50">
        <div className="max-w-6xl mx-auto p-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-wide">🏪 Tindahan POS</h1>
            <p className="text-emerald-100 text-sm font-bold">Status: {syncStatus}</p>
          </div>
          <div className="flex items-center gap-3">
            {SCRIPT_URL && (
              <button
                onClick={pullFromSheets}
                className="bg-emerald-800 hover:bg-emerald-900 px-4 py-3 rounded-2xl font-bold flex items-center gap-2 text-base"
              >
                <RefreshCw size={20} /> I-Sync
              </button>
            )}
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`px-4 py-3 rounded-2xl font-bold flex items-center gap-2 transition text-base ${
                soundEnabled ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {soundEnabled ? <Volume2 size={24} /> : <VolumeX size={24} />}
              <span>{soundEnabled ? 'Tunog: Bukas' : 'Tunog: Patay'}</span>
            </button>
          </div>
        </div>

        {/* 3 GIANT TABS */}
        <div className="flex flex-col sm:flex-row max-w-6xl mx-auto">
          <button
            onClick={() => setActiveTab('sell')}
            className={`flex-1 py-5 text-xl sm:text-2xl font-black flex items-center justify-center gap-3 transition-colors ${
              activeTab === 'sell'
                ? 'bg-white text-emerald-800 border-b-4 border-emerald-800'
                : 'hover:bg-emerald-600'
            }`}
          >
            <ShoppingCart size={32} /> 1. MAGBENTA
          </button>
          <button
            onClick={() => setActiveTab('stock')}
            className={`flex-1 py-5 text-xl sm:text-2xl font-black flex items-center justify-center gap-3 transition-colors ${
              activeTab === 'stock'
                ? 'bg-white text-emerald-800 border-b-4 border-emerald-800'
                : 'hover:bg-emerald-600'
            }`}
          >
            <PlusCircle size={32} /> 2. DAGDAG STOCK
          </button>
          <button
            onClick={() => setActiveTab('reports')}
            className={`flex-1 py-5 text-xl sm:text-2xl font-black flex items-center justify-center gap-3 transition-colors ${
              activeTab === 'reports'
                ? 'bg-white text-emerald-800 border-b-4 border-emerald-800'
                : 'hover:bg-emerald-600'
            }`}
          >
            <FileSpreadsheet size={32} /> 3. KITA AT LISTAHAN
          </button>
        </div>
      </header>

      {/* FLOATING TOAST ALERT */}
      {message && (
        <div
          className={`fixed top-36 left-1/2 transform -translate-x-1/2 px-8 py-4 rounded-2xl shadow-2xl z-50 text-2xl font-black text-white text-center transition-all max-w-xl ${
            message.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'
          }`}
        >
          {message.text}
        </div>
      )}

      <main className="max-w-6xl mx-auto mt-8 px-4">
        {/* ==================== TAB 1: MAGBENTA ==================== */}
        {activeTab === 'sell' && (
          <div className="flex flex-col lg:flex-row gap-8">
            {/* LEFT COLUMN: SEARCH + 3 QUICK DRAWERS */}
            <div className="flex-1 space-y-5">
              {/* SEARCH BAR */}
              <div className="bg-white p-6 rounded-3xl shadow-md border-4 border-emerald-100">
                <label className="block text-gray-800 font-black mb-3 text-3xl">
                  🔍 I-scan ang Item o I-type ang Pangalan:
                </label>
                <div className="relative">
                  <Search className="absolute left-6 top-6 text-emerald-500" size={40} />
                  <input
                    type="text"
                    className="w-full text-3xl sm:text-4xl p-5 pl-20 border-4 border-emerald-300 rounded-2xl focus:outline-none focus:border-emerald-600 bg-gray-50 font-bold"
                    placeholder="Hal. Canton, Nescafe..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    autoFocus
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-5 top-5 text-gray-500 hover:text-red-600 bg-gray-200 rounded-full p-2"
                    >
                      <X size={32} />
                    </button>
                  )}
                </div>
              </div>

              {/* 3 SIMPLE SENIOR-FRIENDLY QUICK BUTTONS (COLLAPSIBLE) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setActiveDrawer(activeDrawer === 'tingi' ? null : 'tingi')
                  }
                  className={`p-4 rounded-2xl border-4 font-black text-xl flex items-center justify-center gap-2 transition shadow-sm ${
                    activeDrawer === 'tingi'
                      ? 'bg-amber-500 text-white border-amber-700'
                      : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
                  }`}
                >
                  <span>🥚 Walang Barcode ({noBarcodeItems.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setActiveDrawer(activeDrawer === 'gcash' ? null : 'gcash')
                  }
                  className={`p-4 rounded-2xl border-4 font-black text-xl flex items-center justify-center gap-2 transition shadow-sm ${
                    activeDrawer === 'gcash'
                      ? 'bg-blue-600 text-white border-blue-800'
                      : 'bg-blue-50 text-blue-900 border-blue-300 hover:bg-blue-100'
                  }`}
                >
                  <Smartphone size={26} />
                  <span>GCash / Bank</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setActiveDrawer(activeDrawer === 'print' ? null : 'print')
                  }
                  className={`p-4 rounded-2xl border-4 font-black text-xl flex items-center justify-center gap-2 transition shadow-sm ${
                    activeDrawer === 'print'
                      ? 'bg-purple-600 text-white border-purple-800'
                      : 'bg-purple-50 text-purple-900 border-purple-300 hover:bg-purple-100'
                  }`}
                >
                  <Printer size={26} />
                  <span>Print at Xerox</span>
                </button>
              </div>

              {/* DRAWER 1: WALANG BARCODE / TINGI */}
              {activeDrawer === 'tingi' && (
                <div className="bg-white p-6 rounded-3xl border-4 border-amber-300 shadow-lg space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-2xl font-black text-amber-900">
                      🥚 Mga Panindang Walang Barcode / Tingi
                    </h3>
                    <button
                      onClick={() => setActiveDrawer(null)}
                      className="text-gray-500 hover:text-gray-800 font-bold text-lg"
                    >
                      Isara ✕
                    </button>
                  </div>
                  {noBarcodeItems.length === 0 ? (
                    <p className="text-gray-500 text-xl font-bold py-4">
                      Wala pang naka-save na panindang walang barcode. Sa "2. DAGDAG STOCK", iwanang blanko ang Barcode para lumabas dito (hal. Yelo, Itlog, Mantika).
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {noBarcodeItems.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => addToCart(item)}
                          disabled={item.qty <= 0}
                          className="p-4 rounded-2xl border-2 border-amber-200 bg-amber-50 hover:bg-emerald-50 hover:border-emerald-400 text-left flex flex-col justify-between active:scale-95 transition disabled:opacity-40"
                        >
                          <span className="text-xl font-black text-gray-800">
                            {item.name}
                          </span>
                          <div className="mt-2 flex justify-between items-end">
                            <span className="text-2xl font-black text-emerald-700">
                              ₱{item.price.toFixed(2)}
                            </span>
                            <span className="text-sm font-bold text-gray-500">
                              {item.qty} pcs
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* DRAWER 2: GCASH / BANK IN & OUT (NO INVENTORY) */}
              {activeDrawer === 'gcash' && (
                <div className="bg-white p-6 rounded-3xl border-4 border-blue-300 shadow-lg space-y-5">
                  <div className="flex justify-between items-center">
                    <h3 className="text-2xl font-black text-blue-900 flex items-center gap-2">
                      <Smartphone size={28} /> GCash / Bank Transaction
                    </h3>
                    <button
                      onClick={() => setActiveDrawer(null)}
                      className="text-gray-500 hover:text-gray-800 font-bold text-lg"
                    >
                      Isara ✕
                    </button>
                  </div>

                  {/* CASH-IN VS CASH-OUT SELECTOR */}
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setGcashType('CASH-IN')}
                      className={`py-4 rounded-2xl font-black text-xl border-4 transition ${
                        gcashType === 'CASH-IN'
                          ? 'bg-blue-600 text-white border-blue-800 shadow-md'
                          : 'bg-gray-100 text-gray-700 border-gray-300'
                      }`}
                    >
                      📥 CASH-IN (Magpapasa)
                    </button>
                    <button
                      type="button"
                      onClick={() => setGcashType('CASH-OUT')}
                      className={`py-4 rounded-2xl font-black text-xl border-4 transition ${
                        gcashType === 'CASH-OUT'
                          ? 'bg-indigo-600 text-white border-indigo-800 shadow-md'
                          : 'bg-gray-100 text-gray-700 border-gray-300'
                      }`}
                    >
                      📤 CASH-OUT (Magwi-withdraw)
                    </button>
                  </div>

                  {/* QUICK AMOUNTS */}
                  <div>
                    <label className="block text-gray-700 font-black mb-2 text-lg">
                      Pumili o I-type ang Halaga (₱):
                    </label>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
                      {[100, 200, 500, 1000, 2000, 5000].map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => handleGcashAmountChange(String(amt))}
                          className={`py-2 rounded-xl font-black text-lg border-2 ${
                            Number(gcashAmount) === amt
                              ? 'bg-blue-600 text-white border-blue-700'
                              : 'bg-blue-50 text-blue-900 border-blue-200 hover:bg-blue-100'
                          }`}
                        >
                          ₱{amt}
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <span className="text-gray-600 font-bold text-base">
                          Halaga ng GCash/Bank (₱):
                        </span>
                        <input
                          type="number"
                          value={gcashAmount}
                          onChange={(e) => handleGcashAmountChange(e.target.value)}
                          placeholder="Hal. 1000"
                          className="w-full mt-1 p-4 border-4 border-blue-300 rounded-2xl text-3xl font-black text-center"
                        />
                      </div>
                      <div>
                        <span className="text-gray-600 font-bold text-base">
                          Tubo / Patong Mo (₱):
                        </span>
                        <input
                          type="number"
                          value={gcashFee}
                          onChange={(e) => setGcashFee(e.target.value)}
                          placeholder="Hal. 20"
                          className="w-full mt-1 p-4 border-4 border-emerald-400 rounded-2xl text-3xl font-black text-emerald-700 text-center"
                        />
                      </div>
                    </div>
                  </div>

                  {/* CLEAR SENIOR GUIDE BANNER */}
                  {parseFloat(gcashAmount) > 0 && (
                    <div className="bg-blue-50 p-4 rounded-2xl border-2 border-blue-300 space-y-1">
                      {gcashType === 'CASH-IN' ? (
                        <>
                          <p className="text-xl font-black text-blue-900">
                            💵 Kunin na Pera sa Customer: ₱
                            {(
                              parseFloat(gcashAmount) + (parseFloat(gcashFee) || 0)
                            ).toFixed(2)}
                          </p>
                          <p className="text-lg font-bold text-gray-700">
                            📱 I-send sa GCash/Bank niya: ₱
                            {parseFloat(gcashAmount).toFixed(2)}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-xl font-black text-indigo-900">
                            💵 Ibigay na Cash sa Customer: ₱
                            {parseFloat(gcashAmount).toFixed(2)}
                          </p>
                          <p className="text-lg font-bold text-emerald-700">
                            ✅ Kunin na Tubo / Fee: ₱
                            {(parseFloat(gcashFee) || 0).toFixed(2)}
                          </p>
                        </>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleRecordGcash}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black text-2xl py-5 rounded-2xl shadow-lg flex justify-center items-center gap-2"
                  >
                    <Check size={32} /> I-REKORD ANG {gcashType}
                  </button>
                </div>
              )}

              {/* DRAWER 3: PRINT / XEROX / SCAN SERVICES (NO INVENTORY) */}
              {activeDrawer === 'print' && (
                <div className="bg-white p-6 rounded-3xl border-4 border-purple-300 shadow-lg space-y-5">
                  <div className="flex justify-between items-center">
                    <h3 className="text-2xl font-black text-purple-900 flex items-center gap-2">
                      <Printer size={28} /> Print, Xerox at Scan (1-Tap)
                    </h3>
                    <button
                      onClick={() => setActiveDrawer(null)}
                      className="text-gray-500 hover:text-gray-800 font-bold text-lg"
                    >
                      Isara ✕
                    </button>
                  </div>

                  {/* 1-TAP PRESET BUTTONS */}
                  <div className="grid grid-cols-2 gap-3">
                    {PRINT_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => handleAddPrintPreset(preset)}
                        className="p-4 rounded-2xl border-2 border-purple-300 bg-purple-50 hover:bg-purple-100 text-left flex justify-between items-center active:scale-95 transition"
                      >
                        <div>
                          <span className="block text-xl font-black text-gray-800">
                            {preset.label}
                          </span>
                          <span className="text-sm font-bold text-purple-700">
                            Pindutin para idagdag
                          </span>
                        </div>
                        <span className="text-3xl font-black text-purple-800">
                          ₱{preset.price}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* CUSTOM PRINT AMOUNT */}
                  <div className="bg-gray-50 p-4 rounded-2xl border-2 border-gray-200 space-y-3">
                    <label className="block text-gray-700 font-black text-lg">
                      Ibang Presyo o Maraming Pahina:
                    </label>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <span className="text-sm font-bold text-gray-600">Serbisyo:</span>
                        <input
                          type="text"
                          value={customPrintName}
                          onChange={(e) => setCustomPrintName(e.target.value)}
                          className="w-full p-3 border-2 border-gray-300 rounded-xl font-bold text-lg bg-white"
                        />
                      </div>
                      <div>
                        <span className="text-sm font-bold text-gray-600">Ilang Piraso:</span>
                        <input
                          type="number"
                          value={customPrintQty}
                          onChange={(e) => setCustomPrintQty(e.target.value)}
                          className="w-full p-3 border-2 border-gray-300 rounded-xl font-black text-xl text-center bg-white"
                        />
                      </div>
                      <div>
                        <span className="text-sm font-bold text-gray-600">
                          Presyo Kada Isa (₱):
                        </span>
                        <input
                          type="number"
                          value={customPrintPrice}
                          onChange={(e) => setCustomPrintPrice(e.target.value)}
                          placeholder="0.00"
                          className="w-full p-3 border-2 border-purple-400 rounded-xl font-black text-xl text-center bg-white"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleAddCustomPrint}
                      className="w-full bg-purple-600 hover:bg-purple-700 text-white font-black text-xl py-3 rounded-xl"
                    >
                      + Idagdag sa Basket
                    </button>
                  </div>
                </div>
              )}

              {/* SEARCH RESULTS: ONLY SHOWN WHEN TYPING */}
              {searchQuery && (
                <div className="bg-white rounded-3xl shadow-lg border-2 border-gray-200 overflow-hidden">
                  {filteredInventory.length > 0 ? (
                    filteredInventory.map((item) => (
                      <div
                        key={item.id}
                        className="p-6 border-b-2 border-gray-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white hover:bg-emerald-50"
                      >
                        <div>
                          <h3 className="text-3xl font-black text-gray-800">{item.name}</h3>
                          <p className="text-gray-500 text-xl mt-1 font-bold flex items-center gap-2">
                            <Package size={24} /> Natitirang Stock: {item.qty} pcs
                            {item.batches && item.batches.length > 1 && (
                              <span className="text-amber-600">
                                ({item.batches[0].qty} pcs sa lumang presyo)
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-6 w-full sm:w-auto justify-between sm:justify-end">
                          <span className="text-4xl font-black text-emerald-700">
                            ₱{item.price.toFixed(2)}
                          </span>
                          <button
                            onClick={() => addToCart(item)}
                            disabled={item.qty <= 0}
                            className="bg-emerald-600 text-white px-8 py-5 rounded-2xl text-2xl font-black hover:bg-emerald-700 disabled:bg-gray-400 shadow-md active:scale-95 transition-transform"
                          >
                            {item.qty > 0 ? '+ IDAGDAG' : 'UBOS NA'}
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-10 text-center space-y-4">
                      <p className="text-gray-600 text-2xl font-bold">
                        Walang nahanap na "{searchQuery}".
                      </p>
                      <button
                        onClick={() => {
                          setActiveTab('stock');
                          setNewStock((prev) => ({ ...prev, name: searchQuery }));
                          setSearchQuery('');
                        }}
                        className="bg-emerald-100 text-emerald-800 px-6 py-4 rounded-2xl text-xl font-black hover:bg-emerald-200"
                      >
                        + Idagdag bilang Bagong Paninda
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* RIGHT COLUMN: GIANT BASKET & SUKLI CALCULATOR */}
            <div className="w-full lg:w-[460px]">
              <div className="bg-white rounded-3xl shadow-2xl border-4 border-gray-200 overflow-hidden sticky top-36">
                <div className="bg-gray-800 text-white p-5 flex justify-between items-center">
                  <h2 className="text-2xl sm:text-3xl font-black flex items-center gap-3">
                    🛒 Bayarin Ngayon
                  </h2>
                  {cart.length > 0 && (
                    <button
                      onClick={() => {
                        setCart([]);
                        setCashTendered('');
                        setShowUtangInput(false);
                      }}
                      className="text-sm bg-gray-700 hover:bg-red-600 px-3 py-2 rounded-xl font-bold"
                    >
                      Burahin Lahat
                    </button>
                  )}
                </div>

                <div className="p-4 min-h-[240px] max-h-[400px] overflow-y-auto bg-gray-50 space-y-3">
                  {cart.length === 0 ? (
                    <div className="text-center text-gray-400 py-16">
                      <ShoppingCart size={72} className="mx-auto mb-3 opacity-20" />
                      <p className="text-2xl font-bold">Walang laman ang basket</p>
                    </div>
                  ) : (
                    cart.map((item) => (
                      <div
                        key={item.id}
                        className="bg-white p-4 rounded-2xl shadow-sm border-2 border-gray-100"
                      >
                        <div className="flex justify-between items-start mb-3">
                          <span className="text-2xl font-black text-gray-800">
                            {item.name}
                          </span>
                          <button
                            onClick={() =>
                              setCart((prev) => prev.filter((i) => i.id !== item.id))
                            }
                            className="text-red-500 bg-red-50 hover:bg-red-100 p-2 rounded-xl"
                          >
                            <X size={24} />
                          </button>
                        </div>
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-3 bg-gray-100 rounded-2xl p-2 border-2 border-gray-200">
                            <button
                              onClick={() => updateCartQty(item.id, -1)}
                              className="p-3 bg-white shadow-sm rounded-xl text-red-600"
                            >
                              <Minus size={22} />
                            </button>
                            <span className="w-10 text-center font-black text-2xl">
                              {item.cartQty}
                            </span>
                            <button
                              onClick={() => updateCartQty(item.id, 1)}
                              className="p-3 bg-white shadow-sm rounded-xl text-emerald-600"
                            >
                              <Plus size={22} />
                            </button>
                          </div>
                          <span className="font-black text-emerald-700 text-3xl">
                            ₱{(item.price * item.cartQty).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* TOTAL & SUKLI SECTION */}
                <div className="bg-white p-6 border-t-4 border-gray-200 space-y-4">
                  <div className="flex justify-between items-end">
                    <span className="text-gray-500 text-2xl font-bold">KABUUAN:</span>
                    <span className="text-5xl font-black text-gray-900">
                      ₱{cartTotal.toFixed(2)}
                    </span>
                  </div>

                  {cart.length > 0 && (
                    <div className="bg-emerald-50 p-4 rounded-2xl border-2 border-emerald-200 space-y-3">
                      <label className="block text-emerald-900 font-black text-lg">
                        💵 Pera ng Bumibili (Pang-compute ng Sukli):
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {[20, 50, 100, 200, 500, 1000].map((bill) => (
                          <button
                            key={bill}
                            type="button"
                            onClick={() => setCashTendered(String(bill))}
                            className={`py-2 rounded-xl font-black text-lg border-2 ${
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
                        className="w-full p-3 rounded-xl border-2 border-emerald-300 text-2xl font-black text-center bg-white"
                      />
                      {sukliAmount !== null && (
                        <div className="flex justify-between items-center bg-white p-3 rounded-xl border-2 border-emerald-500">
                          <span className="text-xl font-black text-gray-700">SUKLI:</span>
                          <span className="text-4xl font-black text-emerald-600">
                            ₱{sukliAmount.toFixed(2)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    onClick={() => processCheckout(false)}
                    disabled={cart.length === 0}
                    className="w-full bg-emerald-600 text-white text-3xl font-black py-5 rounded-2xl shadow-xl hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-gray-300 flex justify-center items-center gap-3"
                  >
                    <Check size={36} /> BAYARAN NA (CASH)
                  </button>

                  {cart.length > 0 && !showUtangInput && (
                    <button
                      onClick={() => setShowUtangInput(true)}
                      className="w-full bg-amber-100 text-amber-900 text-xl font-black py-3 rounded-2xl border-2 border-amber-300 hover:bg-amber-200 flex justify-center items-center gap-2"
                    >
                      <BookOpen size={24} /> Ilista muna sa Utang
                    </button>
                  )}

                  {showUtangInput && (
                    <div className="bg-amber-50 p-4 rounded-2xl border-2 border-amber-300 space-y-3">
                      <label className="block font-black text-amber-900 text-lg">
                        Pangalan ng Umutang:
                      </label>
                      <input
                        type="text"
                        value={utangCustomer}
                        onChange={(e) => setUtangCustomer(e.target.value)}
                        placeholder="Hal. Ate Nena..."
                        className="w-full p-3 rounded-xl border-2 border-amber-400 text-2xl font-bold bg-white"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => processCheckout(true)}
                          className="flex-1 bg-amber-600 text-white font-black text-xl py-3 rounded-xl hover:bg-amber-700"
                        >
                          I-Save sa Utang
                        </button>
                        <button
                          onClick={() => setShowUtangInput(false)}
                          className="px-4 bg-gray-200 text-gray-700 font-bold rounded-xl"
                        >
                          Kansela
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 2: DAGDAG STOCK ==================== */}
        {activeTab === 'stock' && (
          <div className="bg-white rounded-3xl shadow-xl border-4 border-emerald-100 overflow-hidden">
            <div className="bg-emerald-50 p-8 border-b-4 border-emerald-100">
              <h2 className="text-3xl sm:text-4xl font-black text-emerald-900">
                📦 Magpasok ng Bagong Bili (Restock Paninda)
              </h2>
              <p className="text-emerald-700 text-xl mt-1 font-semibold">
                I-scan ang barcode o iwanang blanko kung panindang walang barcode (hal. Yelo, Itlog, Mantika).
              </p>
            </div>

            <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-10">
              {/* LEFT: ITEM DETAILS */}
              <div className="space-y-6">
                <div>
                  <label className="block text-gray-800 font-black mb-2 text-2xl">
                    1. Barcode (I-scan o Iwanang Blanko):
                  </label>
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
                    className="w-full p-5 border-4 border-gray-300 rounded-2xl text-2xl font-bold focus:border-emerald-500"
                    placeholder="I-scan o iwanang blanko..."
                  />
                </div>

                <div>
                  <label className="block text-gray-800 font-black mb-2 text-2xl">
                    2. Pangalan ng Paninda:
                  </label>
                  <input
                    type="text"
                    value={newStock.name}
                    onChange={(e) => setNewStock({ ...newStock, name: e.target.value })}
                    className="w-full p-5 border-4 border-gray-300 rounded-2xl text-2xl font-bold focus:border-emerald-500"
                    placeholder="Hal. Lucky Me, Yelo, Itlog..."
                  />
                  {matchedExistingStock && (
                    <p className="mt-2 text-emerald-700 font-black text-lg bg-emerald-50 p-3 rounded-xl border border-emerald-200">
                      📌 Naka-rekord na ito: May {matchedExistingStock.qty} pcs pa (Kasalukuyang presyo: ₱{matchedExistingStock.price.toFixed(2)})
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-gray-800 font-black mb-2 text-2xl">
                      3. Ilang Piraso?
                    </label>
                    <input
                      type="number"
                      value={newStock.qty}
                      onChange={(e) => setNewStock({ ...newStock, qty: e.target.value })}
                      className="w-full p-5 border-4 border-gray-300 rounded-2xl text-3xl font-black text-center focus:border-emerald-500"
                      placeholder="Hal. 24"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-800 font-black mb-2 text-2xl">
                      4. Puhunan sa Pack (₱):
                    </label>
                    <input
                      type="number"
                      value={newStock.packCost}
                      onChange={(e) => setNewStock({ ...newStock, packCost: e.target.value })}
                      className="w-full p-5 border-4 border-gray-300 rounded-2xl text-3xl font-black text-center focus:border-emerald-500"
                      placeholder="Hal. 300"
                    />
                  </div>
                </div>
              </div>

              {/* RIGHT: TUBO & SELLING PRICE CALCULATOR */}
              <div className="bg-gray-100 p-8 rounded-3xl border-4 border-gray-200 space-y-6">
                <h3 className="font-black text-gray-800 text-3xl">🧮 Calculator ng Presyo</h3>

                <div className="bg-white p-5 rounded-2xl shadow-sm flex justify-between items-center border-2 border-gray-200">
                  <span className="text-gray-600 text-2xl font-bold">Puhunan kada piraso:</span>
                  <span className="text-4xl font-black text-gray-900">
                    ₱{unitCostPreview.toFixed(2)}
                  </span>
                </div>

                <div>
                  <label className="block text-gray-700 font-black mb-3 text-xl">
                    Pumili ng Idadagdag na Tubo kada Piraso:
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    {[1, 2, 3, 5].map((peso) => (
                      <button
                        key={peso}
                        type="button"
                        onClick={() => applyQuickProfit(peso, 'peso')}
                        className="bg-emerald-100 hover:bg-emerald-200 text-emerald-900 font-black text-xl py-3 rounded-xl border-2 border-emerald-300"
                      >
                        + ₱{peso}.00
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => applyQuickProfit(15, 'percent')}
                      className="bg-blue-100 hover:bg-blue-200 text-blue-900 font-black text-xl py-3 rounded-xl border-2 border-blue-300"
                    >
                      + 15%
                    </button>
                    <button
                      type="button"
                      onClick={() => applyQuickProfit(20, 'percent')}
                      className="bg-blue-100 hover:bg-blue-200 text-blue-900 font-black text-xl py-3 rounded-xl border-2 border-blue-300"
                    >
                      + 20%
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-3">
                    <label className="text-gray-800 font-black text-2xl">
                      5. Presyo ng Pagbebenta:
                    </label>
                    <button
                      type="button"
                      onClick={roundUpSellingPrice}
                      className="bg-amber-100 hover:bg-amber-200 text-amber-900 px-4 py-2 rounded-xl font-black text-base border-2 border-amber-300"
                    >
                      ⬆️ Gawing Buong Piso
                    </button>
                  </div>
                  <div className="flex items-center gap-4 bg-white p-2 rounded-2xl border-4 border-emerald-500">
                    <span className="text-5xl font-black text-gray-400 pl-4">₱</span>
                    <input
                      type="number"
                      value={newStock.targetPrice}
                      onChange={(e) =>
                        setNewStock({ ...newStock, targetPrice: e.target.value })
                      }
                      className="w-full p-3 text-5xl font-black text-emerald-700 outline-none"
                      placeholder="0.00"
                    />
                  </div>
                  {newStock.targetPrice && unitCostPreview > 0 && (
                    <p className="text-emerald-800 font-black text-xl mt-3">
                      ✅ Malinis na Tubo kada piraso: ₱
                      {(parseFloat(newStock.targetPrice) - unitCostPreview).toFixed(2)}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="p-8 bg-gray-50 border-t-4 border-gray-200">
              <button
                onClick={handleSaveStock}
                className="w-full bg-emerald-600 text-white text-3xl font-black py-6 rounded-2xl shadow-xl hover:bg-emerald-700 active:bg-emerald-800 flex justify-center items-center gap-4"
              >
                <Save size={40} /> I-SAVE ANG BAGONG STOCK
              </button>
            </div>
          </div>
        )}

        {/* ==================== TAB 3: KITA AT LISTAHAN ==================== */}
        {activeTab === 'reports' && (
          <div className="space-y-8">
            {/* DAILY MONEY CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white p-8 rounded-3xl shadow-xl border-t-8 border-blue-500">
                <p className="text-gray-500 font-black text-xl mb-2">
                  Kabuuang Benta at Serbisyo
                </p>
                <h3 className="text-5xl font-black text-gray-900">
                  ₱{dailyStats.sales.toFixed(2)}
                </h3>
              </div>
              <div className="bg-white p-8 rounded-3xl shadow-xl border-t-8 border-amber-500">
                <p className="text-gray-500 font-black text-xl mb-2">
                  Itatabing Puhunan (Pang-Grocery)
                </p>
                <h3 className="text-5xl font-black text-gray-900">
                  ₱{dailyStats.puhunan.toFixed(2)}
                </h3>
                <p className="text-gray-400 font-bold text-sm mt-2">
                  *Hindi kasama ang GCash principal
                </p>
              </div>
              <div className="bg-white p-8 rounded-3xl shadow-xl border-t-8 border-emerald-500">
                <p className="text-gray-500 font-black text-xl mb-2">
                  Malinis na Tubo (Kabuuang Kita)
                </p>
                <h3 className="text-5xl font-black text-emerald-600">
                  ₱{dailyStats.profit.toFixed(2)}
                </h3>
                <p className="text-emerald-700 font-bold text-sm mt-2">
                  Kasama ang ₱{(dailyStats.serviceProfit || 0).toFixed(2)} mula sa GCash at Print
                </p>
              </div>
            </div>

            {/* ACTION BUTTONS: NEW DAY RESET & FULL STORAGE CLEAR */}
            <div className="flex flex-wrap justify-end gap-4">
              <button
                onClick={() => {
                  if (window.confirm('I-reset ang bilang ng benta at kita para sa bagong araw?')) {
                    setDailyStats({ sales: 0, profit: 0, puhunan: 0, serviceProfit: 0 });
                    setServiceLogs([]);
                    showMessage('Na-reset na ang benta para sa bagong araw!', 'success');
                  }
                }}
                className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-6 py-3 rounded-2xl font-black text-lg flex items-center gap-2"
              >
                <RotateCcw size={22} /> Bagong Araw (Reset Kita Ngayon)
              </button>

              <button
                onClick={() => {
                  if (
                    window.confirm(
                      'SIGURADO KA BA? Buburahin nito ang lumang data na naka-save sa browser na ito.'
                    )
                  ) {
                    localStorage.clear();
                    window.location.reload();
                  }
                }}
                className="bg-red-100 hover:bg-red-200 text-red-800 px-5 py-3 rounded-2xl font-bold text-base flex items-center gap-2"
              >
                <Trash2 size={20} /> Burahin ang Saved Data (Reset Device)
              </button>
            </div>

            {/* RECENT GCASH & PRINT LOGS */}
            {serviceLogs.length > 0 && (
              <div className="bg-white rounded-3xl shadow-xl border-4 border-blue-100 overflow-hidden">
                <div className="bg-blue-50 p-5 border-b-2 border-blue-200">
                  <h3 className="text-2xl font-black text-blue-900 flex items-center gap-2">
                    <Smartphone size={26} /> Talaan ng GCash / Bank at Print Ngayon
                  </h3>
                </div>
                <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[260px] overflow-y-auto">
                  {serviceLogs.map((log) => (
                    <div
                      key={log.id}
                      className="p-3 rounded-2xl bg-blue-50/50 border border-blue-200 flex justify-between items-center"
                    >
                      <div>
                        <span className="font-black text-lg text-gray-800 block">
                          {log.type}
                        </span>
                        <span className="text-sm text-gray-500 font-bold">
                          Oras: {log.time} | Halaga: ₱{Number(log.principal).toFixed(2)}
                        </span>
                      </div>
                      <span className="text-xl font-black text-emerald-700">
                        +₱{Number(log.fee).toFixed(2)} Tubo
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* UTANG & PAUBOS NA STOCK */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="bg-white rounded-3xl shadow-xl border-4 border-amber-100 overflow-hidden">
                <div className="bg-amber-50 p-6 border-b-2 border-amber-200">
                  <h3 className="text-2xl font-black text-amber-900 flex items-center gap-2">
                    <BookOpen size={28} /> Lista ng Utang ({utangList.length})
                  </h3>
                </div>
                <div className="p-6 space-y-4 max-h-[420px] overflow-y-auto">
                  {utangList.length === 0 ? (
                    <p className="text-gray-400 text-xl font-bold text-center py-8">
                      Walang nakalistang utang.
                    </p>
                  ) : (
                    utangList.map((u) => (
                      <div
                        key={u.id}
                        className="p-4 rounded-2xl bg-amber-50/60 border-2 border-amber-200 flex justify-between items-center gap-4"
                      >
                        <div>
                          <h4 className="text-2xl font-black text-gray-900">{u.customer}</h4>
                          <p className="text-gray-600 font-bold text-base">{u.itemsSummary}</p>
                          <p className="text-gray-400 text-sm font-semibold">{u.date}</p>
                        </div>
                        <div className="text-right space-y-2">
                          <div className="text-3xl font-black text-amber-800">
                            ₱{u.amount.toFixed(2)}
                          </div>
                          <button
                            onClick={() => markUtangPaid(u)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-xl font-black text-lg"
                          >
                            ✓ Bayad Na
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="bg-white rounded-3xl shadow-xl border-4 border-red-100 overflow-hidden">
                <div className="bg-red-50 p-6 border-b-2 border-red-200">
                  <h3 className="text-2xl font-black text-red-900 flex items-center gap-2">
                    <AlertTriangle size={28} /> Paubos na ang Stock ({lowStockItems.length})
                  </h3>
                  <p className="text-red-700 font-semibold text-base">
                    Mga panindang 5 piraso o mas mababa na lang ang natitira:
                  </p>
                </div>
                <div className="p-6 space-y-3 max-h-[420px] overflow-y-auto">
                  {lowStockItems.length === 0 ? (
                    <p className="text-gray-400 text-xl font-bold text-center py-8">
                      Walang paubos na paninda sa ngayon.
                    </p>
                  ) : (
                    lowStockItems.map((item) => (
                      <div
                        key={item.id}
                        className="p-4 rounded-2xl bg-red-50/50 border-2 border-red-200 flex justify-between items-center"
                      >
                        <div>
                          <h4 className="text-2xl font-black text-gray-900">{item.name}</h4>
                          <p className="text-gray-500 font-bold">
                            Presyo: ₱{item.price.toFixed(2)}
                          </p>
                        </div>
                        <span
                          className={`px-4 py-2 rounded-xl font-black text-xl ${
                            item.qty === 0
                              ? 'bg-red-600 text-white'
                              : 'bg-amber-200 text-amber-900'
                          }`}
                        >
                          {item.qty === 0 ? 'UBOS NA' : `${item.qty} pcs na lang`}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;