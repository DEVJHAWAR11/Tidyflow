import { useState, useEffect } from "react";

function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [status, setStatus] = useState("unknown");
  
  useEffect(() => {
    fetch("http://localhost:8000/status")
      .then(res => res.json())
      .then(data => setStatus(data.status))
      .catch(() => setStatus("offline"));
  }, []);

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
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-gray-700/50 p-6 rounded-xl">
                  <p className="text-gray-400 text-sm">Total Files Organized</p>
                  <p className="text-3xl font-bold mt-2">1,248</p>
                </div>
                <div className="bg-gray-700/50 p-6 rounded-xl">
                  <p className="text-gray-400 text-sm">Storage Saved</p>
                  <p className="text-3xl font-bold mt-2">4.2 GB</p>
                </div>
                <div className="bg-gray-700/50 p-6 rounded-xl">
                  <p className="text-gray-400 text-sm">AI Token Cost</p>
                  <p className="text-3xl font-bold mt-2">$0.14</p>
                </div>
              </div>
            </div>
          )}
          
          {activeTab === "live scan" && (
            <div className="animate-fade-in">
              <h2 className="text-xl font-semibold mb-4">Live Scan Progress</h2>
              <div className="bg-black/50 rounded-xl p-4 font-mono text-sm h-64 overflow-y-auto border border-gray-700">
                <p className="text-gray-500">Waiting for scan to start...</p>
              </div>
              <button className="mt-4 px-6 py-2 bg-blue-600 hover:bg-blue-500 transition-colors rounded-lg font-medium shadow-lg shadow-blue-500/20">
                Start New Scan
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
                    <option>OpenAI (GPT-4o)</option>
                    <option>Anthropic (Claude 3.5)</option>
                    <option>DeepSeek</option>
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
