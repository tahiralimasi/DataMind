export default function InsightCard({ title, value, hint, tone = 'blue' }) {
  const dotColors = {
    blue: 'bg-blue-400',
    purple: 'bg-violet-400',
    emerald: 'bg-emerald-400',
    amber: 'bg-amber-400',
  };

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/80 p-5 transition duration-200 hover:-translate-y-0.5 hover:border-slate-700">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-white">{title}</h3>
        <span className={`h-2.5 w-2.5 rounded-full ${dotColors[tone]}`} />
      </div>
      <div className="mt-5 text-3xl font-semibold text-white">{value}</div>
      <p className="mt-2 text-sm text-slate-400">{hint}</p>
    </div>
  );
}
