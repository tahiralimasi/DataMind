import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Database,
  Info,
  LoaderCircle,
  Lightbulb,
  Settings2,
  Target,
  Trophy,
  TrendingUp,
} from 'lucide-react';
import { API_BASE_URL, backendUnavailableMessage } from '../api';

const classificationModels = [
  { key: 'logistic_regression', label: 'Logistic Regression' },
  { key: 'random_forest', label: 'Random Forest Classifier' },
  { key: 'decision_tree', label: 'Decision Tree Classifier' },
  { key: 'knn', label: 'K-Nearest Neighbors' },
  { key: 'support_vector_machine', label: 'Support Vector Machine' },
  { key: 'gradient_boosting', label: 'Gradient Boosting Classifier' },
];

const regressionModels = [
  { key: 'linear_regression', label: 'Linear Regression' },
  { key: 'random_forest_regressor', label: 'Random Forest Regressor' },
  { key: 'decision_tree_regressor', label: 'Decision Tree Regressor' },
  { key: 'knn_regressor', label: 'K-Nearest Neighbors Regressor' },
  { key: 'gradient_boosting_regressor', label: 'Gradient Boosting Regressor' },
];

const defaultSelections = {
  classification: ['logistic_regression', 'random_forest', 'decision_tree'],
  regression: ['linear_regression', 'random_forest_regressor', 'decision_tree_regressor'],
};

const emptyResults = {
  models: [],
  best_model: '',
  best_metrics: {},
  best_training_time: 0,
  feature_importance: [],
  train_rows: 0,
  test_rows: 0,
};

const formatMetric = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return Number(value).toFixed(4);
};

const formatTime = (value) => `${Number(value || 0).toFixed(3)}s`;

function ConfigCard({ title, icon: Icon, open, onToggle, children }) {
  return (
    <section className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-5">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between text-left">
        <span className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-300">
            <Icon className="h-4 w-4" />
          </span>
          <span className="text-lg font-semibold text-white">{title}</span>
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>
      {open && <div className="mt-5">{children}</div>}
    </section>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-300">
      <input type="checkbox" checked={checked} onChange={onChange} className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-blue-500 focus:ring-blue-500" />
      {label}
    </label>
  );
}

