import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Sparkles,
  UploadCloud,
  Wand2,
} from 'lucide-react';
import { API_BASE_URL, backendUnavailableMessage } from '../api';

const defaultActionList = [
  { id: 'remove_duplicates', label: 'Remove duplicate rows', enabled: true },
  { id: 'fill_numeric', label: 'Fill missing numerical values using median', enabled: true },
  { id: 'fill_categorical', label: 'Fill missing categorical values using mode', enabled: true },
  { id: 'standardize_categories', label: 'Standardize categorical values', enabled: true },
  { id: 'convert_numeric_text', label: 'Convert numeric text values', enabled: true },
  { id: 'handle_suspicious_values', label: 'Handle suspicious and outlier values', enabled: true },
];

function severityTone(severity) {
  const normalized = String(severity || 'medium').toLowerCase();
  if (normalized === 'high') return 'border-red-500/40 bg-red-500/5 text-red-200';
  if (normalized === 'low') return 'border-emerald-500/40 bg-emerald-500/5 text-emerald-200';
  return 'border-amber-500/40 bg-amber-500/5 text-amber-200';
}

function issueTitle(type) {
  const value = String(type || '').toLowerCase().replace(/\\s+/g, '_');
  const titles = {
    missing_values: 'Missing Values',
    duplicate_rows: 'Duplicate Rows',
    duplicates: 'Duplicate Rows',
    category_issues: 'Category Issues',
    numeric_type_issues: 'Numeric Type Issues',
    numeric_type: 'Numeric Type Issues',
    data_type_issues: 'Data Type Issues',
    invalid_values: 'Invalid Values',
    outliers: 'Outliers',
  };
  return titles[value] || 'Data Quality Issue';
}

function issueDescription(type) {
  const value = String(type || '').toLowerCase().replace(/\\s+/g, '_');
  if (value.includes('duplicate')) return 'duplicate records';
  if (value.includes('missing')) return 'missing values';
  if (value.includes('outlier')) return 'outlier values';
  return 'affected records';
}

function mapSelectedActions(actions) {
  const selected = new Set(actions.filter((action) => action.enabled).map((action) => action.id));

  return {
    remove_duplicates: selected.has('remove_duplicates'),
    fill_numeric: selected.has('fill_numeric'),
    fill_categorical: selected.has('fill_categorical'),
    missing_numeric: selected.has('fill_numeric') ? 'median' : 'mean',
    missing_categorical: selected.has('fill_categorical') ? 'mode' : 'none',
    standardize_categories: selected.has('standardize_categories'),
    convert_numeric_columns: selected.has('convert_numeric_text'),
    handle_invalid_values: selected.has('handle_suspicious_values') ? 'median' : 'nan',
  };
}

