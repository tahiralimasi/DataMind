import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  BrainCircuit,
  Check,
  Database,
  FileSpreadsheet,
  FlaskConical,
  Lightbulb,
  ScanSearch,
  Sparkles,
  UploadCloud,
} from 'lucide-react';
import { API_BASE_URL, backendUnavailableMessage } from '../api';

const emptyWorkspace = { uploaded: false, dataset_name: '', target_column: null, problem_type: null, model_trained: false, best_model: null, best_metrics: {} };

const workflow = [
  { number: '01', label: 'UPLOAD', text: 'Import your CSV dataset.', icon: UploadCloud },
  { number: '02', label: 'ANALYZE', text: 'Automatically understand your data.', icon: ScanSearch },
  { number: '03', label: 'EXPLORE', text: 'Discover patterns and relationships.', icon: BarChart3 },
  { number: '04', label: 'PREDICT', text: 'Train models and predict outcomes.', icon: BrainCircuit },
];

function StatusRow({ label, ready }) {
  return <div className="flex items-center justify-between border-b border-slate-800/70 py-3 last:border-0"><span className="text-sm text-slate-400">{label}</span><span className={ready ? 'inline-flex items-center gap-2 text-sm text-emerald-300' : 'text-sm text-slate-500'}>{ready && <Check className="h-4 w-4" />}{ready ? 'Available' : 'Waiting'}</span></div>;
}

