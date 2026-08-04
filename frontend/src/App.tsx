import { useState, useEffect } from "react";

function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [status, setStatus] = useState("unknown");
  const [scanLogs, setScanLogs] = useState<string[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanFolder, setScanFolder] = useState("C:/Users/KIIT0001/Pictures");
  const [files, setFiles] = useState<any[]>([]);
  const [dashStats, setDashStats] = useState({ total: 0, categories: {} as Record<string, number> });

  const fetchStatus = () => {
    fetch("http://localhost:8000/status")
      .then(res => res.json())
      .then(data => setStatus(data.status))
      .catch(() => setStatus("offline"));
  };

  const fetchFiles = () => {
    fetch("http://localhost:8000/files?limit=100")
      .then(res => res.json())
      .then(data => {
        const f = data.files || [];
        setFiles(f);
        const cats: Record<string, number> = {};
        f.forEach((file: any) => {
          const cat = file.category || "unknown";
          cats[cat] = (cats[cat] || 0) + 1;
        });
        setDashStats({ total: f.length, categories: cats });
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchStatus();
    fetchFiles();
    const interval = setInterval(() => { fetchStatus(); }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeTab === "live scan") {
      const source = new EventSource("http://localhost:8000/stream");
      source.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.message) {
            setScanLogs(prev => [...prev.slice(-49), `[AGENT] ${data.message}`]);
            fetchFiles();
          }
        } catch (e) {}
      };
      return () => source.close();
    }
  }, [activeTab]);

  const startScan = async () => {
    if (!scanFolder.trim()) return;
    setIsScanning(true);
    setScanLogs(prev => [...prev, `> Starting scan of: ${scanFolder}`]);
    try {
      const res = await fetch("http://localhost:8000/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: scanFolder })
      });
      const data = await res.json();
      if (data.error) {
        setScanLogs(prev => [...prev, `✗ Error: ${data.error}`]);
      } else {
        setScanLogs(prev => [...prev, `✓ ${data.message}`]);
        setScanLogs(prev => [...prev, `  Connecting to agent live feed...`]);
      }
    } catch (e: any) {
      setScanLogs(prev => [...prev, `✗ Failed to connect to backend: ${e.message}`]);
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col font-sans">
      <header className="bg-gray-800 p-4 border-b border-gray-700 flex justify-between items-center">
        <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500">
          TidyFlow
        </h1>
        <div className="flex items-center gap-4">
          <span className={`px-3 py-1 rounded-full text-xs ${status === 'running' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
            Backend: {status}
          </span>
        </div>
      </header>
      
      <main className="flex-1 flex p-6 gap-6">
        <aside className="w-64 bg-gray-800 rounded-xl p-4 shadow-xl border border-gray-700/50">
          <nav className="flex flex-col gap-2">
            {["dashboard", "live scan", "settings"].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`p-3 rounded-lg text-left capitalize transition-all ${activeTab === tab ? 'bg-blue-600 shadow-lg shadow-blue-500/30' : 'hover:bg-gray-700'}`}
              >
                {tab}
              </button>
            ))}
          </nav>
        </aside>
        
        <section className="flex-1 bg-gray-800 rounded-xl p-8 shadow-xl border border-gray-700/50">
          {activeTab === "dashboard" && (
            <div className="animate-fade-in">
              <h2 className="text-xl font-semibold mb-4">Dashboard Overview</h2>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-gray-700/50 p-6 rounded-xl">
                  <p className="text-gray-400 text-sm">Total Files Processed</p>
                  <p className="text-3xl font-bold mt-2">{dashStats.total}</p>
                </div>
                <div className="bg-gray-700/50 p-6 rounded-xl">
                  <p className="text-gray-400 text-sm">Categories Found</p>
                  <p className="text-3xl font-bold mt-2">{Object.keys(dashStats.categories).length}</p>
                </div>
                <div className="bg-gray-700/50 p-6 rounded-xl">
                  <p className="text-gray-400 text-sm">Backend Status</p>
                  <p className={`text-3xl font-bold mt-2 ${status === 'running' ? 'text-green-400' : 'text-red-400'}`}>
                    {status === 'running' ? '● Live' : '○ Down'}
                  </p>
                </div>
              </div>

              {Object.keys(dashStats.categories).length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-3">Files by Category</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries(dashStats.categories).map(([cat, count]) => (
                      <div key={cat} className="bg-gray-700/30 p-4 rounded-lg flex justify-between items-center">
                        <span className="text-gray-300">{cat}</span>
                        <span className="bg-blue-600/30 text-blue-300 px-3 py-1 rounded-full text-sm font-mono">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {files.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-lg font-semibold mb-3">Recent Files</h3>
                  <div className="bg-black/30 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-700 text-gray-400">
                          <th className="text-left p-3">File</th>
                          <th className="text-left p-3">Category</th>
                          <th className="text-left p-3">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {files.slice(0, 15).map((f: any) => (
                          <tr key={f.id} className="border-b border-gray-800 hover:bg-gray-700/30">
                            <td className="p-3 font-mono text-xs truncate max-w-xs">{f.path?.split(/[/\\]/).pop()}</td>
                            <td className="p-3"><span className="bg-purple-600/20 text-purple-300 px-2 py-0.5 rounded text-xs">{f.category || '—'}</span></td>
                            <td className="p-3"><span className={`text-xs ${f.status === 'moved' ? 'text-green-400' : 'text-yellow-400'}`}>{f.status || 'pending'}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
          
          {activeTab === "live scan" && (
            <div className="animate-fade-in">
              <h2 className="text-xl font-semibold mb-4">Live Scan</h2>
              <div className="mb-4 flex gap-3">
                <input
                  type="text"
                  value={scanFolder}
                  onChange={e => setScanFolder(e.target.value)}
                  placeholder="Enter folder path to scan..."
                  className="flex-1 bg-gray-900 border border-gray-700 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm"
                />
                <button
                  onClick={startScan}
                  disabled={isScanning || status !== 'running'}
                  className={`px-6 py-2 rounded-lg font-medium shadow-lg transition-colors ${
                    isScanning || status !== 'running'
                      ? 'bg-gray-600 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-500 shadow-blue-500/20'
                  }`}
                >
                  {isScanning ? 'Scanning...' : 'Start Scan'}
                </button>
              </div>
              <div className="bg-black/80 rounded-xl p-4 font-mono text-sm h-80 overflow-y-auto border border-gray-700 shadow-inner">
                {scanLogs.length === 0 ? (
                  <p className="text-gray-500">Ready. Agent is idling.</p>
                ) : (
                  scanLogs.map((log, i) => (
                    <p key={i} className={`mb-2 leading-relaxed ${
                      log.startsWith('✗') || log.includes('Error') ? 'text-red-400 font-semibold' : 
                      log.startsWith('✓') ? 'text-green-400 font-semibold' : 
                      log.includes('Analyzing') ? 'text-blue-300' :
                      log.includes('Categorized') ? 'text-purple-300' :
                      'text-gray-300'
                    }`}>
                      {log}
                    </p>
                  ))
                )}
              </div>
              <button
                onClick={() => setScanLogs([])}
                className="mt-3 px-4 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
              >
                Clear Log
              </button>
            </div>
          )}
          
          {activeTab === "settings" && (
            <div className="animate-fade-in">
              <h2 className="text-xl font-semibold mb-4">Configuration</h2>
              <div className="space-y-4 max-w-md">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">LLM Provider</label>
                  <select className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none">
                    <option>DeepSeek</option>
                    <option>Gemini</option>
                    <option>Groq</option>
                    <option>OpenRouter</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">API Key</label>
                  <input type="password" placeholder="••••••••••••••••" className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <button className="px-6 py-2 bg-purple-600 hover:bg-purple-500 transition-colors rounded-lg font-medium shadow-lg shadow-purple-500/20">
                  Save Settings
                </button>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
