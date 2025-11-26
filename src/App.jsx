import React, { useState, useEffect } from 'react';
import { 
  ShieldAlert, Search, LayoutDashboard, FolderOpen, LogOut, 
  Settings, Play, Loader2, CheckCircle, AlertTriangle, Zap, Store,
  ExternalLink, Menu, X, Terminal, Activity, ArrowRight, Calendar, Clock
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, serverTimestamp, doc, updateDoc, setDoc, query, orderBy, limit, getDocs, where } from 'firebase/firestore';

// --- Firebase Config ---
const firebaseConfig = {
  apiKey: "AIzaSyC3YN7a3q1gb-i0KsAiupQaecs3-E8nr7I",
  authDomain: "rakuten-patrol.firebaseapp.com",
  projectId: "rakuten-patrol",
  storageBucket: "rakuten-patrol.firebasestorage.app",
  messagingSenderId: "234266780084",
  appId: "1:234266780084:web:0e45172db4f0c8878b12e1"
};

// Initialize Firebase
let db;
try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
} catch (e) {
  console.warn("Firebase init warning:", e);
}

// --- Constants ---
const VIEWS = { LOGIN: 'login', DASHBOARD: 'dashboard', SEARCH: 'search', HISTORY: 'history' };
const CONCURRENCY_LIMIT = 3;
// ★簡易パスワード（ここを変更すればパスワードが変わります）
const ACCESS_PASSWORD = "start"; 

