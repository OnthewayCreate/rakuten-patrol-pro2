import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ShieldAlert,
  Search,
  LayoutDashboard,
  FolderOpen,
  LogOut,
  Settings,
  Play,
  Loader2,
  CheckCircle,
  AlertTriangle,
  XCircle,
  ExternalLink,
  Menu,
  X,
  Terminal,
  Activity,
  Zap,
  Store,
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
  doc,
  updateDoc,
  setDoc,
} from 'firebase/firestore';

// --- Firebase Config ---
// 提供された設定情報を使用
const firebaseConfig = {
  apiKey: 'AIzaSyC3YN7a3q1gb-i0KsAiupQaecs3-E8nr7I',
  authDomain: 'rakuten-patrol.firebaseapp.com',
  projectId: 'rakuten-patrol',
  storageBucket: 'rakuten-patrol.firebasestorage.app',
  messagingSenderId: '234266780084',
  appId: '1:234266780084:web:0e45172db4f0c8878b12e1',
};

// Initialize Firebase
let db;
try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
} catch (e) {
  console.warn('Firebase init warning:', e);
}

// --- Constants ---
const VIEWS = {
  LOGIN: 'login',
  DASHBOARD: 'dashboard',
  SEARCH: 'search',
  HISTORY: 'history',
};
const CONCURRENCY_LIMIT = 3;

