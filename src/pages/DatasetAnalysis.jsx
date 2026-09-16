import { useRef, useState } from 'react';
import { AlertTriangle, ArrowUpRight, BarChart3, CheckCircle2, Database, Download, FileSpreadsheet, FileText, Lightbulb, Percent, UploadCloud } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { API_BASE_URL, backendUnavailableMessage } from '../api';

const emptyProfile = {
  filename: '',
  rows: 0,
  columns: 0,
  column_names: [],
  numerical_columns: [],
  categorical_columns: [],
  datetime_columns: [],
  missing_values: {},
  missing_percentage: {},
  duplicate_rows: 0,
  data_types: {},
  memory_usage: '',
  statistics: { numerical: {}, categorical: {} },
  quality_score: 0,
  quality_issues: [],
  missing_columns_count: 0,
  data_type_issues_count: 0,
  invalid_values_count: 0,
  category_issues_count: 0,
};

const emptyEda = {
  numerical_distributions: {},
  categorical_analysis: {},
  correlation: { columns: [], matrix: [] },
  missing_values: [],
  insights: [],
  strongest_correlation: null,
};

const formatPercent = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '0.0%';
  return `${Number(value).toFixed(1)}%`;
};

const formatMetric = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString();
};

const getCategory = (column, profile) => {
  if (!profile) return 'Unknown';
  if (profile.datetime_columns.includes(column)) return 'Date';
  if (profile.numerical_columns.includes(column)) return 'Numerical';
  if (profile.categorical_columns.includes(column)) return 'Categorical';
  return 'Unknown';
};