export default function App() {
  // Auth State
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return localStorage.getItem('auth_token') === 'valid';
  });

  // App State
  const [view, setView] = useState(isAuthenticated ? VIEWS.DASHBOARD : VIEWS.LOGIN);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [config, setConfig] = useState(() => ({
    rakutenAppId: localStorage.getItem('rakutenAppId') || '',
    geminiApiKey: localStorage.getItem('geminiApiKey') || ''
  }));

  // Scanning State
  const [targetUrl, setTargetUrl] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [queue, setQueue] = useState([]);
  const [activeCount, setActiveCount] = useState(0);
  const [results, setResults] = useState([]);
  const [stats, setStats] = useState({ total: 0, high: 0, medium: 0, low: 0 });
  const [currentSessionId, setCurrentSessionId] = useState(null);

  // History State
  const [historySessions, setHistorySessions] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Persistence
  useEffect(() => {
    localStorage.setItem('rakutenAppId', config.rakutenAppId);
    localStorage.setItem('geminiApiKey', config.geminiApiKey);
  }, [config]);

  // --- Auth Functions ---
  const handleLogin = (e) => {
    e.preventDefault();
    const inputPass = e.target.pass.value;
    if (inputPass === ACCESS_PASSWORD) {
      setIsAuthenticated(true);
      localStorage.setItem('auth_token', 'valid');
      setView(VIEWS.DASHBOARD);
    } else {
      alert('パスワードが違います');
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem('auth_token');
    setView(VIEWS.LOGIN);
    setResults([]);
  };

  // --- Scan Logic ---
  const startScan = async () => {
    if (!config.rakutenAppId || !config.geminiApiKey) {
      alert('【重要】左下の設定メニューから、楽天アプリIDとGemini APIキーを入力してください。');
      return;
    }
    
    setIsScanning(true);
    setResults([]);
    setQueue([]);
    setStats({ total: 0, high: 0, medium: 0, low: 0 });
    
    const sessionId = doc(collection(db, 'sessions')).id;
    setCurrentSessionId(sessionId);

    try {
      // API呼び出し
      const res = await fetch(`/api/search?shopUrl=${encodeURIComponent(targetUrl)}&appId=${config.rakutenAppId}`);
      const data = await res.json();
      
      if (data.error) throw new Error(data.error);
      if (!data.products || data.products.length === 0) throw new Error('商品が見つかりませんでした。URLを確認してください。');

      // セッション開始を記録
      if(db) setDoc(doc(db, 'sessions', sessionId), {
        shopCode: data.shopCode,
        shopUrl: targetUrl,
        startTime: serverTimestamp(),
        status: 'running',
        itemCount: data.products.length
      });

      setQueue(data.products.slice(0, 50)); // デモ用に50件制限
    } catch (e) {
      alert(`スキャン開始エラー:\n${e.message}`);
      setIsScanning(false);
    }
  };

  // Queue Processor
  useEffect(() => {
    if (!isScanning) return;
    if (queue.length === 0 && activeCount === 0) {
      setIsScanning(false);
      if(db && currentSessionId) updateDoc(doc(db, 'sessions', currentSessionId), { status: 'completed', endTime: serverTimestamp() });
      return;
    }

    if (activeCount < CONCURRENCY_LIMIT && queue.length > 0) {
      const nextItem = queue[0];
      setQueue(prev => prev.slice(1));
      setActiveCount(prev => prev + 1);
      
      analyzeItem(nextItem).then(() => {
        setActiveCount(prev => prev - 1);
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
          apiKey: config.geminiApiKey 
        })
      });

      const analysis = res.ok ? await res.json() : { risk_level: 'エラー', reason: '解析失敗' };
      const resultItem = { ...item, ...analysis, timestamp: new Date() };

      setResults(prev => [resultItem, ...prev]);
      setStats(prev => ({
        ...prev,
        total: prev.total + 1,
        high: analysis.risk_level === '高' ? prev.high + 1 : prev.high,
        medium: analysis.risk_level === '中' ? prev.medium + 1 : prev.medium,
        low: analysis.risk_level === '低' ? prev.low + 1 : prev.low
      }));

      if(db) addDoc(collection(db, 'scan_results'), { ...resultItem, sessionId: currentSessionId, timestamp: serverTimestamp() });

    } catch (e) {
      console.error(e);
    }
  };

  // --- History Logic ---
  const fetchHistory = async () => {
    if (!db) return;
    setLoadingHistory(true);
    try {
      const q = query(collection(db, 'sessions'), orderBy('startTime', 'desc'), limit(20));
      const snapshot = await getDocs(q);
      const sessions = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setHistorySessions(sessions);
    } catch (e) {
      console.error("履歴取得エラー", e);
    } finally {
      setLoadingHistory(false);
    }
  };

  const loadSession = async (sessionId) => {
    if (!db) return;
    const q = query(collection(db, 'scan_results'), where('sessionId', '==', sessionId));
    const snapshot = await getDocs(q);
    const loadedResults = snapshot.docs.map(d => {
        const data = d.data();
        return { ...data, timestamp: data.timestamp?.toDate() || new Date() }; // Firestore Timestamp変換
    });
    setResults(loadedResults);
    
    // 再集計
    const newStats = { total: 0, high: 0, medium: 0, low: 0 };
    loadedResults.forEach(r => {
        newStats.total++;
        if(r.risk_level === '高') newStats.high++;
        else if(r.risk_level === '中') newStats.medium++;
        else if(r.risk_level === '低') newStats.low++;
    });
    setStats(newStats);
    setView(VIEWS.DASHBOARD); // ダッシュボードで表示
  };

  // 履歴タブを開いた時にロード
  useEffect(() => {
    if (view === VIEWS.HISTORY) {
      fetchHistory();
    }
  }, [view]);


  // --- Render ---
  if (!isAuthenticated) return <SimpleLoginPage onLogin={handleLogin} />;

  return (
    <div className="flex h-screen w-full bg-slate-50 font-sans text-slate-800 overflow-hidden">
      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 w-full bg-white z-20 border-b border-slate-200 px-4 py-3 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-2 font-bold text-slate-900">
          <ShieldAlert className="text-rakuten" /> 楽天パトロール Pro
        </div>
        <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 text-slate-600">
          {isMobileMenuOpen ? <X /> : <Menu />}
        </button>
      </div>

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-30 w-64 bg-slate-900 text-slate-300 transform transition-transform duration-300 ease-in-out shadow-2xl
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0 flex flex-col
      `}>
        <div className="p-6 border-b border-slate-800 hidden md:flex items-center gap-3 bg-slate-950">
          <ShieldAlert className="text-red-500 w-8 h-8" />
          <div>
            <h1 className="font-bold text-white tracking-wide text-lg">Patrol Pro</h1>
            <p className="text-xs text-slate-500">Intelligent IP Check</p>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2 mt-16 md:mt-4 overflow-y-auto">
          <SidebarItem icon={LayoutDashboard} label="ダッシュボード" active={view === VIEWS.DASHBOARD} onClick={() => { setView(VIEWS.DASHBOARD); setIsMobileMenuOpen(false); }} />
          <SidebarItem icon={Search} label="新規パトロール" active={view === VIEWS.SEARCH} onClick={() => { setView(VIEWS.SEARCH); setIsMobileMenuOpen(false); }} />
          <SidebarItem icon={FolderOpen} label="履歴アーカイブ" active={view === VIEWS.HISTORY} onClick={() => { setView(VIEWS.HISTORY); setIsMobileMenuOpen(false); }} />
        </nav>

        <div className="p-4 bg-slate-950 border-t border-slate-800">
          <div className="mb-4">
             <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 block flex items-center gap-1"><Settings size={10}/> API Configuration</label>
             <input type="password" placeholder="楽天App ID" value={config.rakutenAppId} onChange={e => setConfig({...config, rakutenAppId: e.target.value})} className="w-full bg-slate-800 border-none rounded text-xs px-3 py-2 mb-2 text-white placeholder-slate-600 focus:ring-1 focus:ring-red-500 transition-all" />
             <input type="password" placeholder="Gemini API Key" value={config.geminiApiKey} onChange={e => setConfig({...config, geminiApiKey: e.target.value})} className="w-full bg-slate-800 border-none rounded text-xs px-3 py-2 text-white placeholder-slate-600 focus:ring-1 focus:ring-red-500 transition-all" />
          </div>
          <button onClick={handleLogout} className="flex items-center gap-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800 p-2 rounded w-full transition-colors">
            <LogOut size={16} /> 終了する
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden bg-slate-50 pt-16 md:pt-0 w-full">
        <header className="px-6 md:px-10 py-6 md:py-8 bg-white border-b border-slate-100 flex justify-between items-end sticky top-0 z-10">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">
              {view === VIEWS.DASHBOARD && 'Dashboard'}
              {view === VIEWS.SEARCH && 'New Inspection'}
              {view === VIEWS.HISTORY && 'Scan History'}
            </h2>
            <p className="text-slate-500 text-sm mt-1">Status: <span className="text-green-600 font-bold">Online</span></p>
          </div>
          {isScanning && (
            <div className="hidden md:flex items-center gap-3 bg-blue-50 px-5 py-2.5 rounded-full shadow-sm border border-blue-100 animate-pulse">
               <Loader2 className="animate-spin text-blue-600" size={18} />
               <span className="text-sm font-bold text-blue-700">AI解析進行中... {activeCount}並列</span>
            </div>
          )}
        </header>

        <div className="p-4 md:p-10 w-full max-w-[1600px] mx-auto min-h-[calc(100vh-140px)]">
          {view === VIEWS.DASHBOARD && <DashboardView stats={stats} results={results} onNew={() => setView(VIEWS.SEARCH)} />}
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
            <HistoryView 
                sessions={historySessions} 
                loading={loadingHistory} 
                onLoadSession={loadSession} 
            />
          )}
        </div>
      </main>
    </div>
  );
}

// --- Components ---

const SimpleLoginPage = ({ onLogin }) => (
  <div className="min-h-screen w-full bg-slate-900 flex items-center justify-center p-4 relative overflow-hidden">
    <div className="bg-white p-8 md:p-12 rounded-2xl shadow-2xl w-full max-w-sm relative z-10">
      <div className="text-center mb-8">
        <div className="bg-rakuten w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-red-900/20">
          <ShieldAlert className="text-white w-8 h-8" />
        </div>
        <h1 className="text-xl font-bold text-slate-900">楽天パトロール Pro</h1>
        <p className="text-slate-500 text-xs mt-1">Access Authentication</p>
      </div>
      <form onSubmit={onLogin} className="space-y-4">
        <div>
           <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">Access Password</label>
           <input name="pass" type="password" placeholder="パスワードを入力 (start)" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white transition-all font-bold text-center tracking-widest" />
        </div>
        <button className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-lg hover:bg-slate-800 transition-all active:scale-95 shadow-xl mt-2 flex items-center justify-center gap-2">
           <Zap size={18}/> 作業を開始
        </button>
      </form>
    </div>
  </div>
);

const SidebarItem = ({ icon: Icon, label, active, onClick }) => (
  <button onClick={onClick} className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-lg transition-all group ${active ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30' : 'hover:bg-slate-800 text-slate-400 hover:text-white'}`}>
    <Icon size={20} className={`transition-transform group-hover:scale-110 ${active ? 'text-blue-200' : ''}`} />
    <span className="font-medium text-sm">{label}</span>
  </button>
);

