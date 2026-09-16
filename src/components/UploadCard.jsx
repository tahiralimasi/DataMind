import { ArrowUpRight, UploadCloud } from 'lucide-react';

export default function UploadCard({ title, description, buttonText, onUpload }) {
  return (
    <div className="rounded-3xl border border-slate-800/80 bg-slate-900/75 p-6 shadow-glow transition duration-200 hover:border-slate-700/80">
      <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.22em] text-blue-300/80">Analysis Studio</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">{title}</h2>
          <p className="mt-2 max-w-xl text-sm text-slate-400">{description}</p>
        </div>

        <button
          type="button"
          onClick={onUpload}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 px-5 py-3 text-sm font-medium text-white shadow-lg shadow-blue-500/20 transition hover:brightness-110"
        >
          <UploadCloud className="h-4 w-4" />
          {buttonText}
          <ArrowUpRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
