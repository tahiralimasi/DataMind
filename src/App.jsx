import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './pages/Dashboard';
import DatasetAnalysis from './pages/DatasetAnalysis';
import MLPrediction from './pages/MLPrediction';
import AISuggestions from './pages/AISuggestions';

const pages = {
  dashboard: { title: 'Good evening 👋', subtitle: 'Upload a dataset and let DataMind analyze it.' },
  dataset: { title: 'Dataset Analysis & EDA', subtitle: 'Upload a dataset to automatically explore and understand your data.' },
  ai: { title: 'AI Suggestions', subtitle: 'Get intelligent recommendations to prepare your dataset for machine learning.' },
  ml: { title: 'Machine Learning', subtitle: 'Train a model and generate predictions from your dataset.' },
  settings: { title: 'Settings', subtitle: 'Workspace configuration and preferences.' },
};

function App() {
  const [activePage, setActivePage] = useState('dashboard');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const renderPage = () => {
    switch (activePage) {
      case 'dataset':
        return <DatasetAnalysis />;
      case 'ai':
        return <AISuggestions onNavigate={setActivePage} />;
      case 'ml':
        return <MLPrediction />;
      case 'settings':
        return (
          <div className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-10 text-center text-slate-300">
            Settings page placeholder. This section is reserved for future workspace preferences.
          </div>
        );
      default:
        return <Dashboard onNavigate={setActivePage} />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="flex min-h-screen">
        <Sidebar activePage={activePage} onNavigate={(page) => {
          setActivePage(page);
          setMobileSidebarOpen(false);
        }} />

        {mobileSidebarOpen && (
          <div className="fixed inset-0 z-40 bg-slate-950/80 lg:hidden" onClick={() => setMobileSidebarOpen(false)} />
        )}

        <aside
          className={[
            'fixed inset-y-0 left-0 z-50 w-72 border-r border-slate-800/80 bg-slate-950/95 p-4 backdrop-blur-xl transition-transform duration-200 lg:hidden',
            mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full',
          ].join(' ')}
        >
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-500">
                <span className="text-sm font-bold text-white">D</span>
              </div>
              <div className="text-lg font-semibold text-white">DataMind AI</div>
            </div>
            <button type="button" onClick={() => setMobileSidebarOpen(false)} className="rounded-lg border border-slate-700 p-2 text-slate-300">
              <X className="h-4 w-4" />
            </button>
          </div>

          <nav className="space-y-2">
            {Object.entries({ dashboard: 'Dashboard', dataset: 'Dataset Analysis & EDA', ai: 'AI Suggestions', ml: 'ML Prediction', settings: 'Settings' }).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setActivePage(id);
                  setMobileSidebarOpen(false);
                }}
                className={[
                  'flex w-full items-center rounded-xl px-3 py-3 text-left text-sm font-medium transition',
                  activePage === id ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/70 hover:text-white',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </nav>
        </aside>

        <main className="flex-1">
          <Header title={pages[activePage].title} subtitle={pages[activePage].subtitle} activePage={activePage} />

          <div className="border-b border-slate-800/80 px-4 py-3 lg:hidden">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-200"
            >
              <Menu className="h-4 w-4" />
              Menu
            </button>
          </div>

          <div className="p-4 sm:p-6 lg:p-8">
            {renderPage()}
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
