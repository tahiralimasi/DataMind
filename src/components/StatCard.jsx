export default function StatCard({ title, value, change, tone = 'blue', icon: Icon }) {
  const styles = {
    blue: 'from-blue-500/15 to-blue-500/5 text-blue-300 ring-blue-500/20',
    purple: 'from-violet-500/15 to-violet-500/5 text-violet-300 ring-violet-500/20',
    emerald: 'from-emerald-500/15 to-emerald-500/5 text-emerald-300 ring-emerald-500/20',
    amber: 'from-amber-500/15 to-amber-500/5 text-amber-300 ring-amber-500/20',
  };

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/80 p-4 shadow-lg shadow-slate-950/20 transition duration-200 hover:-translate-y-0.5 hover:border-slate-700">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-400">{title}</div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ring-1 ${styles[tone]}`}>
          {Icon && <Icon className="h-4 w-4" />}
        </div>
      </div>
      <div className="mt-4 text-3xl font-semibold tracking-tight text-white">{value}</div>
      <div className="mt-2 text-xs text-slate-400">{change}</div>
    </div>
  );
}