export default function App() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  });

  const [view, setView] = useState(user ? VIEWS.DASHBOARD : VIEWS.LOGIN);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Settings
  const [config, setConfig] = useState(() => ({
    rakutenAppId: localStorage.getItem('rakutenAppId') || '',
    geminiApiKey: localStorage.getItem('geminiApiKey') || '',
  }));

  // Scanning State
  const [targetUrl, setTargetUrl] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [queue, setQueue] = useState([]);
  const [activeCount, setActiveCount] = useState(0);
  const [results, setResults] = useState([]);
  const [stats, setStats] = useState({ total: 0, high: 0, medium: 0, low: 0 });
  const [currentSessionId, setCurrentSessionId] = useState(null);

  // Persistence
  useEffect(() => {
    localStorage.setItem('rakutenAppId', config.rakutenAppId);
    localStorage.setItem('geminiApiKey', config.geminiApiKey);
  }, [config]);

  // Auth Logic
  const handleLogin = (e) => {
    e.preventDefault();
    const id = e.target.id.value;
    const pass = e.target.pass.value;

    let userData = null;
    if (id === 'admin' && pass === 'admin') {
      userData = { id: 'admin', name: '管理者', role: 'admin' };
    } else if (id === 'staff' && pass === 'staff') {
      userData = { id: 'staff', name: '担当スタッフ', role: 'staff' };
    }

    if (userData) {
      setUser(userData);
      localStorage.setItem('user', JSON.stringify(userData));
      setView(VIEWS.DASHBOARD);
    } else {
      alert('IDまたはパスワードが違います。(admin/admin または staff/staff)');
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('user');
    setView(VIEWS.LOGIN);
    setResults([]);
  };

  // --- Scan Logic ---
  const startScan = async () => {
    if (!config.rakutenAppId || !config.geminiApiKey) {
      alert('設定画面（サイドバー下部）でAPIキーを入力してください');
      return;
    }

    setIsScanning(true);
    setResults([]);
    setQueue([]);
    setStats({ total: 0, high: 0, medium: 0, low: 0 });

    const sessionId = doc(collection(db, 'sessions')).id;
    setCurrentSessionId(sessionId);

    try {
      const res = await fetch(
        `/api/search?shopUrl=${encodeURIComponent(targetUrl)}&appId=${
          config.rakutenAppId
        }`
      );
      const data = await res.json();

      if (data.error) throw new Error(data.error);
      if (!data.products || data.products.length === 0)
        throw new Error('商品が見つかりませんでした');

      if (db)
        setDoc(doc(db, 'sessions', sessionId), {
          shopCode: data.shopCode,
          shopUrl: targetUrl,
          startTime: serverTimestamp(),
          userId: user.id,
          status: 'running',
        });

      setQueue(data.products.slice(0, 50));
    } catch (e) {
      alert(`エラー: ${e.message}`);
      setIsScanning(false);
    }
  };

  useEffect(() => {
    if (!isScanning) return;
    if (queue.length === 0 && activeCount === 0) {
      setIsScanning(false);
      if (db && currentSessionId)
        updateDoc(doc(db, 'sessions', currentSessionId), {
          status: 'completed',
          endTime: serverTimestamp(),
        });
      return;
    }

    if (activeCount < CONCURRENCY_LIMIT && queue.length > 0) {
      const nextItem = queue[0];
      setQueue((prev) => prev.slice(1));
      setActiveCount((prev) => prev + 1);

      analyzeItem(nextItem).then(() => {
        setActiveCount((prev) => prev - 1);
      });
    }
  }, [queue, activeCount, isScanning]);

  const analyzeItem = async (item) => {
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName: item.name,
          imageUrl: item.imageUrl,
          apiKey: config.geminiApiKey,
        }),
      });

      const analysis = res.ok
        ? await res.json()
        : { risk_level: 'エラー', reason: '解析失敗' };
      const resultItem = { ...item, ...analysis, timestamp: new Date() };

      setResults((prev) => [resultItem, ...prev]);
      setStats((prev) => ({
        ...prev,
        total: prev.total + 1,
        high: analysis.risk_level === '高' ? prev.high + 1 : prev.high,
        medium: analysis.risk_level === '中' ? prev.medium + 1 : prev.medium,
        low: analysis.risk_level === '低' ? prev.low + 1 : prev.low,
      }));

      if (db)
        addDoc(collection(db, 'scan_results'), {
          ...resultItem,
          sessionId: currentSessionId,
          timestamp: serverTimestamp(),
        });
    } catch (e) {
      console.error(e);
    }
  };

  if (!user) return <LoginPage onLogin={handleLogin} />;

  return (
    <div className="flex h-screen w-full bg-slate-50 font-sans text-slate-800 overflow-hidden">
      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 w-full bg-white z-20 border-b border-slate-200 px-4 py-3 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-2 font-bold text-slate-900">
          <ShieldAlert className="text-rakuten" /> 楽天パトロール Pro
        </div>
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="p-2 text-slate-600"
        >
          {isMobileMenuOpen ? <X /> : <Menu />}
        </button>
      </div>

      {/* Sidebar */}
      <aside
        className={`
        fixed inset-y-0 left-0 z-30 w-64 bg-slate-900 text-slate-300 transform transition-transform duration-300 ease-in-out shadow-2xl
        ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        } md:relative md:translate-x-0 flex flex-col
      `}
      >
        <div className="p-6 border-b border-slate-800 hidden md:flex items-center gap-3 bg-slate-950">
          <ShieldAlert className="text-red-500 w-8 h-8" />
          <div>
            <h1 className="font-bold text-white tracking-wide text-lg">
              Patrol Pro
            </h1>
            <p className="text-xs text-slate-500">Intelligent IP Check</p>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2 mt-16 md:mt-4 overflow-y-auto">
          <SidebarItem
            icon={LayoutDashboard}
            label="ダッシュボード"
            active={view === VIEWS.DASHBOARD}
            onClick={() => {
              setView(VIEWS.DASHBOARD);
              setIsMobileMenuOpen(false);
            }}
          />
          <SidebarItem
            icon={Search}
            label="AIパトロール"
            active={view === VIEWS.SEARCH}
            onClick={() => {
              setView(VIEWS.SEARCH);
              setIsMobileMenuOpen(false);
            }}
          />
          <SidebarItem
            icon={FolderOpen}
            label="検査履歴"
            active={view === VIEWS.HISTORY}
            onClick={() => {
              setView(VIEWS.HISTORY);
              setIsMobileMenuOpen(false);
            }}
          />
        </nav>

        <div className="p-4 bg-slate-950 border-t border-slate-800">
          <div className="mb-4">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 block">
              API Configuration
            </label>
            <input
              type="password"
              placeholder="楽天App ID"
              value={config.rakutenAppId}
              onChange={(e) =>
                setConfig({ ...config, rakutenAppId: e.target.value })
              }
              className="w-full bg-slate-800 border-none rounded text-xs px-3 py-2 mb-2 text-white placeholder-slate-600 focus:ring-1 focus:ring-red-500 transition-all"
            />
            <input
              type="password"
              placeholder="Gemini API Key"
              value={config.geminiApiKey}
              onChange={(e) =>
                setConfig({ ...config, geminiApiKey: e.target.value })
              }
              className="w-full bg-slate-800 border-none rounded text-xs px-3 py-2 text-white placeholder-slate-600 focus:ring-1 focus:ring-red-500 transition-all"
            />
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800 p-2 rounded w-full transition-colors"
          >
            <LogOut size={16} /> ログアウト
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden bg-slate-50 pt-16 md:pt-0 w-full">
        <header className="px-6 md:px-10 py-6 md:py-8 bg-white border-b border-slate-100 flex justify-between items-end sticky top-0 z-10">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">
              {view === VIEWS.DASHBOARD && 'Dashboard'}
              {view === VIEWS.SEARCH && 'AI Inspection'}
              {view === VIEWS.HISTORY && 'Archive'}
            </h2>
            <p className="text-slate-500 text-sm mt-1">
              ようこそ、
              <span className="font-medium text-slate-700">{user.name}</span>{' '}
              さん
            </p>
          </div>
          {isScanning && (
            <div className="hidden md:flex items-center gap-3 bg-blue-50 px-5 py-2.5 rounded-full shadow-sm border border-blue-100 animate-pulse">
              <Loader2 className="animate-spin text-blue-600" size={18} />
              <span className="text-sm font-bold text-blue-700">
                AI解析進行中... {activeCount}並列
              </span>
            </div>
          )}
        </header>

        <div className="p-4 md:p-10 w-full max-w-[1600px] mx-auto">
          {view === VIEWS.DASHBOARD && (
            <DashboardView
              stats={stats}
              results={results}
              onNew={() => setView(VIEWS.SEARCH)}
            />
          )}
          {view === VIEWS.SEARCH && (
            <SearchView
              targetUrl={targetUrl}
              setTargetUrl={setTargetUrl}
              onStart={startScan}
              isScanning={isScanning}
              results={results}
              queueCount={queue.length}
            />
          )}
          {view === VIEWS.HISTORY && (
            <div className="text-center py-32 text-slate-400 bg-white rounded-2xl border border-dashed border-slate-300">
              履歴機能は準備中です
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// --- PC向けに幅を広げたコンポーネント ---

const LoginPage = ({ onLogin }) => (
  <div className="min-h-screen w-full bg-slate-100 flex items-center justify-center p-4 relative overflow-hidden">
    {/* 背景装飾 */}
    <div className="absolute inset-0 bg-slate-900 overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full bg-[url('https://images.unsplash.com/photo-1557683316-973673baf926?auto=format&fit=crop&q=80')] bg-cover opacity-10"></div>
    </div>

    <div className="bg-white/95 backdrop-blur-sm p-8 md:p-12 rounded-2xl shadow-2xl w-full max-w-md border border-slate-200 relative z-10">
      <div className="text-center mb-8">
        <div className="bg-rakuten w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-red-200 rotate-3 hover:rotate-0 transition-transform duration-500">
          <ShieldAlert className="text-white w-9 h-9" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">
          楽天パトロール Pro
        </h1>
        <p className="text-slate-500 text-sm">Enterprise AI Security System</p>
      </div>
      <form onSubmit={onLogin} className="space-y-5">
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">
            User ID
          </label>
          <input
            name="id"
            placeholder="admin"
            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white transition-all font-medium"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">
            Password
          </label>
          <input
            name="pass"
            type="password"
            placeholder="••••••"
            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white transition-all font-medium"
          />
        </div>
        <button className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-lg hover:bg-slate-800 transition-all active:scale-95 shadow-xl hover:shadow-2xl mt-2">
          ログイン
        </button>
      </form>
      <div className="mt-8 text-center text-xs text-slate-400">
        Protected by Google Gemini 2.5 Flash
      </div>
    </div>
  </div>
);

const SidebarItem = ({ icon: Icon, label, active, onClick }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-lg transition-all group ${
      active
        ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30'
        : 'hover:bg-slate-800 text-slate-400 hover:text-white'
    }`}
  >
    <Icon
      size={20}
      className={`transition-transform group-hover:scale-110 ${
        active ? 'text-blue-200' : ''
      }`}
    />
    <span className="font-medium text-sm">{label}</span>
    {active && (
      <div className="ml-auto w-1.5 h-1.5 bg-white rounded-full"></div>
    )}
  </button>
);

const DashboardView = ({ stats, results, onNew }) => (
  <div className="space-y-8 w-full">
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
      <StatCard
        label="検査総数"
        value={stats.total}
        color="bg-blue-50 text-blue-600"
        border="border-blue-100"
        icon={Activity}
      />
      <StatCard
        label="高リスク検知"
        value={stats.high}
        color="bg-red-50 text-red-600"
        border="border-red-100"
        icon={AlertTriangle}
      />
      <StatCard
        label="中リスク"
        value={stats.medium}
        color="bg-yellow-50 text-yellow-600"
        border="border-yellow-100"
        icon={Zap}
      />
      <StatCard
        label="安全判定"
        value={stats.low}
        color="bg-green-50 text-green-600"
        border="border-green-100"
        icon={CheckCircle}
      />
    </div>

    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
        <h3 className="font-bold text-slate-700 flex items-center gap-2">
          <Activity size={18} className="text-slate-400" /> 最新のアクティビティ
        </h3>
        <button
          onClick={onNew}
          className="text-sm bg-white border border-slate-200 px-4 py-2 rounded-lg text-slate-600 hover:text-blue-600 hover:border-blue-200 hover:shadow-sm transition-all flex items-center gap-2 font-medium"
        >
          <Play size={14} /> 新規パトロールを開始
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="px-6 py-4 font-bold">判定</th>
              <th className="px-6 py-4 font-bold">商品情報</th>
              <th className="px-6 py-4 font-bold">AI判定理由</th>
              <th className="px-6 py-4 font-bold text-right">時刻</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {results.length === 0 ? (
              <tr>
                <td
                  colSpan="4"
                  className="px-6 py-20 text-center text-slate-400"
                >
                  データがありません
                </td>
              </tr>
            ) : (
              results.slice(0, 10).map((r, i) => <ResultRow key={i} item={r} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  </div>
);

const SearchView = ({
  targetUrl,
  setTargetUrl,
  onStart,
  isScanning,
  results,
  queueCount,
}) => (
  <div className="grid lg:grid-cols-12 gap-6 w-full h-[calc(100vh-140px)]">
    {/* Left Panel: Input & Monitor */}
    <div className="lg:col-span-8 flex flex-col gap-6 h-full">
      <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-slate-200 flex-shrink-0">
        <label className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
          <Store size={14} /> Target Shop URL
        </label>
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1 group">
            <div className="absolute left-3 top-3.5 text-slate-400 group-focus-within:text-blue-500 transition-colors">
              <Search size={18} />
            </div>
            <input
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              className="w-full pl-10 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all font-mono text-sm"
              placeholder="https://www.rakuten.co.jp/..."
            />
          </div>
          <button
            onClick={onStart}
            disabled={isScanning || !targetUrl}
            className={`px-8 py-3.5 rounded-xl font-bold text-white shadow-lg transition-all flex items-center justify-center gap-2 min-w-[160px] ${
              isScanning
                ? 'bg-slate-400 cursor-not-allowed'
                : 'bg-slate-900 hover:bg-slate-800 hover:scale-105 hover:shadow-xl'
            }`}
          >
            {isScanning ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Play size={18} fill="currentColor" />
            )}
            {isScanning ? '検査中...' : '解析開始'}
          </button>
        </div>
      </div>

      {/* Results List */}
      <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
          <h3 className="font-bold text-slate-700">リアルタイム検知ログ</h3>
          <span className="text-xs font-mono text-slate-400">
            {results.length} 件処理済み
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {results.map((r, i) => (
            <div
              key={i}
              className="bg-white p-3 rounded-xl border border-slate-100 hover:border-slate-300 transition-all flex gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300"
            >
              <div className="flex-shrink-0">
                {r.imageUrl ? (
                  <img
                    src={r.imageUrl}
                    className="w-16 h-16 object-cover rounded-lg bg-slate-100 border border-slate-100"
                  />
                ) : (
                  <div className="w-16 h-16 bg-slate-100 rounded-lg flex items-center justify-center text-slate-300">
                    <Store />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 py-1">
                <div className="flex items-center gap-2 mb-1">
                  <RiskBadge level={r.risk_level} />
                  <span className="text-xs text-slate-400 font-mono ml-auto">
                    {new Date(r.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <h4 className="font-bold text-slate-800 truncate text-sm mb-0.5">
                  {r.name}
                </h4>
                <p className="text-xs text-slate-500 line-clamp-1">
                  {r.reason}
                </p>
              </div>
            </div>
          ))}
          {results.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-slate-300 space-y-4">
              <Search size={48} className="opacity-20" />
              <p>ここに解析結果が表示されます</p>
            </div>
          )}
        </div>
      </div>
    </div>

    {/* Right Panel: Status */}
    <div className="lg:col-span-4 flex flex-col gap-6 h-full">
      {isScanning ? (
        <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-2xl ring-1 ring-white/10 sticky top-6">
          <h3 className="font-mono font-bold text-green-400 mb-6 flex items-center gap-2 text-lg">
            <Terminal size={20} /> SYSTEM ACTIVE
          </h3>
          <div className="space-y-6 font-mono text-sm">
            <div className="flex justify-between border-b border-slate-800 pb-2">
              <span className="text-slate-400">Status</span>
              <span className="text-green-400 animate-pulse font-bold">
                Scanning...
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-800 pb-2">
              <span className="text-slate-400">Threads</span>
              <span className="text-white">{CONCURRENCY_LIMIT} Concurrent</span>
            </div>
            <div className="flex justify-between border-b border-slate-800 pb-2">
              <span className="text-slate-400">Queue</span>
              <span className="text-yellow-400 font-bold">
                {queueCount} items
              </span>
            </div>

            <div className="bg-slate-800 p-4 rounded-lg mt-4 border border-slate-700">
              <p className="text-xs text-slate-400 mb-1">AI Engine:</p>
              <p className="font-bold text-blue-300">Google Gemini 2.5 Flash</p>
              <div className="mt-2 h-1.5 w-full bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 animate-progress"></div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 p-8 rounded-2xl text-center h-full flex flex-col items-center justify-center text-slate-400 border-dashed">
          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
            <Zap size={24} className="text-slate-300" />
          </div>
          <p className="font-medium text-slate-600">システム待機中</p>
          <p className="text-sm mt-2">
            左のパネルからURLを入力して
            <br />
            検査を開始してください
          </p>
        </div>
      )}
    </div>
  </div>
);

const StatCard = ({ label, value, color, icon: Icon, border }) => (
  <div
    className={`bg-white p-6 rounded-xl border ${border} shadow-sm flex items-center justify-between hover:shadow-md transition-shadow`}
  >
    <div>
      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className="text-3xl font-bold text-slate-800">{value}</p>
    </div>
    <div className={`p-4 rounded-xl ${color} bg-opacity-10`}>
      <Icon size={24} className={color.split(' ')[1]} />
    </div>
  </div>
);

const ResultRow = ({ item }) => (
  <tr className="hover:bg-blue-50/30 transition-colors group">
    <td className="px-6 py-4">
      <RiskBadge level={item.risk_level} />
    </td>
    <td className="px-6 py-4">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-lg bg-slate-100 flex-shrink-0 overflow-hidden border border-slate-200">
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Store size={16} className="text-slate-300" />
            </div>
          )}
        </div>
        <div>
          <div className="max-w-xs truncate font-bold text-slate-700 text-sm">
            {item.name}
          </div>
          <a
            href={item.url}
            target="_blank"
            className="text-xs text-blue-500 hover:underline flex items-center gap-1 mt-0.5"
          >
            <ExternalLink size={10} /> 商品ページを開く
          </a>
        </div>
      </div>
    </td>
    <td className="px-6 py-4 text-slate-600 text-sm max-w-sm truncate font-medium">
      {item.reason}
    </td>
    <td className="px-6 py-4 text-slate-400 text-xs text-right font-mono">
      {new Date(item.timestamp).toLocaleTimeString()}
    </td>
  </tr>
);

const RiskBadge = ({ level }) => {
  const styles = {
    高: 'bg-red-50 text-red-600 border-red-200 ring-red-500/20',
    中: 'bg-yellow-50 text-yellow-600 border-yellow-200 ring-yellow-500/20',
    低: 'bg-green-50 text-green-600 border-green-200 ring-green-500/20',
    エラー: 'bg-gray-50 text-gray-600 border-gray-200',
  };
  return (
    <span
      className={`px-3 py-1 rounded-full text-xs font-bold border ring-1 ${
        styles[level] || styles['エラー']
      } inline-flex items-center gap-1`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          level === '高'
            ? 'bg-red-500 animate-pulse'
            : level === '中'
            ? 'bg-yellow-500'
            : 'bg-green-500'
        }`}
      ></span>
      {level}
    </span>
  );
};