const DashboardView = ({ stats, results, onNew }) => (
  <div className="space-y-8 w-full">
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
      <StatCard label="対象商品数" value={stats.total} color="bg-blue-50 text-blue-600" border="border-blue-100" icon={Activity} />
      <StatCard label="高リスク" value={stats.high} color="bg-red-50 text-red-600" border="border-red-100" icon={AlertTriangle} />
      <StatCard label="中リスク" value={stats.medium} color="bg-yellow-50 text-yellow-600" border="border-yellow-100" icon={Zap} />
      <StatCard label="安全" value={stats.low} color="bg-green-50 text-green-600" border="border-green-100" icon={CheckCircle} />
    </div>

    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
        <h3 className="font-bold text-slate-700 flex items-center gap-2">
           <Activity size={18} className="text-slate-400"/> 解析結果レポート
        </h3>
        {results.length === 0 && (
            <button onClick={onNew} className="text-sm bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition-all flex items-center gap-2 font-medium shadow-md">
            <Play size={14} /> 新規パトロール
            </button>
        )}
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
              <tr><td colSpan="4" className="px-6 py-20 text-center text-slate-400">データがありません。<br/>新規パトロールから検査を開始してください。</td></tr>
            ) : (
              results.slice(0, 50).map((r, i) => <ResultRow key={i} item={r} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  </div>
);

const SearchView = ({ targetUrl, setTargetUrl, onStart, isScanning, results, queueCount }) => (
  <div className="grid lg:grid-cols-12 gap-6 w-full h-[calc(100vh-140px)]">
    <div className="lg:col-span-8 flex flex-col gap-6 h-full">
      <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-slate-200 flex-shrink-0">
        <label className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
           <Store size={14}/> Target Shop URL
        </label>
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1 group">
            <div className="absolute left-3 top-3.5 text-slate-400 group-focus-within:text-blue-500 transition-colors">
               <Search size={18}/>
            </div>
            <input 
              value={targetUrl} 
              onChange={(e) => setTargetUrl(e.target.value)}
              className="w-full pl-10 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all font-mono text-sm" 
              placeholder="https://www.rakuten.co.jp/ショップID/..."
            />
          </div>
          <button 
            onClick={onStart} 
            disabled={isScanning || !targetUrl}
            className={`px-8 py-3.5 rounded-xl font-bold text-white shadow-lg transition-all flex items-center justify-center gap-2 min-w-[160px] ${isScanning ? 'bg-slate-400 cursor-not-allowed' : 'bg-slate-900 hover:bg-slate-800 hover:scale-105 hover:shadow-xl'}`}
          >
            {isScanning ? <Loader2 className="animate-spin" /> : <Play size={18} fill="currentColor" />}
            {isScanning ? '中断' : '解析開始'}
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-2 ml-1">※ 楽天GoldのURL (www.rakuten.ne.jp/gold/...) にも対応しています。</p>
      </div>

      <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
         <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
            <h3 className="font-bold text-slate-700">リアルタイム検知ログ</h3>
            <span className="text-xs font-mono text-slate-400">{results.length} 件完了</span>
         </div>
         <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {results.map((r, i) => (
              <div key={i} className="bg-white p-3 rounded-xl border border-slate-100 hover:border-slate-300 transition-all flex gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="flex-shrink-0">
                  {r.imageUrl ? <img src={r.imageUrl} className="w-16 h-16 object-cover rounded-lg bg-slate-100 border border-slate-100" /> : <div className="w-16 h-16 bg-slate-100 rounded-lg flex items-center justify-center text-slate-300"><Store/></div>}
                </div>
                <div className="flex-1 min-w-0 py-1">
                  <div className="flex items-center gap-2 mb-1">
                      <RiskBadge level={r.risk_level} />
                      <span className="text-xs text-slate-400 font-mono ml-auto">{new Date(r.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <h4 className="font-bold text-slate-800 truncate text-sm mb-0.5">{r.name}</h4>
                  <p className="text-xs text-slate-500 line-clamp-1">{r.reason}</p>
                </div>
              </div>
            ))}
            {results.length === 0 && (
               <div className="h-full flex flex-col items-center justify-center text-slate-300 space-y-4">
                  <Search size={48} className="opacity-20"/>
                  <p>待機中...</p>
               </div>
            )}
         </div>
      </div>
    </div>
    
    <div className="lg:col-span-4 flex flex-col gap-6 h-full">
        {isScanning ? (
          <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-2xl ring-1 ring-white/10 sticky top-6">
            <h3 className="font-mono font-bold text-green-400 mb-6 flex items-center gap-2 text-lg">
               <Terminal size={20}/> SYSTEM ACTIVE
            </h3>
            <div className="space-y-6 font-mono text-sm">
              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-400">Status</span>
                <span className="text-green-400 animate-pulse font-bold">Scanning...</span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-400">Queue</span>
                <span className="text-yellow-400 font-bold">{queueCount} items</span>
              </div>
              <div className="bg-slate-800 p-4 rounded-lg mt-4 border border-slate-700">
                 <p className="text-xs text-slate-400 mb-1">AI Engine:</p>
                 <p className="font-bold text-blue-300">Google Gemini 2.5</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 p-8 rounded-2xl text-center h-full flex flex-col items-center justify-center text-slate-400 border-dashed">
             <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                <Zap size={24} className="text-slate-300"/>
             </div>
             <p className="font-medium text-slate-600">システム待機中</p>
          </div>
        )}
    </div>
  </div>
);

// --- History View ---
const HistoryView = ({ sessions, loading, onLoadSession }) => (
  <div className="w-full max-w-5xl mx-auto">
    <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold text-slate-700 flex items-center gap-2">
           <FolderOpen className="text-blue-500"/> 履歴アーカイブ
        </h3>
        {loading && <Loader2 className="animate-spin text-slate-400"/>}
    </div>

    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-100">
                <tr>
                    <th className="px-6 py-4 font-bold">日時</th>
                    <th className="px-6 py-4 font-bold">ショップ</th>
                    <th className="px-6 py-4 font-bold">ステータス</th>
                    <th className="px-6 py-4 font-bold text-right">アクション</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
                {sessions.length === 0 ? (
                    <tr><td colSpan="4" className="px-6 py-12 text-center text-slate-400">履歴はまだありません</td></tr>
                ) : (
                    sessions.map((session) => (
                        <tr key={session.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4 text-slate-600 flex items-center gap-2">
                                <Calendar size={14} className="text-slate-400"/>
                                {session.startTime ? new Date(session.startTime.toDate()).toLocaleString() : '-'}
                            </td>
                            <td className="px-6 py-4 font-medium text-slate-800">
                                {session.shopUrl || session.shopCode || '不明なショップ'}
                            </td>
                            <td className="px-6 py-4">
                                <span className={`px-2 py-1 rounded text-xs font-bold ${session.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                                    {session.status === 'completed' ? '完了' : '実行中/中断'}
                                </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                                <button onClick={() => onLoadSession(session.id)} className="text-blue-600 hover:underline text-xs font-bold flex items-center gap-1 justify-end">
                                    結果を見る <ArrowRight size={12}/>
                                </button>
                            </td>
                        </tr>
                    ))
                )}
            </tbody>
        </table>
    </div>
  </div>
);

const StatCard = ({ label, value, color, icon: Icon, border }) => (
  <div className={`bg-white p-6 rounded-xl border ${border} shadow-sm flex items-center justify-between hover:shadow-md transition-shadow`}>
    <div>
      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-3xl font-bold text-slate-800">{value}</p>
    </div>
    <div className={`p-4 rounded-xl ${color} bg-opacity-10`}>
      <Icon size={24} className={color.split(' ')[1]} />
    </div>
  </div>
);

const ResultRow = ({ item }) => (
  <tr className="hover:bg-blue-50/30 transition-colors group">
    <td className="px-6 py-4"><RiskBadge level={item.risk_level} /></td>
    <td className="px-6 py-4">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-lg bg-slate-100 flex-shrink-0 overflow-hidden border border-slate-200">
           {item.imageUrl ? <img src={item.imageUrl} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" /> : <div className="w-full h-full flex items-center justify-center"><Store size={16} className="text-slate-300"/></div>}
        </div>
        <div>
           <div className="max-w-xs truncate font-bold text-slate-700 text-sm">{item.name}</div>
           <a href={item.url} target="_blank" className="text-xs text-blue-500 hover:underline flex items-center gap-1 mt-0.5"><ExternalLink size={10}/> 商品ページ</a>
        </div>
      </div>
    </td>
    <td className="px-6 py-4 text-slate-600 text-sm max-w-sm truncate font-medium">{item.reason}</td>
    <td className="px-6 py-4 text-slate-400 text-xs text-right font-mono">{new Date(item.timestamp).toLocaleTimeString()}</td>
  </tr>
);

const RiskBadge = ({ level }) => {
  const styles = {
    '高': 'bg-red-50 text-red-600 border-red-200 ring-red-500/20',
    '中': 'bg-yellow-50 text-yellow-600 border-yellow-200 ring-yellow-500/20',
    '低': 'bg-green-50 text-green-600 border-green-200 ring-green-500/20',
    'エラー': 'bg-gray-50 text-gray-600 border-gray-200'
  };
  return <span className={`px-3 py-1 rounded-full text-xs font-bold border ring-1 ${styles[level] || styles['エラー']} inline-flex items-center gap-1`}>
    <span className={`w-1.5 h-1.5 rounded-full ${level === '高' ? 'bg-red-500 animate-pulse' : level === '中' ? 'bg-yellow-500' : 'bg-green-500'}`}></span>
    {level}
  </span>;
};