export default function MLPrediction() {
  const [columns, setColumns] = useState([]);
  const [datasetInfo, setDatasetInfo] = useState({ filename: '', rows: 0, columns_count: 0 });
  const [targetTypes, setTargetTypes] = useState({});
  const [datetimeColumns, setDatetimeColumns] = useState([]);
  const [targetColumn, setTargetColumn] = useState('');
  const [problemType, setProblemType] = useState('auto');
  const [selectedModels, setSelectedModels] = useState(defaultSelections.classification);
  const [testSize, setTestSize] = useState('0.2');
  const [randomState, setRandomState] = useState('42');
  const [preprocessing, setPreprocessing] = useState({
    impute_missing: true,
    encode_categorical: true,
    scale_numeric: false,
  });
  const [crossValidation, setCrossValidation] = useState({ enabled: false, folds: 5 });
  const [results, setResults] = useState(emptyResults);
  const [selectedResult, setSelectedResult] = useState(null);
  const [predictionValues, setPredictionValues] = useState({});
  const [predictionResult, setPredictionResult] = useState(null);
  const [explanation, setExplanation] = useState(null);
  const [explanationLoading, setExplanationLoading] = useState(false);
  const [explanationError, setExplanationError] = useState('');
  const [predictionLoading, setPredictionLoading] = useState(false);
  const [predictionError, setPredictionError] = useState('');
  const [predictionHistory, setPredictionHistory] = useState([]);
  const [sort, setSort] = useState({ key: 'score', direction: 'desc' });
  const [openSections, setOpenSections] = useState({
    dataset: true,
    problem: true,
    models: true,
    configuration: true,
    preprocessing: true,
    validation: true,
  });
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [training, setTraining] = useState(false);
  const [trainingStage, setTrainingStage] = useState('');
  const [error, setError] = useState('');

  const detectedType = targetColumn ? targetTypes[targetColumn] : '';
  const resolvedType = problemType === 'auto' ? detectedType : problemType;
  const availableModels = resolvedType === 'regression' ? regressionModels : classificationModels;
  const isDatetimeTarget = datetimeColumns.includes(targetColumn) || detectedType === 'datetime';

  useEffect(() => {
    const loadOptions = async () => {
      try {
        const statusResponse = await fetch(`${API_BASE_URL}/api/dataset/status`);
        if (!statusResponse.ok) throw new Error('Unable to check dataset status.');
        const status = await statusResponse.json();
        if (!status.uploaded) {
          setError('Upload a dataset first to start machine learning.');
          return;
        }

        const response = await fetch(`${API_BASE_URL}/api/ml/options`);
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || 'Please upload a dataset first.');
        setColumns(data.columns || []);
        setDatasetInfo({ filename: data.filename || 'Uploaded dataset', rows: data.rows || 0, columns_count: data.columns_count || (data.columns || []).length });
        setTargetTypes(data.target_types || {});
        setDatetimeColumns(data.datetime_columns || []);
        if (data.selected_target) {
          setTargetColumn(data.selected_target);
          setProblemType('auto');
        }
      } catch (fetchError) {
        setError(fetchError instanceof TypeError ? backendUnavailableMessage : (fetchError.message || 'Please upload a dataset first.'));
      } finally {
        setLoadingOptions(false);
      }
    };

    loadOptions();
  }, []);

  useEffect(() => {
    if (resolvedType === 'classification' || resolvedType === 'regression') {
      setSelectedModels(defaultSelections[resolvedType]);
    }
  }, [resolvedType]);

  const toggleSection = (section) => {
    setOpenSections((current) => ({ ...current, [section]: !current[section] }));
  };

  const handleTargetChange = async (event) => {
    const nextTarget = event.target.value;
    setTargetColumn(nextTarget);
    setProblemType('auto');
    setResults(emptyResults);
    setSelectedResult(null);
    setError('');
    if (!nextTarget) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/target`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_column: nextTarget }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Unable to save target selection.');
    } catch (targetError) {
      setError(targetError instanceof TypeError ? backendUnavailableMessage : targetError.message);
    }
  };

  const handleProblemTypeChange = (event) => {
    setProblemType(event.target.value);
    setResults(emptyResults);
    setSelectedResult(null);
    setError('');
  };

  const handleModelToggle = (modelKey) => {
    setSelectedModels((current) => current.includes(modelKey)
      ? current.filter((key) => key !== modelKey)
      : [...current, modelKey]);
    setResults(emptyResults);
    setSelectedResult(null);
  };

  const selectAllModels = () => setSelectedModels(availableModels.map((model) => model.key));
  const clearAllModels = () => setSelectedModels([]);

  const validateBeforeTraining = () => {
    if (!targetColumn) return 'Select a target column before training.';
    if (isDatetimeTarget) return 'Date/time columns are not recommended as direct prediction targets. Extract time features first.';
    if (!resolvedType || !['classification', 'regression'].includes(resolvedType)) return 'Select a valid problem type.';
    if (!selectedModels.length) return 'Select at least one model before training.';
    if (resolvedType === 'regression' && detectedType === 'classification') return 'This target looks categorical or low-cardinality. Choose Classification or select a continuous numeric target for Regression.';
    if (resolvedType === 'classification' && detectedType === 'regression') return 'This target looks continuous. Choose Regression for this target.';
    if (!Number.isInteger(Number(randomState))) return 'Random state must be an integer.';
    return '';
  };

  const handleTrain = async () => {
    const validationError = validateBeforeTraining();
    if (validationError) {
      setError(validationError);
      return;
    }

    setTraining(true);
    setError('');
    setResults(emptyResults);
    setSelectedResult(null);
    setTrainingStage('Preparing data...');
    await new Promise((resolve) => setTimeout(resolve, 120));
    setTrainingStage('Preprocessing...');
    await new Promise((resolve) => setTimeout(resolve, 120));
    setTrainingStage('Training models...');

    try {
      const response = await fetch(`${API_BASE_URL}/api/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_column: targetColumn,
          problem_type: problemType,
          models: selectedModels,
          test_size: Number(testSize),
          random_state: Number(randomState),
          preprocessing,
          cross_validation: crossValidation,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Unable to train the selected models.');
      setTrainingStage('Comparing results...');
      setResults({ ...emptyResults, ...data });
      setSelectedResult(data.models?.find((model) => model.name === data.best_model) || data.models?.[0] || null);
      setPredictionValues(Object.fromEntries((data.feature_schema || []).map((field) => [field.name, ''])));
      setPredictionResult(null);
      setExplanation(null);
      setExplanationError('');
      setPredictionHistory([]);
    } catch (trainError) {
      setResults(emptyResults);
      setSelectedResult(null);
      setError(trainError instanceof TypeError ? backendUnavailableMessage : (trainError.message || 'Unable to train the selected models.'));
    } finally {
      setTraining(false);
      setTrainingStage('');
    }
  };

  const handlePrediction = async () => {
    if (!results.feature_schema?.length) {
      setPredictionError('Please train a model first.');
      return;
    }
    const missingField = results.feature_schema.find((field) => field.required && (predictionValues[field.name] === undefined || predictionValues[field.name] === ''));
    if (missingField) {
      setPredictionError('Please check the entered values.');
      return;
    }

    setPredictionLoading(true);
    setPredictionError('');
    setExplanation(null);
    setExplanationError('');
    let predictionSucceeded = false;
    try {
      const response = await fetch(`${API_BASE_URL}/api/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features: predictionValues, model_key: selectedResult?.key }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Unable to generate prediction for these values.');
      setPredictionResult(data);
      predictionSucceeded = true;
      setPredictionHistory((current) => [{ ...data, model: selectedResult?.name || results.best_model, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }, ...current].slice(0, 8));
      setExplanationLoading(true);
      const explanationResponse = await fetch(`${API_BASE_URL}/api/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features: predictionValues, model_key: selectedResult?.key }),
      });
      const explanationData = await explanationResponse.json();
      if (!explanationResponse.ok) throw new Error(explanationData?.error || 'Unable to explain this prediction.');
      setExplanation(explanationData);
    } catch (predictionFetchError) {
      if (predictionSucceeded) {
        setExplanationError(predictionFetchError instanceof TypeError ? 'Explanation service is unavailable.' : (predictionFetchError.message || 'Unable to explain this prediction.'));
      } else {
        setPredictionError(predictionFetchError instanceof TypeError ? 'Prediction service is unavailable. Make sure Flask is running.' : (predictionFetchError.message || 'Unable to generate prediction for these values.'));
      }
    } finally {
      setExplanationLoading(false);
      setPredictionLoading(false);
    }
  };

  const resetPrediction = () => {
    setPredictionValues(Object.fromEntries((results.feature_schema || []).map((field) => [field.name, ''])));
    setPredictionResult(null);
    setExplanation(null);
    setExplanationError('');
    setPredictionError('');
  };

  const sortBy = (key) => {
    setSort((current) => ({ key, direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc' }));
  };

  const sortedModels = useMemo(() => {
    const models = [...results.models];
    return models.sort((first, second) => {
      const firstValue = sort.key === 'score' ? first.score : first[sort.key] ?? first.metrics?.[sort.key];
      const secondValue = sort.key === 'score' ? second.score : second[sort.key] ?? second.metrics?.[sort.key];
      if (typeof firstValue === 'string') return sort.direction === 'asc' ? firstValue.localeCompare(secondValue) : secondValue.localeCompare(firstValue);
      return sort.direction === 'asc' ? Number(firstValue || 0) - Number(secondValue || 0) : Number(secondValue || 0) - Number(firstValue || 0);
    });
  }, [results.models, sort]);

  const isClassification = resolvedType === 'classification';
  const metricHeaders = isClassification
    ? [['accuracy', 'Accuracy'], ['precision', 'Precision'], ['recall', 'Recall'], ['f1', 'F1'], ['roc_auc', 'ROC-AUC']]
    : [['r2', 'R²'], ['mae', 'MAE'], ['mse', 'MSE'], ['rmse', 'RMSE']];

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-800/80 bg-slate-900/75 p-6 shadow-glow">
        <div className="max-w-3xl">
          <p className="text-sm font-medium uppercase tracking-[0.22em] text-blue-300/80">Experiment Studio</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">Machine Learning</h2>
          <p className="mt-3 text-base text-slate-400">Configure, train, and compare models against your uploaded dataset.</p>
        </div>
      </section>

      {error && (
        <section className="rounded-3xl border border-red-500/40 bg-red-500/5 p-5 text-red-200">
          <div className="flex items-center gap-3"><AlertTriangle className="h-5 w-5" /><p>{error}</p></div>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {[
          ['Dataset', datasetInfo.filename || 'No dataset', Database],
          ['Rows', datasetInfo.rows.toLocaleString(), Database],
          ['Columns', datasetInfo.columns_count.toString(), BarChart3],
          ['Target', targetColumn || '—', Target],
          ['Problem', resolvedType ? resolvedType.replace(/^./, (letter) => letter.toUpperCase()) : '—', Settings2],
          ['Best Model', results.best_model || 'Not trained', Trophy],
        ].map(([label, value, Icon]) => (
          <div key={label} className="min-w-0 rounded-2xl border border-slate-800/80 bg-slate-900/75 p-4 shadow-lg shadow-slate-950/10">
            <div className="flex items-center justify-between gap-2"><span className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</span><Icon className="h-4 w-4 shrink-0 text-blue-300" /></div>
            <p className="mt-3 truncate text-sm font-semibold text-white" title={String(value)}>{value}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <ConfigCard title="Dataset & Target" icon={Database} open={openSections.dataset} onToggle={() => toggleSection('dataset')}>
          <label htmlFor="target-column" className="mb-2 block text-sm text-slate-300">Target Column</label>
          <select id="target-column" value={targetColumn} onChange={handleTargetChange} disabled={loadingOptions || !columns.length || training} className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-3 text-sm text-slate-300 outline-none transition focus:border-blue-500 disabled:opacity-60">
            <option value="">{loadingOptions ? 'Loading dataset columns...' : 'Select target column'}</option>
            {columns.map((column) => <option key={column} value={column}>{column}</option>)}
          </select>
          {isDatetimeTarget && (
            <div className="mt-4 flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm leading-6 text-amber-200">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p>Date/time columns are not recommended as direct prediction targets. Consider extracting year, month, day or other time features.</p>
            </div>
          )}
        </ConfigCard>

        <ConfigCard title="Problem Type" icon={Target} open={openSections.problem} onToggle={() => toggleSection('problem')}>
          <label htmlFor="problem-type" className="mb-2 block text-sm text-slate-300">Problem Type</label>
          <select id="problem-type" value={problemType} onChange={handleProblemTypeChange} disabled={!targetColumn || training} className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-3 text-sm capitalize text-slate-300 outline-none transition focus:border-blue-500 disabled:opacity-60">
            <option value="auto">Auto Detect</option>
            <option value="classification">Classification</option>
            <option value="regression">Regression</option>
          </select>
          <p className="mt-3 text-sm text-slate-400">Detected type: <span className="capitalize text-blue-300">{detectedType || 'Select a target column'}</span></p>
        </ConfigCard>

        <ConfigCard title="Model Selection" icon={BrainCircuit} open={openSections.models} onToggle={() => toggleSection('models')}>
          <div className="mb-4 flex flex-wrap gap-2">
            <button type="button" onClick={selectAllModels} disabled={!targetColumn || training} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-400 disabled:opacity-50">Select All</button>
            <button type="button" onClick={clearAllModels} disabled={!targetColumn || training} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-400 disabled:opacity-50">Clear All</button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {availableModels.map((model) => (
              <label key={model.key} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-300 transition hover:border-slate-600">
                <input type="checkbox" checked={selectedModels.includes(model.key)} onChange={() => handleModelToggle(model.key)} disabled={!targetColumn || training} className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-blue-500 focus:ring-blue-500" />
                {model.label}
              </label>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">{selectedModels.length} model{selectedModels.length === 1 ? '' : 's'} selected</p>
        </ConfigCard>

        <ConfigCard title="Train / Test Configuration" icon={Settings2} open={openSections.configuration} onToggle={() => toggleSection('configuration')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="test-size" className="mb-2 block text-sm text-slate-300">Test Size</label>
              <select id="test-size" value={testSize} onChange={(event) => setTestSize(event.target.value)} disabled={training} className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-3 text-sm text-slate-300 outline-none focus:border-blue-500">
                <option value="0.1">10%</option><option value="0.2">20%</option><option value="0.25">25%</option><option value="0.3">30%</option><option value="0.4">40%</option>
              </select>
            </div>
            <div>
              <label htmlFor="random-state" className="mb-2 block text-sm text-slate-300">Random State</label>
              <input id="random-state" type="number" value={randomState} onChange={(event) => setRandomState(event.target.value)} disabled={training} className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-3 text-sm text-slate-300 outline-none focus:border-blue-500" />
            </div>
          </div>
        </ConfigCard>

        <ConfigCard title="Preprocessing" icon={Settings2} open={openSections.preprocessing} onToggle={() => toggleSection('preprocessing')}>
          <div className="space-y-4">
            <Toggle label="Handle Missing Values" checked={preprocessing.impute_missing} onChange={(event) => setPreprocessing({ ...preprocessing, impute_missing: event.target.checked })} />
            <Toggle label="Encode Categorical Features" checked={preprocessing.encode_categorical} onChange={(event) => setPreprocessing({ ...preprocessing, encode_categorical: event.target.checked })} />
            <Toggle label="Scale Numerical Features" checked={preprocessing.scale_numeric} onChange={(event) => setPreprocessing({ ...preprocessing, scale_numeric: event.target.checked })} />
          </div>
        </ConfigCard>

        <ConfigCard title="Cross Validation" icon={TrendingUp} open={openSections.validation} onToggle={() => toggleSection('validation')}>
          <div className="space-y-4">
            <Toggle label="Enable Cross Validation" checked={crossValidation.enabled} onChange={(event) => setCrossValidation({ ...crossValidation, enabled: event.target.checked })} />
            {crossValidation.enabled && (
              <div>
                <label htmlFor="cv-folds" className="mb-2 block text-sm text-slate-300">CV Folds</label>
                <select id="cv-folds" value={crossValidation.folds} onChange={(event) => setCrossValidation({ ...crossValidation, folds: Number(event.target.value) })} disabled={training} className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-3 text-sm text-slate-300 outline-none focus:border-blue-500">
                  <option value="3">3</option><option value="5">5</option><option value="10">10</option>
                </select>
              </div>
            )}
          </div>
        </ConfigCard>
      </div>

      <section className="rounded-3xl border border-blue-500/25 bg-slate-900/80 p-5">
        <button type="button" onClick={handleTrain} disabled={training || !targetColumn || isDatetimeTarget} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
          {training ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <BrainCircuit className="h-4 w-4" />}
          {training ? trainingStage : 'Train Selected Models'}
        </button>
        {training && <p className="mt-3 text-center text-sm text-slate-400">{trainingStage}</p>}
      </section>

      {results.models.length > 0 && (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['Best Model', results.best_model, Trophy],
              ['Primary Metric', formatMetric(results.best_metrics?.[isClassification ? 'f1' : 'r2']), Target],
              ['Training Time', formatTime(results.best_training_time), Clock3],
              ['Test Rows', results.test_rows, Database],
            ].map(([label, value, Icon]) => (
              <div key={label} className="rounded-2xl border border-slate-800/80 bg-slate-900/80 p-4">
                <div className="flex items-center justify-between"><span className="text-sm text-slate-400">{label}</span><Icon className="h-4 w-4 text-blue-300" /></div>
                <p className="mt-4 truncate text-xl font-semibold text-white" title={String(value)}>{value}</p>
              </div>
            ))}
          </section>

          <section className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-5">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-blue-300" /><h3 className="text-lg font-semibold text-white">Model Comparison</h3></div>
              <span className="text-xs capitalize text-slate-400">{resolvedType} metrics</span>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-slate-800/80">
              <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
                <thead className="bg-slate-950/70 text-slate-300">
                  <tr>
                    <th className="cursor-pointer px-4 py-3 font-medium" onClick={() => sortBy('name')}>Model</th>
                    {metricHeaders.map(([key, label]) => <th key={key} className="cursor-pointer px-4 py-3 font-medium" onClick={() => sortBy(key)}>{label}</th>)}
                    {crossValidation.enabled && <th className="px-4 py-3 font-medium">CV Score</th>}
                    <th className="cursor-pointer px-4 py-3 font-medium" onClick={() => sortBy('training_time')}>Training Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 bg-slate-900/60 text-slate-200">
                  {sortedModels.map((model) => {
                    const isBest = model.name === results.best_model;
                    const isSelected = selectedResult?.name === model.name;
                    return (
                      <tr key={model.key} onClick={() => setSelectedResult(model)} className={`cursor-pointer transition hover:bg-slate-800/60 ${isSelected ? 'bg-blue-500/10' : ''}`}>
                        <td className="px-4 py-3 font-medium text-white">{isBest && <Trophy className="mr-2 inline h-4 w-4 text-amber-300" />}{model.name}</td>
                        {metricHeaders.map(([key]) => <td key={key} className="px-4 py-3">{formatMetric(model.metrics?.[key])}</td>)}
                        {crossValidation.enabled && <td className="px-4 py-3">{formatMetric(model.cv_score)}</td>}
                        <td className="px-4 py-3">{formatTime(model.training_time)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {selectedResult && (
            <section className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-5">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div><p className="text-xs uppercase tracking-[0.2em] text-blue-300/80">Selected Model</p><h3 className="mt-1 text-xl font-semibold text-white">{selectedResult.name}</h3></div>
                <button type="button" onClick={() => setSelectedResult(selectedResult)} className="inline-flex items-center gap-2 rounded-xl border border-blue-400/40 px-4 py-2 text-sm text-blue-200 transition hover:bg-blue-500/10"><Check className="h-4 w-4" />Use This Model</button>
              </div>
              <div className="grid gap-6 xl:grid-cols-2">
                <div>
                  <h4 className="mb-3 text-sm font-medium text-slate-300">Performance Metrics</h4>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {metricHeaders.map(([key, label]) => <div key={key} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-lg font-semibold text-white">{formatMetric(selectedResult.metrics?.[key])}</p></div>)}
                  </div>
                  <p className="mt-3 text-sm text-slate-400">Model type: <span className="capitalize text-slate-200">{selectedResult.model_type}</span> · Training time: <span className="text-slate-200">{formatTime(selectedResult.training_time)}</span></p>
                </div>
                <div>
                  <h4 className="mb-3 text-sm font-medium text-slate-300">Top Feature Importance</h4>
                  {selectedResult.feature_importance?.length ? <div className="space-y-3">{selectedResult.feature_importance.map((item) => <div key={item.name}><div className="mb-1 flex justify-between gap-3 text-xs text-slate-300"><span className="truncate" title={item.name}>{item.name}</span><span>{item.percentage}%</span></div><div className="h-2 rounded-full bg-slate-800"><div className="h-2 rounded-full bg-gradient-to-r from-blue-500 to-violet-500" style={{ width: `${item.percentage}%` }} /></div></div>)}</div> : <p className="text-sm text-slate-400">Feature importance is available for tree-based models and linear coefficients.</p>}
                </div>
              </div>
            </section>
          )}

          <section className="rounded-3xl border border-blue-500/25 bg-slate-900/80 p-5">
            <div className="mb-5 flex items-center gap-3">
              <Target className="h-5 w-5 text-blue-300" />
              <div>
                <h3 className="text-lg font-semibold text-white">Make a Prediction</h3>
                <p className="mt-1 text-sm text-slate-400">Enter a new record using the trained model.</p>
              </div>
            </div>

            {predictionError && <div className="mb-5 rounded-xl border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-200">{predictionError}</div>}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(results.feature_schema || []).map((field) => (
                <div key={field.name}>
                  <label htmlFor={`predict-${field.name}`} className="mb-2 block truncate text-sm text-slate-300" title={field.name}>{field.name}</label>
                  {field.options?.length > 0 ? (
                    <select
                      id={`predict-${field.name}`}
                      value={predictionValues[field.name] ?? ''}
                      onChange={(event) => setPredictionValues({ ...predictionValues, [field.name]: event.target.value })}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-3 text-sm text-slate-300 outline-none focus:border-blue-500"
                    >
                      <option value="">Select {field.name}</option>
                      {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  ) : (
                    <input
                      id={`predict-${field.name}`}
                      type={field.type === 'number' ? 'number' : 'text'}
                      step={field.type === 'number' ? 'any' : undefined}
                      value={predictionValues[field.name] ?? ''}
                      onChange={(event) => setPredictionValues({ ...predictionValues, [field.name]: event.target.value })}
                      placeholder={`Enter ${field.name}`}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-3 text-sm text-slate-300 outline-none focus:border-blue-500"
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={handlePrediction} disabled={predictionLoading} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50">
                {predictionLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <BrainCircuit className="h-4 w-4" />}
                {predictionLoading ? 'Generating prediction...' : 'Predict'}
              </button>
              <button type="button" onClick={resetPrediction} disabled={predictionLoading} className="rounded-xl border border-slate-700 px-5 py-3 text-sm text-slate-200 transition hover:border-slate-500 disabled:opacity-50">Reset</button>
            </div>

            {predictionResult && resolvedType === 'classification' && (() => {
              const probability = Number(predictionResult.probability || 0);
              const risk = probability >= 0.7 ? 'High Risk' : probability >= 0.5 ? 'Medium Risk' : 'Low Risk';
              return (
                <div className="mt-6 rounded-2xl border border-blue-400/30 bg-blue-500/5 p-5">
                  <p className="text-xs uppercase tracking-[0.2em] text-blue-300/80">Prediction</p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3"><h4 className="text-2xl font-semibold text-white">{predictionResult.prediction}</h4><span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-sm text-amber-200">{risk}</span></div>
                  <div className="mt-5"><div className="mb-2 flex justify-between text-sm text-slate-300"><span>Probability</span><span>{(probability * 100).toFixed(1)}%</span></div><div className="h-3 rounded-full bg-slate-800"><div className="h-3 rounded-full bg-gradient-to-r from-blue-500 to-amber-400" style={{ width: `${probability * 100}%` }} /></div></div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">{Object.entries(predictionResult.probabilities || {}).map(([label, value]) => <div key={label} className="rounded-xl border border-slate-700 bg-slate-950/40 p-3 text-sm text-slate-300"><span>{label}</span><strong className="float-right text-white">{(Number(value) * 100).toFixed(1)}%</strong></div>)}</div>
                </div>
              );
            })()}

            {predictionResult && resolvedType === 'regression' && (
              <div className="mt-6 rounded-2xl border border-blue-400/30 bg-blue-500/5 p-5"><p className="text-xs uppercase tracking-[0.2em] text-blue-300/80">Prediction</p><p className="mt-2 text-4xl font-semibold text-white">{Number(predictionResult.prediction).toLocaleString()}</p></div>
            )}

            {predictionResult && (
              <section className="mt-6 rounded-2xl border border-violet-400/25 bg-violet-500/5 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3"><Lightbulb className="h-5 w-5 text-amber-300" /><div><h4 className="text-lg font-semibold text-white">Why This Prediction?</h4><p className="mt-1 text-xs text-slate-400">Local explanation for the current input.</p></div></div>
                  {explanation && <span className="rounded-full border border-violet-400/30 bg-violet-400/10 px-3 py-1 text-xs text-violet-200">Explanation Method: {explanation.explanation_method}</span>}
                </div>
                {explanationLoading && <div className="mt-5 flex items-center gap-3 text-sm text-slate-300"><LoaderCircle className="h-4 w-4 animate-spin" /> Calculating explanation...</div>}
                {explanationError && <p className="mt-5 text-sm text-amber-200">{explanationError}</p>}
                {explanation && (
                  <div className="mt-5 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                    <div>
                      <p className="mb-3 text-sm leading-6 text-slate-200">{explanation.summary}</p>
                      <div className="grid gap-5 md:grid-cols-2">
                        {[
                          ['Factors increasing prediction', explanation.increasing_factors, 'text-rose-300', 'bg-rose-400'],
                          ['Factors decreasing prediction', explanation.decreasing_factors, 'text-emerald-300', 'bg-emerald-400'],
                        ].map(([title, factors, textColor, barColor]) => {
                          const maxImpact = Math.max(...(explanation.factors || []).map((item) => Math.abs(Number(item.impact))), 1);
                          return <div key={title}><h5 className={`mb-3 text-sm font-medium ${textColor}`}>{title}</h5><div className="space-y-3">{factors.length ? factors.map((item) => <div key={`${title}-${item.feature}`}><div className="mb-1 flex justify-between gap-3 text-xs text-slate-300"><span className="truncate" title={item.feature}>{item.feature}</span><span>{Math.abs(Number(item.impact)).toFixed(3)}</span></div><div className="h-2 rounded-full bg-slate-800"><div className={`h-2 rounded-full ${barColor}`} style={{ width: `${(Math.abs(Number(item.impact)) / maxImpact) * 100}%` }} /></div></div>) : <p className="text-xs text-slate-500">No factors in this direction.</p>}</div></div>;
                        })}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-700/70 bg-slate-950/40 p-4"><h5 className="mb-3 text-sm font-medium text-slate-300">Current Values</h5><div className="space-y-2">{(results.feature_schema || []).map((field) => <div key={field.name} className="flex justify-between gap-3 text-xs"><span className="truncate text-slate-500" title={field.name}>{field.name}</span><span className="truncate text-right text-slate-200" title={String(predictionValues[field.name] ?? 'Missing')}>{predictionValues[field.name] === '' || predictionValues[field.name] === undefined ? 'Missing' : String(predictionValues[field.name])}</span></div>)}</div><div className="mt-4 border-t border-slate-800 pt-3 text-xs text-slate-400">Model: <span className="text-slate-200">{explanation.model}</span></div></div>
                  </div>
                )}
              </section>
            )}
          </section>

          {predictionHistory.length > 0 && (
            <section className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-5">
              <div className="mb-4 flex items-center justify-between gap-3"><h3 className="text-lg font-semibold text-white">Recent Predictions</h3><button type="button" onClick={() => setPredictionHistory([])} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 transition hover:border-red-400/60 hover:text-red-200">Clear History</button></div>
              <div className="overflow-x-auto rounded-2xl border border-slate-800/80"><table className="min-w-full text-left text-sm"><thead className="bg-slate-950/70 text-slate-300"><tr><th className="px-4 py-3">Time</th><th className="px-4 py-3">Prediction</th><th className="px-4 py-3">Confidence</th><th className="px-4 py-3">Model</th></tr></thead><tbody className="divide-y divide-slate-800 text-slate-200">{predictionHistory.map((item, index) => <tr key={`${item.time}-${index}`}><td className="px-4 py-3">{item.time}</td><td className="px-4 py-3 font-medium text-white">{item.prediction}</td><td className="px-4 py-3">{item.probability === undefined || item.probability === null ? '—' : `${(Number(item.probability) * 100).toFixed(1)}%`}</td><td className="px-4 py-3 text-slate-400">{item.model || '—'}</td></tr>)}</tbody></table></div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
