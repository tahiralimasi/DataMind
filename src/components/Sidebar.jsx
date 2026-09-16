import {
  BarChart3,
  BrainCircuit,
  Database,
  LayoutDashboard,
  Settings,
  Sparkles,
} from 'lucide-react';

const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard, id: 'dashboard' },
  { label: 'Dataset Analysis & EDA', icon: Database, id: 'dataset' },
  { label: 'AI Suggestions', icon: Sparkles, id: 'ai' },
  { label: 'ML Prediction', icon: BrainCircuit, id: 'ml' },
  { label: 'Settings', icon: Settings, id: 'settings' },
];

export default function Sidebar({ activePage, onNavigate }) {
  return (
    <aside className="hidden lg:flex lg:w-72 lg:flex-col lg:border-r lg:border-slate-800/80 lg:bg-slate-950/70 lg:backdrop-blur-xl">
      <div className="flex items-center gap-3 border-b border-slate-800/80 px-6 py-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 shadow-glow">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="text-lg font-semibold text-slate-50">DataMind AI</div>
        </div>
      </div>

      <nav className="flex-1 px-4 py-6">
        <div className="space-y-2">
          {navItems.map(({ label, icon: Icon, id }) => {
            const isActive = activePage === id;

            return (
              <button
                key={id}
                type="button"
                onClick={() => onNavigate(id)}
                className={[
                  'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'bg-slate-800/80 text-white shadow-glow ring-1 ring-blue-500/40'
                    : 'text-slate-300 hover:bg-slate-800/70 hover:text-white',
                ].join(' ')}
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-8 rounded-2xl border border-slate-800/80 bg-slate-900/80 p-4">
          <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-400">
            <BarChart3 className="h-3.5 w-3.5" />
            Insight
          </div>
          <p className="text-sm text-slate-300">Turn raw data into intelligent insights.</p>
        </div>
      </nav>
    </aside>
  );
}