function ActionCard({ icon: Icon, title, text, onClick, tone = 'blue' }) {
  const styles = { blue: 'text-blue-300 bg-blue-500/10 ring-blue-500/20', violet: 'text-violet-300 bg-violet-500/10 ring-violet-500/20', emerald: 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/20', amber: 'text-amber-300 bg-amber-500/10 ring-amber-500/20' };
  return <button type="button" onClick={onClick} className="group rounded-2xl border border-slate-800/80 bg-slate-900/75 p-4 text-left transition duration-200 hover:-translate-y-1 hover:border-slate-600 hover:bg-slate-900"><span className={`flex h-10 w-10 items-center justify-center rounded-xl ring-1 ${styles[tone]}`}><Icon className="h-5 w-5 transition-transform group-hover:scale-110" /></span><h4 className="mt-4 font-semibold text-white">{title}</h4><p className="mt-1 text-sm text-slate-400">{text}</p></button>;
}

export default function Dashboard({ onNavigate }) {
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadWorkspace = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/dashboard`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Unable to load workspace.');
      setWorkspace({ ...emptyWorkspace, ...data });
      setError('');
    } catch (fetchError) {
      setError(fetchError instanceof TypeError ? backendUnavailableMessage : fetchError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorkspace();
    window.addEventListener('datamind:dataset-updated', loadWorkspace);
    return () => window.removeEventListener('datamind:dataset-updated', loadWorkspace);
  }, []);

  const navigateToNext = () => onNavigate(workspace.model_trained ? 'ml' : workspace.uploaded ? 'dataset' : 'dataset');
  const primaryMetric = workspace.problem_type === 'classification' ? workspace.best_metrics?.f1 : workspace.best_metrics?.r2;
  const activity = workspace.uploaded
    ? [
      { text: 'Dataset uploaded', ready: true },
      { text: 'Dataset analysis available', ready: true },
      { text: 'EDA workspace available', ready: true },
      { text: workspace.model_trained ? 'ML model trained' : 'ML model waiting', ready: workspace.model_trained },
    ]
    : [];

  if (loading) return <div className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-10 text-center text-slate-400">Loading workspace...</div>;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800/70 bg-slate-950/45 px-5 py-4">
        <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 shadow-lg shadow-blue-500/20"><Sparkles className="h-5 w-5 text-white" /></div><div><p className="font-semibold text-white">DataMind AI</p><p className="text-xs text-slate-500">Intelligent Data Analysis Platform</p></div></div>
        <button type="button" onClick={() => onNavigate('dataset')} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/15 transition hover:brightness-110"><UploadCloud className="h-4 w-4" />Upload Dataset</button>
      </header>

      {error && <div className="rounded-2xl border border-red-500/40 bg-red-500/5 p-4 text-sm text-red-200">{error}</div>}

      <section className="relative overflow-hidden rounded-[2rem] border border-blue-500/20 bg-slate-900/75 p-7 shadow-glow sm:p-10">
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl" /><div className="pointer-events-none absolute bottom-0 right-1/3 h-40 w-40 rounded-full bg-violet-500/10 blur-3xl" />
        <div className="relative max-w-3xl"><p className="flex items-center gap-2 text-sm font-medium uppercase tracking-[0.22em] text-blue-300/80"><Sparkles className="h-4 w-4" />Intelligent workspace</p><h1 className="mt-5 text-4xl font-semibold tracking-tight text-white sm:text-5xl">Turn Your Data Into Intelligence.</h1><p className="mt-5 max-w-2xl text-base leading-7 text-slate-400">Analyze datasets, discover patterns, train machine learning models, and generate predictions, all in one place.</p><div className="mt-7 flex flex-wrap gap-3"><button type="button" onClick={() => onNavigate('dataset')} className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-blue-100"><UploadCloud className="h-4 w-4" />Upload Dataset</button><button type="button" onClick={() => onNavigate(workspace.uploaded ? 'dataset' : 'dataset')} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/40 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:border-blue-400 hover:text-white">Explore Platform<ArrowRight className="h-4 w-4" /></button></div></div>
      </section>

      <section><div className="mb-5"><p className="text-sm font-medium uppercase tracking-[0.2em] text-blue-300/80">The workflow</p><h2 className="mt-2 text-2xl font-semibold text-white">From Data to Decisions</h2><p className="mt-2 text-sm text-slate-400">Everything you need to turn raw data into actionable intelligence.</p></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{workflow.map(({ number, label, text, icon: Icon }, index) => <div key={label} className="group relative rounded-2xl border border-slate-800/80 bg-slate-900/65 p-5 transition hover:-translate-y-1 hover:border-blue-500/40"><div className="flex items-center justify-between"><span className="text-xs font-semibold tracking-[0.2em] text-blue-300/70">{number}</span><Icon className="h-5 w-5 text-slate-500 transition group-hover:scale-110 group-hover:text-blue-300" /></div><p className="mt-7 text-xs font-semibold tracking-[0.18em] text-slate-500">{label}</p><p className="mt-2 text-sm leading-6 text-slate-300">{text}</p>{index < workflow.length - 1 && <ArrowRight className="absolute -right-3 top-1/2 z-10 hidden h-5 w-5 text-slate-700 xl:block" />}</div>)}</div></section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-6"><div className="mb-5 flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300/70">Workspace</p><h2 className="mt-2 text-xl font-semibold text-white">Current Workspace</h2></div><Database className="h-5 w-5 text-blue-300" /></div>{workspace.uploaded ? <><div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Dataset</p><p className="mt-2 truncate text-lg font-semibold text-white">{workspace.dataset_name}</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><StatusRow label="Status" ready /><StatusRow label="Analysis" ready /><StatusRow label="EDA" ready /><StatusRow label="ML" ready={workspace.model_trained} /><StatusRow label="Prediction" ready={workspace.model_trained} /></div></div><button type="button" onClick={navigateToNext} className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-blue-300 transition hover:text-blue-200">Continue Working<ArrowRight className="h-4 w-4" /></button></> : <><div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/30 p-6"><p className="text-lg font-semibold text-white">No active workspace</p><p className="mt-2 text-sm leading-6 text-slate-400">Upload a dataset to start your first DataMind project.</p><button type="button" onClick={() => onNavigate('dataset')} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-400"><UploadCloud className="h-4 w-4" />Upload Dataset</button></div></>}</div>

        <div className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-6"><div className="mb-5 flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300/70">Model status</p><h2 className="mt-2 text-xl font-semibold text-white">Latest ML Experiment</h2></div><FlaskConical className="h-5 w-5 text-violet-300" /></div>{workspace.model_trained ? <><div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/35 p-4 text-sm"><div className="flex justify-between gap-4"><span className="text-slate-500">Model</span><span className="text-right text-slate-200">{workspace.best_model}</span></div><div className="flex justify-between gap-4"><span className="text-slate-500">Problem</span><span className="capitalize text-slate-200">{workspace.model_problem_type}</span></div><div className="flex justify-between gap-4"><span className="text-slate-500">Target</span><span className="text-slate-200">{workspace.target_column}</span></div><div className="flex justify-between gap-4"><span className="text-slate-500">Performance</span><span className="text-emerald-300">{primaryMetric === undefined ? '—' : `${workspace.model_problem_type === 'classification' ? 'F1' : 'R²'} ${Number(primaryMetric).toFixed(4)}`}</span></div></div><p className="mt-4 flex items-center gap-2 text-sm text-emerald-300"><Check className="h-4 w-4" />Completed</p><button type="button" onClick={() => onNavigate('ml')} className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-violet-300 transition hover:text-violet-200">View Experiment<ArrowRight className="h-4 w-4" /></button></> : <><div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/30 p-6"><p className="text-lg font-semibold text-white">Your first ML experiment is waiting.</p><p className="mt-2 text-sm leading-6 text-slate-400">Train a model to see performance here.</p><button type="button" onClick={() => onNavigate('ml')} className="mt-5 inline-flex items-center gap-2 rounded-xl border border-violet-400/40 px-4 py-2.5 text-sm font-semibold text-violet-200 transition hover:bg-violet-500/10"><BrainCircuit className="h-4 w-4" />Train Model</button></div></>}</div>
      </section>

      <section><div className="mb-5"><h2 className="text-xl font-semibold text-white">Quick Actions</h2><p className="mt-2 text-sm text-slate-400">Jump into the next step of your workflow.</p></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><ActionCard icon={FileSpreadsheet} title="Upload Dataset" text="Start with a new CSV" onClick={() => onNavigate('dataset')} /><ActionCard icon={Database} title="Analyze Dataset" text="Understand your data" onClick={() => onNavigate('dataset')} tone="violet" /><ActionCard icon={BarChart3} title="Explore EDA" text="Discover patterns" onClick={() => onNavigate('dataset')} tone="emerald" /><ActionCard icon={BrainCircuit} title="Train ML Model" text="Build a prediction model" onClick={() => onNavigate('ml')} tone="amber" /></div></section>

      <section className="rounded-3xl border border-slate-800/80 bg-slate-900/70 p-6"><div className="mb-5 flex items-center gap-3"><Lightbulb className="h-5 w-5 text-amber-300" /><div><h2 className="text-xl font-semibold text-white">Recent Activity</h2><p className="mt-1 text-sm text-slate-400">Activity from the current workspace.</p></div></div>{activity.length ? <div className="grid gap-3 sm:grid-cols-2">{activity.map((item) => <div key={item.text} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/30 p-3 text-sm"><span className={item.ready ? 'flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300' : 'flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-slate-500'}>{item.ready ? <Check className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}</span><span className={item.ready ? 'text-slate-200' : 'text-slate-500'}>{item.text}</span></div>)}</div> : <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/30 p-5 text-sm text-slate-400">Upload a dataset to begin tracking your workspace activity.</div>}</section>
    </div>
  );
}