export default function DatasetAnalysis() {
  const fileInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState(emptyProfile);
  const [eda, setEda] = useState(emptyEda);
  const [edaLoading, setEdaLoading] = useState(false);
  const [edaError, setEdaError] = useState('');
  const [exportLoading, setExportLoading] = useState(false);
  const [exportReady, setExportReady] = useState(false);
  const [exportError, setExportError] = useState('');
  const [cleaningOptions, setCleaningOptions] = useState({ remove_duplicates: true, missing_numeric: 'median', missing_categorical: 'mode', standardize_categories: true, convert_numeric_columns: true, handle_invalid_values: 'median' });
  const [cleaningPreview, setCleaningPreview] = useState(null);
  const [cleaningLoading, setCleaningLoading] = useState(false);
  const [cleaningError, setCleaningError] = useState('');
  const [cleaningCompleted, setCleaningCompleted] = useState(false);

  const handleBrowse = () => fileInputRef.current?.click();

  const handleFile = async (file) => {
    if (!file) {
      setError('No file selected. Please upload a CSV or XLSX dataset.');
      return;
    }

    if (!file.name.toLowerCase().endsWith('.csv') && !file.name.toLowerCase().endsWith('.xlsx')) {
      setError('Unable to analyze this file. Please upload a valid CSV or XLSX dataset.');
      return;
    }

    setSelectedFile(file);
    setError('');
    setExportReady(false);
    setExportError('');
    setCleaningPreview(null);
    setCleaningError('');
    setCleaningCompleted(false);
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_BASE_URL}/api/upload`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'Unable to analyze this file. Please upload a valid CSV or XLSX dataset.');
      }

      setProfile({
        ...emptyProfile,
        ...data,
        statistics: {
          numerical: data.statistics?.numerical || {},
          categorical: data.statistics?.categorical || {},
        },
      });
      window.dispatchEvent(new Event('datamind:dataset-updated'));

      setEdaLoading(true);
      setEdaError('');
      try {
        const edaResponse = await fetch(`${API_BASE_URL}/api/eda`);
        const edaData = await edaResponse.json();

        if (!edaResponse.ok) {
          throw new Error('Unable to generate analysis.');
        }

        setEda({
          ...emptyEda,
          ...edaData,
          correlation: {
            ...emptyEda.correlation,
            ...edaData.correlation,
          },
        });
      } catch {
        setEda(emptyEda);
        setEdaError('Unable to generate analysis. Please upload a valid dataset.');
      } finally {
        setEdaLoading(false);
      }
    } catch (fetchError) {
      setError(fetchError instanceof TypeError ? backendUnavailableMessage : (fetchError.message || 'Unable to analyze this file. Please upload a valid CSV or XLSX dataset.'));
      setProfile(emptyProfile);
      setEda(emptyEda);
    } finally {
      setLoading(false);
    }
  };

  const onInputChange = (event) => {
    const file = event.target.files?.[0];
    handleFile(file);
  };

  const onDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    handleFile(file);
  };

  const handleResetUpload = () => {
    setSelectedFile(null);
    setError('');
    setProfile(emptyProfile);
    setEda(emptyEda);
    setEdaError('');
    setEdaLoading(false);
    setExportReady(false);
    setExportError('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleExportCleaningWorkbook = async () => {
    setExportLoading(true);
    setExportError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/export-cleaning-excel`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data?.error || 'Unable to generate the Excel cleaning workbook.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'DataMind_Cleaning_Report.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportReady(true);
    } catch (exportFetchError) {
      setExportError(exportFetchError instanceof TypeError ? backendUnavailableMessage : exportFetchError.message);
    } finally {
      setExportLoading(false);
    }
  };

  const handleCleaningPreview = async () => {
    setCleaningLoading(true);
    setCleaningError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/clean/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cleaningOptions) });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Unable to preview cleaning changes.');
      setCleaningPreview(data);
    } catch (cleanError) {
      setCleaningError(cleanError instanceof TypeError ? backendUnavailableMessage : cleanError.message);
    } finally {
      setCleaningLoading(false);
    }
  };

  const handleApplyCleaning = async () => {
    setCleaningLoading(true);
    setCleaningError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/clean`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cleaningOptions) });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Unable to apply cleaning changes.');
      setProfile({ ...emptyProfile, ...data.profile, statistics: { numerical: data.profile.statistics?.numerical || {}, categorical: data.profile.statistics?.categorical || {} } });
      setCleaningCompleted(true);
      setCleaningPreview(null);
      window.dispatchEvent(new Event('datamind:dataset-updated'));
      const edaResponse = await fetch(`${API_BASE_URL}/api/eda`);
      const edaData = await edaResponse.json();
      if (edaResponse.ok) setEda({ ...emptyEda, ...edaData, correlation: { ...emptyEda.correlation, ...edaData.correlation } });
    } catch (cleanError) {
      setCleaningError(cleanError instanceof TypeError ? backendUnavailableMessage : cleanError.message);
    } finally {
      setCleaningLoading(false);
    }
  };

  const handleDownloadCleaned = async () => {
    const response = await fetch(`${API_BASE_URL}/api/download-cleaned`);
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'DataMind_Cleaned_Dataset.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const totalMissing = Object.values(profile.missing_values || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  const totalCells = (profile.rows || 0) * (profile.columns || 0);
  const missingRate = totalCells ? (totalMissing / totalCells) * 100 : 0;
  const columnRows = (profile.column_names || []).map((column) => ({
    name: column,
    type: profile.data_types?.[column] || 'unknown',
    category: getCategory(column, profile),
    missing: formatPercent(profile.missing_percentage?.[column] ?? 0),
    unique: formatMetric(profile.unique_values?.[column] ?? 0),
  }));

  const numericalSummary = Object.entries(profile.statistics?.numerical || {});
  const categoricalSummary = Object.entries(profile.statistics?.categorical || {});
  const qualityScore = profile.quality_score ?? 100;
  const numericalDistributions = Object.entries(eda.numerical_distributions || {});
  const categoricalAnalysis = Object.entries(eda.categorical_analysis || {});
  const missingAnalysis = eda.missing_values || [];
  const correlationColumns = eda.correlation?.columns || [];
  const correlationMatrix = eda.correlation?.matrix || [];
  const missingTotal = missingAnalysis.reduce((sum, item) => sum + Number(item.missing || 0), 0);
  const strongestCorrelation = eda.strongest_correlation;
  const strongestCorrelationValue = strongestCorrelation ? Number(strongestCorrelation.value).toFixed(2) : '—';

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-800/80 bg-slate-900/75 p-6 shadow-glow">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-700 bg-slate-800/90 text-blue-300">
            <FileText className="h-8 w-8" />
          </div>

          <h2 className="text-3xl font-semibold tracking-tight text-white">Dataset Analysis</h2>
          <p className="mt-3 text-base text-slate-400">
            Upload a dataset to automatically explore and understand your data.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx"
            onChange={onInputChange}
            className="hidden"
          />

          {!selectedFile && !loading && (
            <>
              <div className="mt-6 flex flex-col items-center justify-center gap-4 sm:flex-row">
                <button
                  type="button"
                  onClick={handleBrowse}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 px-5 py-3 text-sm font-medium text-white transition hover:brightness-110"
                >
                  <UploadCloud className="h-4 w-4" />
                  Upload CSV / XLSX
                </button>
              </div>

              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={onDrop}
                className={[
                  'mt-6 rounded-2xl border border-dashed p-8 transition',
                  isDragging ? 'border-blue-500 bg-blue-500/5' : 'border-slate-700 bg-slate-950/40',
                ].join(' ')}
              >
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-slate-700 bg-slate-900/80 text-blue-300">
                  <Database className="h-7 w-7" />
                </div>
                <div className="text-lg font-medium text-slate-100">Drop your CSV or XLSX here</div>
                <p className="mt-2 text-sm text-slate-400">or browse from your computer</p>
                <p className="mt-3 text-sm text-slate-500">Supported formats: CSV, XLSX</p>
              </div>
            </>
          )}

          {selectedFile && !loading && !profile.rows && !error && (
            <div className="mt-6 rounded-2xl border border-blue-500/30 bg-blue-500/5 p-5 text-left">
              <p className="text-sm font-medium text-blue-200">✓ Dataset uploaded</p>
              <p className="mt-1 text-lg text-white">{selectedFile.name}</p>
              <p className="mt-2 text-sm text-slate-300">{(selectedFile.size / 1024).toFixed(1)} KB</p>
            </div>
          )}

          {loading && (
            <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-950/40 p-6 text-center">
              <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              <p className="text-lg font-medium text-white">Analyzing dataset...</p>
            </div>
          )}

          {error && (
            <div className="mt-6 rounded-2xl border border-red-500/40 bg-red-500/5 p-4 text-left text-sm text-red-200">
              {error}
            </div>
          )}

          {selectedFile && !loading && profile.rows > 0 && (
            <div className="mt-6 flex flex-col items-center justify-between gap-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-left sm:flex-row">
              <div>
                <p className="text-sm font-medium text-emerald-200">✓ Dataset uploaded</p>
                <p className="mt-1 text-lg text-white">{profile.filename || selectedFile.name}</p>
              </div>
              <button
                type="button"
                onClick={handleResetUpload}
                className="rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                Upload Another Dataset
              </button>
            </div>
          )}
        </div>
      </section>

      {profile.rows > 0 && (
        <section className="rounded-3xl border border-amber-500/20 bg-slate-900/80 p-5 shadow-lg shadow-slate-950/10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3"><FileSpreadsheet className="h-5 w-5 text-amber-300" /><h3 className="text-xl font-semibold text-white">Data Quality</h3></div>
              <p className="mt-2 text-sm text-slate-400">Review issues in Excel without changing the uploaded data automatically.</p>
            </div>
            <button type="button" onClick={handleExportCleaningWorkbook} disabled={exportLoading} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:opacity-50"><FileSpreadsheet className="h-4 w-4" />{exportLoading ? 'Preparing Excel...' : 'Fix in Excel'}</button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Missing Values', totalMissing, 'text-amber-200'],
              ['Duplicate Rows', profile.duplicate_rows || 0, 'text-rose-200'],
              ['Columns With Missing Data', profile.missing_columns_count || 0, 'text-blue-200'],
              ['Data Type Issues', profile.data_type_issues_count || 0, 'text-violet-200'],
            ].map(([label, value, color]) => <div key={label} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4"><p className="text-xs uppercase tracking-[0.14em] text-slate-500">{label}</p><p className={`mt-3 text-2xl font-semibold ${color}`}>{Number(value).toLocaleString()}</p></div>)}
          </div>

          <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-800/80">
            <table className="min-w-full text-left text-sm"><thead className="bg-slate-950/70 text-slate-300"><tr><th className="px-4 py-3 font-medium">Column</th><th className="px-4 py-3 font-medium">Issue</th><th className="px-4 py-3 font-medium">Count</th><th className="px-4 py-3 font-medium">Percentage</th></tr></thead><tbody className="divide-y divide-slate-800 bg-slate-900/60 text-slate-200">{(profile.quality_issues || []).length ? profile.quality_issues.map((issue, index) => <tr key={`${issue.column}-${issue.issue_type}-${index}`}><td className="px-4 py-3 font-medium text-white">{issue.column}</td><td className="px-4 py-3">{issue.issue_type}</td><td className="px-4 py-3">{Number(issue.count).toLocaleString()}</td><td className="px-4 py-3">{Number(issue.percentage).toFixed(2)}%</td></tr>) : <tr><td colSpan="4" className="px-4 py-5 text-center text-slate-500">No data quality issues detected.</td></tr>}</tbody></table>
          </div>

          {exportReady && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-200"><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />Excel cleaning workbook generated.</span><button type="button" onClick={handleExportCleaningWorkbook} className="inline-flex items-center gap-2 text-emerald-100 hover:text-white"><Download className="h-4 w-4" />Download Excel</button></div>}
          {exportError && <p className="mt-4 text-sm text-red-300">{exportError}</p>}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4"><p className="text-sm text-slate-400">After fixing the data in Excel, upload the cleaned file again to re-run Data Analytics.</p><button type="button" onClick={handleBrowse} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-blue-400 hover:text-white"><UploadCloud className="h-4 w-4" />Upload Cleaned File</button></div>
        </section>
      )}

      {profile.rows > 0 && (
        <section className="rounded-3xl border border-blue-500/20 bg-slate-900/80 p-5 shadow-lg shadow-slate-950/10">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300/80">Data Cleaning</p><h3 className="mt-2 text-xl font-semibold text-white">Clean the active dataset</h3><p className="mt-2 text-sm text-slate-400">Preview the changes first. The original upload remains preserved until you apply cleaning.</p></div><FileSpreadsheet className="h-6 w-6 text-blue-300" /></div>
          <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <label className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-300"><input type="checkbox" checked={cleaningOptions.remove_duplicates} onChange={(event) => setCleaningOptions({ ...cleaningOptions, remove_duplicates: event.target.checked })} className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-blue-500" />Remove duplicate rows</label>
            <label className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-300"><input type="checkbox" checked={cleaningOptions.standardize_categories} onChange={(event) => setCleaningOptions({ ...cleaningOptions, standardize_categories: event.target.checked })} className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-blue-500" />Standardize categories</label>
            <label className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-300"><input type="checkbox" checked={cleaningOptions.convert_numeric_columns} onChange={(event) => setCleaningOptions({ ...cleaningOptions, convert_numeric_columns: event.target.checked })} className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-blue-500" />Convert numeric text</label>
            <label className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-300">Numerical missing values<select value={cleaningOptions.missing_numeric} onChange={(event) => setCleaningOptions({ ...cleaningOptions, missing_numeric: event.target.value })} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"><option value="median">Median</option><option value="mean">Mean</option></select></label>
            <label className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-300">Categorical missing values<select value={cleaningOptions.missing_categorical} onChange={(event) => setCleaningOptions({ ...cleaningOptions, missing_categorical: event.target.value })} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"><option value="mode">Mode</option><option value="none">Leave missing</option></select></label>
            <label className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-300">Invalid values<select value={cleaningOptions.handle_invalid_values} onChange={(event) => setCleaningOptions({ ...cleaningOptions, handle_invalid_values: event.target.value })} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"><option value="median">Replace with median</option><option value="nan">Set as missing</option><option value="remove">Remove row</option></select></label>
          </div>
          <div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={handleCleaningPreview} disabled={cleaningLoading} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50">{cleaningLoading ? 'Preparing preview...' : 'Preview Cleaning'}</button>{cleaningPreview && <button type="button" onClick={handleApplyCleaning} disabled={cleaningLoading} className="rounded-xl border border-emerald-400/40 px-5 py-3 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/10 disabled:opacity-50">Apply Cleaning</button>}</div>
          {cleaningError && <p className="mt-4 text-sm text-red-300">{cleaningError}</p>}
          {cleaningPreview && <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/40 p-4"><h4 className="font-semibold text-white">Cleaning Preview</h4><div className="mt-3 grid gap-3 sm:grid-cols-3"><div><p className="text-xs text-slate-500">Before</p><p className="mt-1 text-xl font-semibold text-white">{cleaningPreview.rows_before.toLocaleString()} rows</p></div><div><p className="text-xs text-slate-500">After</p><p className="mt-1 text-xl font-semibold text-white">{cleaningPreview.rows_after.toLocaleString()} rows</p></div><div><p className="text-xs text-slate-500">Issues Fixed</p><p className="mt-1 text-xl font-semibold text-emerald-300">{cleaningPreview.issues_fixed.toLocaleString()}</p></div></div><div className="mt-4 grid gap-2 text-sm text-slate-300 sm:grid-cols-2"><span>Duplicates removed: {cleaningPreview.changes.duplicates_removed}</span><span>Missing values fixed: {cleaningPreview.changes.missing_fixed}</span><span>Type conversions: {cleaningPreview.changes.type_conversions}</span><span>Categories standardized: {cleaningPreview.changes.categories_standardized}</span></div></div>}
          {cleaningCompleted && <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-200"><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />Cleaning completed. The cleaned dataset is now active.</span><button type="button" onClick={handleDownloadCleaned} className="inline-flex items-center gap-2 text-emerald-100 hover:text-white"><Download className="h-4 w-4" />Download Clean CSV</button></div>}
        </section>
      )}

      {profile.rows > 0 && (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'Rows', value: profile.rows.toLocaleString(), icon: Database },
              { label: 'Columns', value: profile.columns.toString(), icon: FileText },
              { label: 'Missing Values', value: formatPercent((missingRate || 0)), icon: Percent },
              { label: 'Duplicate Rows', value: (profile.duplicate_rows || 0).toLocaleString(), icon: CheckCircle2 },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-2xl border border-slate-800/80 bg-slate-900/80 p-4 shadow-lg shadow-slate-950/20 transition duration-200 hover:-translate-y-0.5 hover:border-slate-700">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-slate-400">{label}</div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/15 to-violet-500/5 text-blue-300 ring-1 ring-blue-500/20">
                    <Icon className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-4 text-3xl font-semibold tracking-tight text-white">{value}</div>
              </div>
            ))}
          </section>

          <section className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Column Information</h3>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-800/80">
              <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
                <thead className="bg-slate-950/70 text-slate-300">
                  <tr>
                    <th className="px-4 py-3 font-medium">Column Name</th>
                    <th className="px-4 py-3 font-medium">Data Type</th>
                    <th className="px-4 py-3 font-medium">Category</th>
                    <th className="px-4 py-3 font-medium">Missing</th>
                    <th className="px-4 py-3 font-medium">Unique</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 bg-slate-900/60 text-slate-200">
                  {columnRows.map((row) => (
                    <tr key={row.name} className="transition hover:bg-slate-800/50">
                      <td className="px-4 py-3 font-medium text-white">{row.name}</td>
                      <td className="px-4 py-3">{row.type}</td>
                      <td className="px-4 py-3">{row.category}</td>
                      <td className="px-4 py-3">{row.missing}</td>
                      <td className="px-4 py-3">{row.unique}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'Missing Values', value: totalMissing.toLocaleString() },
              { label: 'Duplicate Rows', value: (profile.duplicate_rows || 0).toLocaleString() },
              { label: 'Numerical Columns', value: (profile.numerical_columns || []).length.toString() },
              { label: 'Categorical Columns', value: (profile.categorical_columns || []).length.toString() },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-2xl border border-slate-800/80 bg-slate-900/80 p-4">
                <div className="text-sm text-slate-400">{label}</div>
                <div className="mt-4 text-2xl font-semibold text-white">{value}</div>
              </div>
            ))}
          </section>

          <section className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Data Quality</h3>
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-sm font-medium text-emerald-300">
                {qualityScore} / 100
              </span>
            </div>

            <div className="rounded-2xl border border-slate-800/80 bg-slate-950/40 p-4">
              <div className="mb-2 flex items-center justify-between text-sm text-slate-300">
                <span>Data Quality Score</span>
                <span>{qualityScore} / 100</span>
              </div>
              <div className="h-2.5 rounded-full bg-slate-800/80">
                <div className="h-2.5 rounded-full bg-gradient-to-r from-emerald-500 to-blue-500" style={{ width: `${Math.min(qualityScore, 100)}%` }} />
              </div>
            </div>
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <div className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Statistical Summary</h3>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-slate-800/80">
                <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
                  <thead className="bg-slate-950/70 text-slate-300">
                    <tr>
                      <th className="px-4 py-3 font-medium">Column</th>
                      <th className="px-4 py-3 font-medium">Mean</th>
                      <th className="px-4 py-3 font-medium">Median</th>
                      <th className="px-4 py-3 font-medium">Min</th>
                      <th className="px-4 py-3 font-medium">Max</th>
                      <th className="px-4 py-3 font-medium">Std Dev</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 bg-slate-900/60 text-slate-200">
                    {numericalSummary.length > 0 ? (
                      numericalSummary.map(([column, values]) => (
                        <tr key={column} className="transition hover:bg-slate-800/50">
                          <td className="px-4 py-3 font-medium text-white">{column}</td>
                          <td className="px-4 py-3">{values.mean ?? '—'}</td>
                          <td className="px-4 py-3">{values.median ?? '—'}</td>
                          <td className="px-4 py-3">{values.min ?? '—'}</td>
                          <td className="px-4 py-3">{values.max ?? '—'}</td>
                          <td className="px-4 py-3">{values.std ?? '—'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="6" className="px-4 py-6 text-center text-slate-400">
                          No numerical columns detected.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Categorical Summary</h3>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-slate-800/80">
                <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
                  <thead className="bg-slate-950/70 text-slate-300">
                    <tr>
                      <th className="px-4 py-3 font-medium">Column</th>
                      <th className="px-4 py-3 font-medium">Unique Values</th>
                      <th className="px-4 py-3 font-medium">Most Common Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 bg-slate-900/60 text-slate-200">
                    {categoricalSummary.length > 0 ? (
                      categoricalSummary.map(([column, values]) => (
                        <tr key={column} className="transition hover:bg-slate-800/50">
                          <td className="px-4 py-3 font-medium text-white">{column}</td>
                          <td className="px-4 py-3">{values.unique_values ?? '—'}</td>
                          <td className="px-4 py-3">{values.most_frequent_value ?? '—'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="3" className="px-4 py-6 text-center text-slate-400">
                          No categorical columns detected.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      )}

      {profile.rows > 0 && edaLoading && (
        <section className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-6">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            <div>
              <h3 className="text-lg font-semibold text-white">Analyzing your dataset...</h3>
              <p className="mt-1 text-sm text-slate-400">Preparing distributions, correlations, and data insights.</p>
            </div>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {[1, 2, 3].map((item) => (
              <div key={item} className="h-24 animate-pulse rounded-2xl bg-slate-800/70" />
            ))}
          </div>
        </section>
      )}

      {profile.rows > 0 && edaError && (
        <section className="rounded-3xl border border-red-500/40 bg-red-500/5 p-5 text-red-200">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5" />
            <p>{edaError}</p>
          </div>
        </section>
      )}

      {profile.rows > 0 && !edaLoading && !edaError && (
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <BarChart3 className="h-5 w-5 text-blue-300" />
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-blue-300/80">Exploratory Analysis</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-white">EDA Overview</h2>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'Numerical Features', value: numericalDistributions.length, icon: BarChart3 },
              { label: 'Categorical Features', value: categoricalAnalysis.length, icon: FileText },
              { label: 'Missing Values', value: missingTotal.toLocaleString(), icon: Percent },
              { label: 'Strongest Correlation', value: strongestCorrelationValue, icon: CheckCircle2 },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-2xl border border-slate-800/80 bg-slate-900/80 p-4 shadow-lg shadow-slate-950/20">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-400">{label}</p>
                  <Icon className="h-4 w-4 text-blue-300" />
                </div>
                <p className="mt-4 text-3xl font-semibold tracking-tight text-white">{value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-5">
            <div className="mb-5 flex items-center gap-3">
              <BarChart3 className="h-5 w-5 text-blue-300" />
              <h3 className="text-lg font-semibold text-white">Numerical Distributions</h3>
            </div>
            {numericalDistributions.length > 0 ? (
              <div className="grid gap-5 lg:grid-cols-2">
                {numericalDistributions.map(([column, values]) => (
                  <div key={column} className="min-w-0 rounded-2xl border border-slate-800/80 bg-slate-950/40 p-4">
                    <h4 className="mb-4 font-medium text-slate-100">Distribution of {column}</h4>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={values} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
                          <CartesianGrid stroke="rgba(148, 163, 184, 0.15)" vertical={false} />
                          <XAxis dataKey="range" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={false} />
                          <YAxis allowDecimals={false} tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={false} />
                          <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(148, 163, 184, 0.2)', borderRadius: '12px', color: '#e2e8f0' }} />
                          <Bar dataKey="count" fill="#60a5fa" radius={[5, 5, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No numerical columns detected.</p>
            )}
          </div>

          <div className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-5">
            <div className="mb-5 flex items-center gap-3">
              <BarChart3 className="h-5 w-5 text-violet-300" />
              <h3 className="text-lg font-semibold text-white">Categorical Analysis</h3>
            </div>
            {categoricalAnalysis.length > 0 ? (
              <div className="grid gap-5 lg:grid-cols-2">
                {categoricalAnalysis.map(([column, values]) => (
                  <div key={column} className="min-w-0 rounded-2xl border border-slate-800/80 bg-slate-950/40 p-4">
                    <h4 className="mb-4 font-medium text-slate-100">{column} Distribution</h4>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={values} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
                          <CartesianGrid stroke="rgba(148, 163, 184, 0.15)" vertical={false} />
                          <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={false} angle={-20} textAnchor="end" height={52} />
                          <YAxis allowDecimals={false} tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={false} />
                          <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(148, 163, 184, 0.2)', borderRadius: '12px', color: '#e2e8f0' }} />
                          <Bar dataKey="count" fill="#a78bfa" radius={[5, 5, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No categorical columns detected.</p>
            )}
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <div className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-5">
              <div className="mb-5 flex items-center gap-3">
                <BarChart3 className="h-5 w-5 text-blue-300" />
                <h3 className="text-lg font-semibold text-white">Correlation Analysis</h3>
              </div>
              {correlationColumns.length > 0 ? (
                <div className="overflow-x-auto">
                  <div className="min-w-[420px]">
                    <div className="grid gap-1" style={{ gridTemplateColumns: `minmax(96px, 1fr) repeat(${correlationColumns.length}, minmax(58px, 1fr))` }}>
                      <div />
                      {correlationColumns.map((column) => (
                        <div key={column} className="truncate px-1 py-2 text-center text-xs text-slate-400" title={column}>{column}</div>
                      ))}
                      {correlationColumns.map((row, rowIndex) => (
                        <div key={row} className="contents">
                          <div className="truncate px-1 py-2 text-right text-xs text-slate-400" title={row}>{row}</div>
                          {correlationMatrix[rowIndex]?.map((value, columnIndex) => {
                            const intensity = Math.abs(Number(value));
                            return (
                              <div
                                key={`${row}-${correlationColumns[columnIndex]}`}
                                className="flex min-h-12 items-center justify-center rounded-md text-xs font-semibold text-white"
                                style={{ backgroundColor: `rgba(96, 165, 250, ${0.1 + intensity * 0.7})` }}
                              >
                                {Number(value).toFixed(2)}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-400">At least one numerical column is needed for correlation analysis.</p>
              )}
            </div>

            <div className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-5">
              <div className="mb-5 flex items-center gap-3">
                <Percent className="h-5 w-5 text-amber-300" />
                <h3 className="text-lg font-semibold text-white">Missing Values</h3>
              </div>
              {missingAnalysis.length > 0 ? (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={missingAnalysis} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid stroke="rgba(148, 163, 184, 0.15)" horizontal={false} />
                      <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis dataKey="column" type="category" width={96} tick={{ fill: '#cbd5e1', fontSize: 11 }} tickLine={false} axisLine={false} />
                      <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}%`, 'Missing']} contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(148, 163, 184, 0.2)', borderRadius: '12px', color: '#e2e8f0' }} />
                      <Bar dataKey="percentage" fill="#fbbf24" radius={[0, 5, 5, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-slate-400">No missing values were detected.</p>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-blue-500/20 bg-gradient-to-br from-blue-500/10 via-slate-900/80 to-violet-500/10 p-5">
            <div className="mb-5 flex items-center gap-3">
              <Lightbulb className="h-5 w-5 text-amber-300" />
              <div>
                <h3 className="text-lg font-semibold text-white">Key Data Insights</h3>
                <p className="mt-1 text-xs text-slate-400">Generated from Pandas and NumPy analysis.</p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {(eda.insights || []).map((insight) => (
                <div key={insight} className="rounded-2xl border border-slate-700/70 bg-slate-950/40 p-4 text-sm leading-6 text-slate-200">
                  {insight}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