export default function AISuggestions({ onNavigate }) {
  const [datasetInfo, setDatasetInfo] = useState({ uploaded: false, filename: '', rows: 0 });
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [recommendedActions, setRecommendedActions] = useState(defaultActionList);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [cleaningSuccess, setCleaningSuccess] = useState(false);
  const [cleanedSummary, setCleanedSummary] = useState(null);

  const loadDatasetStatus = async () => {
    setStatusError('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/dataset/status`);
      const statusData = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(statusData?.error || 'Unable to load dataset status.');
      }

      const uploaded = Boolean(statusData?.uploaded);

      if (!uploaded) {
        setDatasetInfo({
          uploaded: false,
          filename: '',
          rows: 0,
          columns: 0,
        });
        return;
      }

      const dashboardResponse = await fetch(`${API_BASE_URL}/api/dashboard`);
      const dashboardData = await dashboardResponse.json().catch(() => ({}));

      setDatasetInfo({
        uploaded: true,
        filename:
          dashboardData?.dataset_name ||
          dashboardData?.filename ||
          dashboardData?.dataset?.name ||
          'Loaded Dataset',
        rows: Number(
          dashboardData?.rows ||
          dashboardData?.dataset?.rows ||
          0
        ),
        columns: Number(
          dashboardData?.columns ||
          dashboardData?.dataset?.columns ||
          0
        ),
      });
    } catch (statusFetchError) {
      console.error('Dataset status error:', statusFetchError);
      setStatusError(
        statusFetchError instanceof TypeError
          ? backendUnavailableMessage
          : 'Unable to load dataset status. Please check that the backend is running.'
      );
    }
  };

  useEffect(() => {
    loadDatasetStatus();
    const onDatasetUpdate = () => loadDatasetStatus();
    window.addEventListener('datamind:dataset-updated', onDatasetUpdate);
    return () => window.removeEventListener('datamind:dataset-updated', onDatasetUpdate);
  }, []);

  const issueCards = useMemo(() => analysis?.issues || [], [analysis]);

  const toggleAction = (actionId) => {
    setRecommendedActions((current) =>
      current.map((action) =>
        action.id === actionId ? { ...action, enabled: !action.enabled } : action,
      ),
    );
  };

  const handleAnalyze = async () => {
    if (!datasetInfo.uploaded) {
      setError('Please upload a dataset before running the AI advisor.');
      return;
    }

    setError('');
    setLoadingAnalysis(true);
    setAnalysis(null);
    setPreview(null);
    setCleaningSuccess(false);
    setCleanedSummary(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/ai/data-advisor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => ({}));

      // HTTP 200 + ai_used=false is a valid Pandas fallback from the backend.
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Unable to analyze this dataset.');
      }

      if (!data || typeof data !== 'object' || !data.summary) {
        throw new Error('AI Advisor returned an invalid response.');
      }

      const actions = Array.isArray(data.recommended_actions)
        ? data.recommended_actions
        : [];

      const normalizedActions = actions
        .filter((action) => action && action.id && action.label)
        .map((action) => ({
          id: String(action.id),
          label: String(action.label),
          enabled:
            typeof action.enabled === 'boolean'
              ? action.enabled
              : true,
        }));

      setRecommendedActions(normalizedActions);
      setAnalysis(data);
    } catch (fetchError) {
      setError(fetchError instanceof TypeError ? backendUnavailableMessage : fetchError.message);
      setAnalysis(null);
    } finally {
      setLoadingAnalysis(false);
    }
  };

  const handlePreviewSelectedFixes = async () => {
    if (!datasetInfo.uploaded) {
      setError('Please upload a dataset before previewing cleaning changes.');
      return;
    }

    setPreviewLoading(true);
    setError('');
    try {
      const selectedPayload = mapSelectedActions(recommendedActions);
      const response = await fetch(`${API_BASE_URL}/api/clean/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedPayload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Unable to preview cleaning changes.');
      setPreview(data);
    } catch (fetchError) {
      setError(fetchError instanceof TypeError ? backendUnavailableMessage : fetchError.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleApplySelectedFixes = async () => {
    if (!datasetInfo.uploaded) {
      setError('Please upload a dataset before applying cleaning changes.');
      return;
    }

    setApplyLoading(true);
    setError('');
    try {
      const selectedPayload = mapSelectedActions(recommendedActions);
      const response = await fetch(`${API_BASE_URL}/api/clean`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedPayload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Unable to apply cleaning changes.');

      setCleaningSuccess(true);
      setCleanedSummary({
        beforeRows: Number(data?.rows_before || datasetInfo.rows || 0),
        afterRows: Number(data?.rows_after || datasetInfo.rows || 0),
        issuesAddressed:
          Number(data?.changes?.duplicates_removed || 0) +
          Number(data?.changes?.missing_fixed || 0) +
          Number(data?.changes?.type_conversions || 0) +
          Number(data?.changes?.categories_standardized || 0) +
          Number(data?.changes?.invalid_values_fixed || 0),
      });
      setPreview(null);
      await loadDatasetStatus();
    } catch (fetchError) {
      setError(fetchError instanceof TypeError ? backendUnavailableMessage : fetchError.message);
    } finally {
      setApplyLoading(false);
    }
  };

  const handleDownloadCleaned = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/download-cleaned`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data?.error || 'Unable to download the cleaned dataset.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'DataMind_Cleaned_Dataset.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (fetchError) {
      setError(fetchError instanceof TypeError ? backendUnavailableMessage : fetchError.message);
    }
  };

  const statusTone = analysis?.overall_status === 'Good' ? 'text-emerald-300' : 'text-amber-300';

  if (!datasetInfo.uploaded) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-2">
        <div className="w-full max-w-2xl rounded-[28px] border border-slate-800/80 bg-slate-900/80 p-8 text-center shadow-glow">
          {statusError && (
            <div className="mb-5 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm text-amber-200">
              {statusError}
            </div>
          )}
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-violet-500/30 bg-violet-500/10 text-violet-200">
            <Sparkles className="h-8 w-8" />
          </div>
          <h3 className="text-3xl font-semibold tracking-tight text-white">Your AI Data Advisor is Ready</h3>
          <p className="mt-4 text-base text-slate-300">
            Upload a dataset and let AI recommend improvements before training your machine learning model.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('dataset')}
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110"
          >
            <UploadCloud className="h-4 w-4" />
            Upload Dataset
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] border border-slate-800/80 bg-slate-900/80 p-6 shadow-glow">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-4 flex items-center gap-2 text-violet-300">
              <Sparkles className="h-5 w-5" />
              <span className="text-xs font-semibold uppercase tracking-[0.22em]">AI Suggestions</span>
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-white">AI Suggestions</h2>
            <p className="mt-2 max-w-2xl text-base text-slate-300">
              Get intelligent recommendations to prepare your dataset for machine learning.
            </p>
          </div>

          <button
            type="button"
            onClick={handleAnalyze}
            disabled={loadingAnalysis}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Sparkles className={['h-4 w-4', loadingAnalysis ? 'animate-pulse' : ''].join(' ')} />
            {loadingAnalysis ? 'Analyzing dataset...' : '✨ Analyze Dataset with AI'}
          </button>
        </div>
      </div>

      <div className="rounded-[28px] border border-slate-800/80 bg-slate-900/80 p-5">
        <div className="flex items-center gap-3 text-slate-200">
          <FileSpreadsheet className="h-5 w-5 text-violet-300" />
          <h3 className="text-lg font-semibold text-white">Current Dataset</h3>
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xl font-medium text-white">{datasetInfo.filename || 'Loaded Dataset'}</p>
            <div className="mt-2 flex items-center gap-2 text-sm text-slate-300">
              <span className="font-medium text-emerald-300">Status:</span>
              <span>✓ Dataset Loaded</span>
            </div>
          </div>
          <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 px-3 py-2 text-sm text-violet-200">
            Ready for AI Review
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/5 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      {loadingAnalysis && (
        <div className="rounded-[28px] border border-slate-800/80 bg-slate-900/80 p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-violet-500/30 bg-violet-500/10 text-violet-200">
            <Sparkles className="h-6 w-6 animate-pulse" />
          </div>
          <p className="text-xl font-semibold text-white">AI is reviewing your dataset...</p>
          <p className="mt-2 text-sm text-slate-400">Checking data quality and ML readiness...</p>
        </div>
      )}

      {analysis && (
        <>
          <div className="rounded-[28px] border border-slate-800/80 bg-slate-900/80 p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-violet-500/30 bg-violet-500/10 text-violet-200">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-violet-300">AI Data Advisor</p>
                <h3 className="text-2xl font-semibold text-white">AI Data Advisor</h3>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Status</p>
                <p className={`mt-2 text-lg font-semibold ${statusTone}`}>{analysis.overall_status || 'Needs Cleaning'}</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Quality Score</p>
                <p className="mt-2 text-lg font-semibold text-white">{analysis.quality_score ?? 0} / 100</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">ML Readiness</p>
                <p className="mt-2 text-lg font-semibold text-white">{analysis.ml_readiness || 'Needs Cleaning'}</p>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">AI Summary</p>
              <p className="mt-3 text-base text-slate-200">{analysis.summary}</p>

              {analysis.ai_used === false && (
                <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                  Groq AI is temporarily unavailable. DataMind used its Pandas
                  data-quality engine for these recommendations.
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-2xl font-semibold text-white">Detected Issues</h3>
            <div className="grid gap-4 md:grid-cols-2">
              {issueCards.length ? (
                issueCards.map((issue, index) => (
                  <div key={`${issue.type}-${issue.column}-${index}`} className={`rounded-[22px] border p-4 ${severityTone(issue.severity)}`}>
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-lg font-semibold text-white">
                        <AlertTriangle className="h-4 w-4" />
{issueTitle(issue.type)}
                      </div>
                      <span className="rounded-full border border-current/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]">
                        {String(issue.severity || 'medium').toUpperCase()}
                      </span>
                    </div>
                    <p className="text-sm text-slate-100">{String(issue.column || 'Dataset')}</p>
                    <p className="mt-3 text-2xl font-semibold text-white">{Number(issue.count || 0).toLocaleString()}</p>
                    <p className="mt-3 text-sm text-slate-200">{issueDescription(issue.type)}</p>
                    <div className="mt-5 rounded-xl border border-current/20 bg-slate-950/30 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">Recommendation</p>
                      <p className="mt-2 text-sm text-slate-100">{issue.recommendation}</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="md:col-span-2 rounded-2xl border border-slate-800 bg-slate-950/40 p-6 text-slate-300">
                  No issues were detected by the AI advisor for this dataset.
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-2xl font-semibold text-white">Recommended Cleaning Actions</h3>
            <div className="space-y-3">
              {recommendedActions.map((action) => (
                <label key={action.id} className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-3 text-slate-200 transition hover:border-violet-500/40 hover:bg-slate-800/80">
                  <input
                    type="checkbox"
                    checked={Boolean(action.enabled)}
                    onChange={() => toggleAction(action.id)}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-violet-500"
                  />
                  <span>{action.label}</span>
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={handlePreviewSelectedFixes}
              disabled={previewLoading}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
            >
              <Wand2 className="h-4 w-4" />
              {previewLoading ? 'Preparing preview...' : 'Preview Selected Fixes'}
            </button>
          </div>

          {preview && (
            <div className="rounded-[28px] border border-slate-800/80 bg-slate-900/80 p-6">
              <div className="mb-4 flex items-center gap-2 text-violet-300">
                <Wand2 className="h-5 w-5" />
                <h3 className="text-2xl font-semibold text-white">Cleaning Preview</h3>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Before Cleaning</p>
                  <p className="mt-2 text-3xl font-semibold text-white">{Number(preview.rows_before || 0).toLocaleString()}</p>
                  <p className="mt-1 text-sm text-slate-400">Rows</p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">After Cleaning</p>
                  <p className="mt-2 text-3xl font-semibold text-white">{Number(preview.rows_after || 0).toLocaleString()}</p>
                  <p className="mt-1 text-sm text-slate-400">Rows</p>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Changes</p>
                <ul className="mt-3 space-y-2 text-sm text-slate-200">
                  {preview.changes?.duplicates_removed ? <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-300" /> {Number(preview.changes.duplicates_removed).toLocaleString()} duplicate rows will be removed</li> : null}
                  {preview.changes?.missing_fixed ? <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-300" /> {Number(preview.changes.missing_fixed).toLocaleString()} missing values will be handled</li> : null}
                  {preview.changes?.categories_standardized ? <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-300" /> {Number(preview.changes.categories_standardized).toLocaleString()} categorical inconsistencies will be standardized</li> : null}
                  {preview.changes?.type_conversions ? <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-300" /> {Number(preview.changes.type_conversions).toLocaleString()} numeric values will be converted</li> : null}
                </ul>
              </div>

              <button
                type="button"
                onClick={handleApplySelectedFixes}
                disabled={applyLoading}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
              >
                <CheckCircle2 className="h-4 w-4" />
                {applyLoading ? 'Applying selected fixes...' : 'Apply Selected Fixes'}
              </button>
            </div>
          )}

          {cleaningSuccess && cleanedSummary && (
            <div className="rounded-[28px] border border-emerald-500/30 bg-emerald-500/5 p-6">
              <div className="mb-4 flex items-center gap-3 text-emerald-200">
                <CheckCircle2 className="h-6 w-6" />
                <h3 className="text-2xl font-semibold text-white">✓ Dataset Successfully Cleaned</h3>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-emerald-500/20 bg-slate-950/40 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Before</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{Number(cleanedSummary.beforeRows || 0).toLocaleString()}</p>
                  <p className="text-sm text-slate-400">Rows</p>
                </div>
                <div className="rounded-2xl border border-emerald-500/20 bg-slate-950/40 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">After</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{Number(cleanedSummary.afterRows || 0).toLocaleString()}</p>
                  <p className="text-sm text-slate-400">Rows</p>
                </div>
                <div className="rounded-2xl border border-emerald-500/20 bg-slate-950/40 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Issues Addressed</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{Number(cleanedSummary.issuesAddressed || 0).toLocaleString()}</p>
                </div>
              </div>

              <p className="mt-5 text-base text-slate-200">The selected data quality recommendations have been applied.</p>

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => onNavigate('dataset')}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-slate-500"
                >
                  Go to Dataset Analysis
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('ml')}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-slate-500"
                >
                  Go to ML Prediction
                </button>
                <button
                  type="button"
                  onClick={handleDownloadCleaned}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
                >
                  <Download className="h-4 w-4" />
                  Download Clean Dataset
                </button>
              </div>

              <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">ML Readiness</p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-slate-300">Before: <span className="font-medium text-amber-300">⚠ Needs Improvement</span></div>
                  <ArrowRight className="hidden h-4 w-4 text-slate-500 sm:block" />
                  <div className="text-sm text-slate-300">After: <span className="font-medium text-emerald-300">✓ Improved</span></div>
                </div>
                <p className="mt-3 text-sm text-slate-200">The detected data quality issues selected by you have been addressed. You can now continue to machine learning.</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
