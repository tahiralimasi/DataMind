import { Bell, ChevronDown, Search, UserCircle2 } from 'lucide-react';

export default function Header({ title, subtitle, activePage }) {
  return (
    <header className="border-b border-slate-800/80 bg-slate-950/60 px-4 py-4 backdrop-blur-xl sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-slate-400">
            {activePage === 'dashboard' ? 'Overview' : activePage === 'dataset' ? 'Data Pipeline' : activePage === 'ml' ? 'Model Studio' : 'Workspace'}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-50 sm:text-3xl">
            {title}
          </h1>
        </div>

        <div className="flex items-center gap-3 self-start lg:self-auto">
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-800 bg-slate-900/80 text-slate-300 transition hover:border-slate-700 hover:text-white"
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
          </button>

          <div className="hidden items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-left sm:flex">
            <button type="button" className="flex items-center gap-2 text-sm text-slate-200">
              <Search className="h-4 w-4 text-slate-400" />
              <span>Search</span>
            </button>
          </div>

          <button
            type="button"
            className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-left transition hover:border-slate-700"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-blue-500">
              <UserCircle2 className="h-5 w-5 text-white" />
            </div>
            <div className="hidden sm:block">
              <div className="text-sm font-medium text-slate-100">Operations Team</div>
              <div className="text-xs text-slate-400">Workspace</div>
            </div>
            <ChevronDown className="hidden h-4 w-4 text-slate-400 sm:block" />
          </button>
        </div>
      </div>

      {subtitle && <p className="mt-3 text-sm text-slate-400">{subtitle}</p>}
    </header>
  );
}
