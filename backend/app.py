import json
from io import BytesIO
import os
import time
from datetime import datetime

import numpy as np
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
from dotenv import load_dotenv
from flask import send_file
try:
    import shap
except ImportError:
    shap = None
from flask import Flask, jsonify, request
from flask_cors import CORS
try:
    from groq import Groq
except ImportError:  # pragma: no cover
    Groq = None
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import (
    GradientBoostingClassifier,
    GradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.impute import SimpleImputer
from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import KFold, StratifiedKFold, cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})
load_dotenv()
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
current_dataset = None
original_dataframe = None
cleaned_dataframe = None
current_dataset_filename = ''
current_dataset_file_size = None
current_dataset_uploaded_at = None
selected_target_column = None
trained_model_state = None


def format_memory_usage(size_in_bytes):
    units = ['B', 'KB', 'MB', 'GB']
    size = float(size_in_bytes)
    for unit in units:
        if size < 1024 or unit == units[-1]:
            if unit == 'B':
                return f'{int(size)} {unit}'
            return f'{size:.2f} {unit}'
        size /= 1024
    return f'{size:.2f} GB'


def build_data_quality_issues(df):
    """Build precise, column-level data quality issues from the real dataframe."""
    issues = []
    row_count = len(df)

    for column in df.columns:
        series = df[column]
        missing_count = int(series.isna().sum())
        if not missing_count:
            continue

        column_name = str(column)
        if pd.api.types.is_numeric_dtype(series) and not pd.api.types.is_bool_dtype(series):
            non_null = pd.to_numeric(series, errors='coerce').dropna()
            if not non_null.empty:
                fill_value = float(non_null.median())
                recommendation = f"Fill {column_name} missing values with the median ({fill_value:,.2f})."
            else:
                recommendation = f"Review {column_name} and choose an appropriate numeric imputation value."
        else:
            mode = series.dropna().mode()
            if not mode.empty:
                recommendation = f"Fill {column_name} missing values with the most frequent value ('{str(mode.iloc[0])}')."
            else:
                recommendation = f"Review {column_name} and choose an appropriate categorical imputation value."

        issues.append({
            'issue_type': 'Missing Values',
            'column': column_name,
            'count': missing_count,
            'percentage': round((missing_count / row_count) * 100, 2) if row_count else 0,
            'recommendation': recommendation,
        })

    duplicate_count = int(df.duplicated().sum())
    if duplicate_count:
        issues.append({
            'issue_type': 'Duplicates',
            'column': 'All Columns',
            'count': duplicate_count,
            'percentage': round((duplicate_count / row_count) * 100, 2) if row_count else 0,
            'recommendation': f'Remove {duplicate_count:,} duplicate row(s) before training.',
        })

    for column in df.columns:
        series = df[column].dropna()
        if series.empty or pd.api.types.is_numeric_dtype(df[column]) or is_datetime_series(df[column]):
            continue
        numeric_values = pd.to_numeric(series.astype(str).str.strip(), errors='coerce')
        numeric_ratio = float(numeric_values.notna().mean())
        if 0 < numeric_ratio < 1:
            issue_count = int(numeric_values.isna().sum())
            issues.append({
                'issue_type': 'Data Type Issues',
                'column': str(column),
                'count': issue_count,
                'percentage': round((issue_count / row_count) * 100, 2) if row_count else 0,
                'recommendation': f'Review non-numeric values in {column} before converting the column to numeric.',
            })
    return issues

def parse_numeric_value(value):
    if pd.isna(value):
        return np.nan
    if isinstance(value, (int, float, np.number)):
        return float(value)
    text = str(value).strip().replace(',', '')
    if not text:
        return np.nan
    multiplier = 1
    suffix = text[-1:].lower()
    if suffix in {'k', 'm'}:
        multiplier = 1000 if suffix == 'k' else 1000000
        text = text[:-1].strip()
    try:
        return float(text) * multiplier
    except (TypeError, ValueError):
        return np.nan


def detect_cleaning_issues(df):
    """Detect actionable data-quality problems without treating normal category repetition as an issue."""
    issues = build_data_quality_issues(df)
    category_issue_count = 0
    invalid_values = 0
    numeric_text_columns = []

    for column in df.columns:
        series = df[column]
        non_null = series.dropna()
        if non_null.empty:
            continue

        # Categorical consistency: only count actual casing/whitespace variants
        # such as "Mumbai", "mumbai", and " Mumbai ", not normal repeated values.
        if pd.api.types.is_object_dtype(series) or pd.api.types.is_string_dtype(series):
            values = non_null.astype(str)
            stripped = values.str.strip()
            normalized = stripped.str.casefold()

            variant_count = 0
            for normalized_value, group in values.groupby(normalized):
                distinct_originals = group.str.strip().unique()
                if len(distinct_originals) > 1:
                    variant_count += len(group)

            category_issue_count += variant_count

            parsed = non_null.map(parse_numeric_value)
            if parsed.notna().mean() >= 0.8 and not is_datetime_series(series):
                numeric_text_columns.append(str(column))
                invalid_values += int(parsed.isna().sum())

        if pd.api.types.is_numeric_dtype(series) or str(column) in numeric_text_columns:
            numeric_values = (
                pd.to_numeric(series, errors='coerce')
                if pd.api.types.is_numeric_dtype(series)
                else non_null.map(parse_numeric_value)
            )

            name = str(column).lower()
            invalid_mask = pd.Series(False, index=series.index)

            if 'age' in name:
                invalid_mask = (numeric_values < 0) | (numeric_values > 120)
            elif any(token in name for token in ('spend', 'price', 'income', 'salary', 'amount', 'cost')):
                invalid_mask = numeric_values < 0
            elif any(token in name for token in ('satisfaction', 'score', 'rating')):
                invalid_mask = (numeric_values < 0) | (numeric_values > 10)

            invalid_values += int(invalid_mask.fillna(False).sum())

            # Only report meaningful outlier groups.
            valid_numeric = numeric_values.dropna()
            if len(valid_numeric) >= 20:
                q1, q3 = valid_numeric.quantile([0.25, 0.75])
                iqr = q3 - q1
                if iqr > 0:
                    lower = q1 - 1.5 * iqr
                    upper = q3 + 1.5 * iqr
                    outlier_count = int(
                        ((valid_numeric < lower) | (valid_numeric > upper)).sum()
                    )
                    outlier_ratio = outlier_count / len(valid_numeric)
                    if outlier_count >= 3 and outlier_ratio <= 0.10:
                        issues.append({
                            'issue_type': 'Outliers',
                            'column': str(column),
                            'count': outlier_count,
                            'percentage': round(outlier_ratio * 100, 2),
                            'recommendation': 'Review extreme values before training; do not remove them automatically.',
                        })

    if category_issue_count:
        issues.append({
            'issue_type': 'Category Issues',
            'column': 'Categorical Columns',
            'count': category_issue_count,
            'percentage': round(
                category_issue_count / max(len(df), 1) * 100, 2
            ),
            'recommendation': 'Standardize casing and whitespace in categorical values.',
        })

    if numeric_text_columns:
        issues.append({
            'issue_type': 'Numeric Type Issues',
            'column': ', '.join(numeric_text_columns),
            'count': len(numeric_text_columns),
            'percentage': round(
                len(numeric_text_columns) / max(len(df.columns), 1) * 100, 2
            ),
            'recommendation': 'Convert numeric text columns to numeric values.',
        })

    if invalid_values:
        issues.append({
            'issue_type': 'Invalid Values',
            'column': 'Numeric Columns',
            'count': invalid_values,
            'percentage': round(
                invalid_values / max(len(df), 1) * 100, 2
            ),
            'recommendation': 'Replace invalid values with NaN and apply the selected cleaning strategy.',
        })

    return issues


def clean_dataframe(source_df, options):
    df = source_df.copy()
    changes = {'duplicates_removed': 0, 'missing_fixed': 0, 'type_conversions': 0, 'categories_standardized': 0, 'invalid_values_fixed': 0}
    if options.get('remove_duplicates'):
        before = len(df)
        df = df.drop_duplicates().reset_index(drop=True)
        changes['duplicates_removed'] = before - len(df)

    numeric_columns = []
    for column in df.columns:
        series = df[column]
        non_null = series.dropna()
        if pd.api.types.is_numeric_dtype(series):
            numeric_columns.append(column)
        elif options.get('convert_numeric_columns') and len(non_null):
            parsed = non_null.map(parse_numeric_value)
            if parsed.notna().mean() >= 0.8 and not is_datetime_series(series):
                converted = series.map(parse_numeric_value)
                changed = int((series.notna() & converted.notna()).sum())
                df[column] = converted
                numeric_columns.append(column)
                changes['type_conversions'] += changed

    if options.get('standardize_categories'):
        for column in df.columns:
            if column in numeric_columns or is_datetime_series(df[column]):
                continue
            values = df[column]
            canonical = {}
            for value in values.dropna().astype(str):
                key = value.strip().casefold()
                canonical.setdefault(key, value.strip())
            standardized = values.map(lambda value: canonical.get(str(value).strip().casefold(), str(value).strip()) if pd.notna(value) else value)
            changes['categories_standardized'] += int((values.astype(str) != standardized.astype(str)).sum())
            df[column] = standardized

    invalid_mask = pd.DataFrame(False, index=df.index, columns=df.columns)
    for column in numeric_columns:
        values = pd.to_numeric(df[column], errors='coerce')
        name = str(column).lower()
        if 'age' in name:
            invalid_mask[column] = values < 0
        elif any(token in name for token in ('spend', 'price', 'income', 'salary', 'amount', 'cost')):
            invalid_mask[column] = values < 0
        elif any(token in name for token in ('satisfaction', 'score', 'rating')):
            invalid_mask[column] = (values < 0) | (values > 10)
        df[column] = values.mask(invalid_mask[column])

    changes['invalid_values_fixed'] = int(invalid_mask.sum().sum())
    if options.get('handle_invalid_values') == 'remove':
        invalid_rows = invalid_mask.any(axis=1)
        df = df.loc[~invalid_rows].reset_index(drop=True)
    elif options.get('handle_invalid_values') not in {'median', 'nan'}:
        raise ValueError('Unsupported invalid-value cleaning option.')
    if options.get('fill_numeric', True) and options.get('missing_numeric') in {'median', 'mean'}:
        for column in numeric_columns:
            missing = int(df[column].isna().sum())
            if missing:
                fill_value = df[column].median() if options['missing_numeric'] == 'median' else df[column].mean()
                if pd.notna(fill_value):
                    df[column] = df[column].fillna(fill_value)
                    changes['missing_fixed'] += missing
    if options.get('fill_categorical', True) and options.get('missing_categorical') == 'mode':
        for column in df.columns:
            if column in numeric_columns:
                continue
            missing = int(df[column].isna().sum())
            mode = df[column].mode(dropna=True)
            if missing and not mode.empty:
                df[column] = df[column].fillna(mode.iloc[0])
                changes['missing_fixed'] += missing
    return df, changes


def detect_datetime_columns(df):
    datetime_columns = []
    for column in df.columns:
        series = df[column].dropna()
        if series.empty:
            continue

        if pd.api.types.is_datetime64_any_dtype(series):
            datetime_columns.append(str(column))
            continue

        if not pd.api.types.is_object_dtype(series) and not pd.api.types.is_string_dtype(series):
            continue

        text_values = series.astype(str).str.strip()
        text_values = text_values[text_values != '']

        if text_values.empty:
            continue

        parsed = pd.to_datetime(text_values, errors='coerce')
        valid_ratio = parsed.notna().mean()

        if valid_ratio >= 0.8:
            datetime_columns.append(str(column))

    return datetime_columns


def build_ai_dataset_summary(df):
    df = df.copy()
    rows = int(len(df))
    columns = [str(col) for col in df.columns]
    data_types = {str(col): str(df[col].dtype) for col in columns}
    missing_values = {str(col): int(df[col].isna().sum()) for col in columns}
    missing_percentages = {
        str(col): round(float((df[col].isna().mean()) * 100), 2) if rows else 0.0
        for col in columns
    }
    duplicate_count = int(df.duplicated().sum())
    unique_counts = {str(col): int(df[col].nunique(dropna=True)) for col in columns}
    categorical_preview = {}
    numerical_stats = {}

    for col in columns:
        series = df[col]
        if pd.api.types.is_numeric_dtype(series):
            numeric_series = pd.to_numeric(series, errors='coerce').dropna()
            if not numeric_series.empty:
                numerical_stats[col] = {
                    'min': float(numeric_series.min()),
                    'max': float(numeric_series.max()),
                    'mean': float(numeric_series.mean()),
                    'median': float(numeric_series.median()),
                    'std': float(numeric_series.std()) if numeric_series.count() > 1 else 0.0,
                }
            continue
        non_null = series.dropna()
        if non_null.empty:
            categorical_preview[col] = []
            continue
        categorical_preview[col] = [
            {'value': str(value), 'count': int(count)}
            for value, count in non_null.astype(str).value_counts().head(8).items()
        ]

    suspicious_values = []
    for col in columns:
        series = df[col]
        if pd.api.types.is_numeric_dtype(series):
            numeric_series = pd.to_numeric(series, errors='coerce')
            negatives = int((numeric_series < 0).sum())
            if negatives:
                suspicious_values.append({
                    'column': col,
                    'issue': 'Negative values detected',
                    'count': negatives,
                })
            if any(token in str(col).lower() for token in ('score', 'rating', 'satisfaction', 'income', 'cost', 'price')):
                out_of_range = int(((numeric_series < 0) | (numeric_series > 10)).sum()) if 'score' in str(col).lower() or 'rating' in str(col).lower() or 'satisfaction' in str(col).lower() else int((numeric_series < 0).sum())
                if out_of_range:
                    suspicious_values.append({
                        'column': col,
                        'issue': 'Values outside expected range',
                        'count': out_of_range,
                    })
        elif not series.empty:
            normalized = series.astype(str).str.strip().str.lower()
            if normalized.nunique(dropna=True) > 0:
                whitespace_variant = int((normalized != series.astype(str).str.strip()).sum())
                if whitespace_variant:
                    suspicious_values.append({
                        'column': col,
                        'issue': 'Whitespace or casing inconsistencies',
                        'count': whitespace_variant,
                    })

    quality_issues = detect_cleaning_issues(df)
    issue_summary = []
    if missing_values and any(value > 0 for value in missing_values.values()):
        issue_summary.append('missing_values')
    if duplicate_count:
        issue_summary.append('duplicates')
    if any(issue['issue_type'] in {'Data Type Issues', 'Numeric Type Issues'} for issue in quality_issues):
        issue_summary.append('type_mismatch')
    if any(issue['issue_type'] == 'Category Issues' for issue in quality_issues):
        issue_summary.append('category_inconsistencies')

    return {
        'rows': rows,
        'columns': columns,
        'column_count': len(columns),
        'data_types': data_types,
        'missing_value_counts': missing_values,
        'missing_value_percentages': missing_percentages,
        'duplicate_count': duplicate_count,
        'unique_counts': unique_counts,
        'limited_categorical_values': categorical_preview,
        'numerical_statistics': numerical_stats,
        'suspicious_values': suspicious_values,
        'detected_data_quality_issues': issue_summary,
        'quality_issues': quality_issues,
    }


def build_fallback_ai_advice(summary):
    """Generate deterministic, dataset-specific recommendations from Pandas."""
    if not isinstance(summary, dict):
        return {'success': True, 'overall_status': 'Needs Cleaning', 'quality_score': 0,
                'ml_readiness': 'Needs Cleaning', 'summary': 'Unable to inspect the dataset.',
                'issues': [], 'recommended_actions': []}

    raw_quality_issues = summary.get('quality_issues', [])
    type_map = {'Missing Values': 'missing_values', 'Duplicates': 'duplicate_rows',
                'Data Type Issues': 'data_type_issues', 'Numeric Type Issues': 'numeric_type_issues',
                'Category Issues': 'category_issues', 'Invalid Values': 'invalid_values',
                'Outliers': 'outliers'}
    severity_map = {'Missing Values': 'medium', 'Duplicates': 'high', 'Data Type Issues': 'high',
                    'Numeric Type Issues': 'high', 'Category Issues': 'medium',
                    'Invalid Values': 'high', 'Outliers': 'medium'}

    issues = []
    seen = set()
    for item in raw_quality_issues:
        if not isinstance(item, dict):
            continue
        issue_type = str(item.get('issue_type', 'Data Quality Issue'))
        issue = {
            'type': type_map.get(issue_type, 'data_quality'),
            'severity': severity_map.get(issue_type, 'medium'),
            'column': str(item.get('column', 'dataset')),
            'count': int(item.get('count', 0) or 0),
            'recommendation': str(item.get('recommendation', 'Review this issue before model training.')),
        }
        key = (issue['type'], issue['column'])
        if key not in seen:
            seen.add(key)
            issues.append(issue)

    missing_total = sum(int(v or 0) for v in summary.get('missing_value_counts', {}).values())
    duplicate_count = int(summary.get('duplicate_count', 0) or 0)
    rows = int(summary.get('rows', 0) or 0)
    column_count = int(summary.get('column_count', 0) or 0)
    total_cells = max(rows * column_count, 1)
    missing_ratio = missing_total / total_cells
    duplicate_ratio = duplicate_count / max(rows, 1)

    # Score based on data affected, not simply number of affected columns.
    penalty = min(45.0, missing_ratio * 100 * 20)
    penalty += min(20.0, duplicate_ratio * 100 * 2)
    severe_count = sum(1 for i in issues if i['type'] in {'invalid_values', 'data_type_issues', 'numeric_type_issues'})
    penalty += min(25.0, severe_count * 8)
    quality_score = int(max(0, min(100, round(100 - penalty))))

    actions = []
    action_types = {i['type'] for i in issues}
    if 'duplicate_rows' in action_types:
        actions.append({'id': 'remove_duplicates', 'label': 'Remove duplicate rows', 'enabled': True})

    if 'missing_values' in action_types:
        data_types = summary.get('data_types', {})
        has_numeric = False
        has_categorical = False
        for issue in issues:
            if issue['type'] != 'missing_values':
                continue
            dtype = str(data_types.get(issue['column'], '')).lower()
            if any(x in dtype for x in ('int', 'float')):
                has_numeric = True
            else:
                has_categorical = True
        if has_numeric:
            actions.append({'id': 'fill_numeric', 'label': 'Fill missing numerical values using median', 'enabled': True})
        if has_categorical:
            actions.append({'id': 'fill_categorical', 'label': 'Fill missing categorical values using mode', 'enabled': True})

    if 'category_issues' in action_types:
        actions.append({'id': 'standardize_categories', 'label': 'Standardize categorical values', 'enabled': True})
    if 'numeric_type_issues' in action_types or 'data_type_issues' in action_types:
        actions.append({'id': 'convert_numeric_text', 'label': 'Convert numeric text values', 'enabled': True})
    if 'invalid_values' in action_types or 'outliers' in action_types:
        actions.append({'id': 'handle_suspicious_values', 'label': 'Review suspicious and outlier values', 'enabled': True})

    if not issues:
        return {'success': True, 'overall_status': 'Good', 'quality_score': 100, 'ml_readiness': 'Ready',
                'summary': f'The dataset contains {rows:,} rows and {column_count} columns. No major data-quality issues were detected.',
                'issues': [], 'recommended_actions': []}

    missing_columns = [i['column'] for i in issues if i['type'] == 'missing_values']
    parts = [f'The dataset contains {rows:,} rows and {column_count} columns.']
    if missing_total:
        parts.append(f'{missing_total:,} missing cell(s) were detected across {len(missing_columns)} column(s).')
    if duplicate_count:
        parts.append(f'{duplicate_count:,} duplicate row(s) were detected.')
    other_count = len(issues) - len(missing_columns) - (1 if duplicate_count else 0)
    if other_count > 0:
        parts.append(f'{other_count} additional data-quality issue(s) require review.')

    return {'success': True, 'overall_status': 'Needs Cleaning', 'quality_score': quality_score,
            'ml_readiness': 'Needs Cleaning', 'summary': ' '.join(parts),
            'issues': issues, 'recommended_actions': actions}

def normalize_ai_payload(payload, actual_summary=None):
    """Keep Pandas as the factual source of truth and use AI for explanation."""
    actual_summary = actual_summary or {}
    fallback = build_fallback_ai_advice(actual_summary)
    if not isinstance(payload, dict):
        return fallback

    ai_items = payload.get('issues', []) if isinstance(payload.get('issues', []), list) else []
    ai_map = {}
    for item in ai_items:
        if isinstance(item, dict):
            ai_map[(str(item.get('type', '')), str(item.get('column', '')))] = item

    normalized_issues = []
    for verified in fallback.get('issues', []):
        merged = dict(verified)
        ai_item = ai_map.get((verified['type'], verified['column']))
        if ai_item and verified['type'] != 'missing_values':
            text = str(ai_item.get('recommendation', '')).strip()
            if text and 'review and fill missing' not in text.lower():
                merged['recommendation'] = text
        normalized_issues.append(merged)

    return {'success': True,
            'overall_status': fallback['overall_status'],
            'quality_score': fallback['quality_score'],
            'ml_readiness': fallback['ml_readiness'],
            'summary': str(payload.get('summary') or fallback['summary']),
            'issues': normalized_issues,
            'recommended_actions': fallback['recommended_actions']}

def get_groq_model_name():
    model_name = os.getenv('GROQ_MODEL', '').strip() or 'openai/gpt-oss-120b'
    return model_name



def sanitize_groq_json(raw_text):
    if raw_text is None:
        return ''
    text = str(raw_text).strip()
    if not text:
        return ''
    text = text.replace('```json', '```').replace('```', '').strip()
    start = text.find('{')
    end = text.rfind('}')
    if start != -1 and end != -1 and end > start:
        text = text[start:end + 1]
    return text


def extract_groq_response_content(raw_response):
    if raw_response is None:
        return ''
    if isinstance(raw_response, str):
        return sanitize_groq_json(raw_response)
    if isinstance(raw_response, dict):
        if 'content' in raw_response:
            return sanitize_groq_json(raw_response.get('content'))
        if 'message' in raw_response:
            message = raw_response.get('message')
            if isinstance(message, dict) and 'content' in message:
                return sanitize_groq_json(message.get('content'))
    choices = getattr(raw_response, 'choices', None)
    if isinstance(choices, list) and choices:
        first_choice = choices[0]
        message = getattr(first_choice, 'message', None)
        if message is not None:
            content = getattr(message, 'content', '')
            return sanitize_groq_json(content)
    if hasattr(raw_response, 'content'):
        return sanitize_groq_json(getattr(raw_response, 'content'))
    return sanitize_groq_json(str(raw_response))


def call_groq_for_dataset_advice(summary):
    if Groq is None:
        raise RuntimeError('Groq SDK is not installed.')

    api_key = os.getenv('GROQ_API_KEY', '').strip()
    if not api_key:
        raise RuntimeError('GROQ_API_KEY is not configured')

    client = Groq(api_key=api_key)

    system_prompt = (
        'You are an expert data quality and machine learning assistant. '
        'Analyze ONLY the supplied dataset metadata. Pandas is the factual source of truth. '
        'Do not invent, remove, merge, or change detected issues. '
        'For missing numeric columns, recommend median imputation. '
        'For missing categorical/text columns, recommend mode imputation. '
        'For duplicates, recommend removing duplicate rows. '
        'For numeric text, recommend conversion only after validation. '
        'For category inconsistencies, recommend standardizing casing and whitespace. '
        'For invalid values, recommend reviewing or replacing invalid values. '
        'Keep recommendations concise and specific to the column. '
        'Return JSON only with summary, issues, and recommended_actions. '
        'Each issue must contain type, severity, column, count, recommendation. '
        'Each action must contain id, label, enabled. '
        'Use only action ids: remove_duplicates, fill_numeric, fill_categorical, standardize_categories, convert_numeric_text, handle_suspicious_values.'
    )

    response = client.chat.completions.create(
        model=get_groq_model_name(),
        messages=[
            {'role': 'system', 'content': system_prompt},
            {
                'role': 'user',
                'content': json.dumps(summary, ensure_ascii=False, default=str),
            },
        ],
        temperature=0.2,
        max_tokens=1800,
        response_format={'type': 'json_object'},
    )

    return extract_groq_response_content(response)


def build_dataset_profile(df, filename):
    df = df.copy()
    quality_issues = detect_cleaning_issues(df)
    column_names = [str(col) for col in df.columns]
    numerical_columns = [
        str(col)
        for col in df.columns
        if pd.api.types.is_numeric_dtype(df[col]) and not pd.api.types.is_bool_dtype(df[col])
    ]

    datetime_columns = detect_datetime_columns(df)
    categorical_columns = [
        str(col)
        for col in df.columns
        if str(col) not in numerical_columns and str(col) not in datetime_columns
        and (pd.api.types.is_object_dtype(df[col]) or pd.api.types.is_string_dtype(df[col]) or pd.api.types.is_categorical_dtype(df[col]))
    ]

    missing_values = {str(col): int(df[col].isna().sum()) for col in column_names}
    missing_percentage = {
        str(col): round(float((df[col].isna().mean()) * 100), 2) if len(df) else 0.0
        for col in column_names
    }

    duplicate_rows = int(df.duplicated().sum())
    unique_values = {str(col): int(df[col].nunique(dropna=True)) for col in column_names}
    data_types = {str(col): str(df[col].dtype) for col in column_names}

    statistics = {'numerical': {}, 'categorical': {}}

    for col in numerical_columns:
        series = df[col].dropna()
        if series.empty:
            statistics['numerical'][col] = {
                'count': 0,
                'mean': 0,
                'median': 0,
                'min': 0,
                'max': 0,
                'std': 0,
            }
            continue

        statistics['numerical'][col] = {
            'count': int(series.count()),
            'mean': round(float(series.mean()), 4),
            'median': round(float(series.median()), 4),
            'min': round(float(series.min()), 4),
            'max': round(float(series.max()), 4),
            'std': round(float(series.std()), 4) if series.count() > 1 else 0,
        }

    for col in categorical_columns:
        series = df[col].dropna()
        if series.empty:
            statistics['categorical'][col] = {
                'count': 0,
                'unique_values': 0,
                'most_frequent_value': None,
            }
            continue

        value_counts = series.value_counts(dropna=True)
        statistics['categorical'][col] = {
            'count': int(series.count()),
            'unique_values': int(series.nunique(dropna=True)),
            'most_frequent_value': str(value_counts.idxmax()) if not value_counts.empty else None,
        }

    total_missing = sum(missing_values.values())
    total_cells = len(df) * len(df.columns)
    missing_ratio = (total_missing / total_cells * 100) if total_cells else 0
    duplicate_penalty = duplicate_rows / len(df) * 100 if len(df) else 0
    invalid_unknown = 0

    quality_score = 100
    quality_score -= min(35, missing_ratio * 0.8)
    quality_score -= min(30, duplicate_penalty * 1.5)
    quality_score -= min(20, invalid_unknown)
    quality_score = max(0, round(quality_score, 0))

    return {
        'filename': filename,
        'rows': int(len(df)),
        'columns': int(len(df.columns)),
        'column_names': column_names,
        'numerical_columns': numerical_columns,
        'categorical_columns': categorical_columns,
        'datetime_columns': datetime_columns,
        'missing_values': missing_values,
        'missing_percentage': missing_percentage,
        'duplicate_rows': duplicate_rows,
        'data_types': data_types,
        'memory_usage': format_memory_usage(df.memory_usage(deep=True).sum()),
        'statistics': statistics,
        'unique_values': unique_values,
        'quality_score': quality_score,
        'quality_issues': quality_issues,
        'missing_columns_count': sum(1 for value in missing_values.values() if value > 0),
        'data_type_issues_count': sum(1 for issue in quality_issues if issue['issue_type'] in {'Data Type Issues', 'Numeric Type Issues'}),
        'invalid_values_count': sum(issue['count'] for issue in quality_issues if issue['issue_type'] == 'Invalid Values'),
        'category_issues_count': sum(issue['count'] for issue in quality_issues if issue['issue_type'] == 'Category Issues'),
    }


def build_dashboard_payload():
    if current_dataset is None:
        return {'uploaded': False}

    profile = build_dataset_profile(current_dataset, current_dataset_filename)
    numerical_columns = profile['numerical_columns']
    categorical_columns = profile['categorical_columns']
    numerical_distributions = {}
    for column in numerical_columns:
        values = pd.to_numeric(current_dataset[column], errors='coerce').dropna().to_numpy(dtype=float)
        if not len(values):
            numerical_distributions[column] = []
            continue
        minimum, maximum = float(values.min()), float(values.max())
        if minimum == maximum:
            numerical_distributions[column] = [{'range': format_histogram_value(minimum), 'count': int(len(values))}]
            continue
        counts, edges = np.histogram(values, bins=min(10, max(2, int(current_dataset[column].nunique(dropna=True)))))
        numerical_distributions[column] = [
            {'range': f'{format_histogram_value(edges[index])}-{format_histogram_value(edges[index + 1])}', 'count': int(counts[index])}
            for index in range(len(counts))
        ]

    categorical_frequencies = {
        column: [{'name': str(name), 'count': int(count)} for name, count in current_dataset[column].dropna().astype(str).value_counts().head(20).items()]
        for column in categorical_columns
    }
    target_type = infer_problem_type(current_dataset[selected_target_column]) if selected_target_column in current_dataset.columns else None
    if target_type == 'datetime':
        target_type = None
    insights = [f"Dataset contains {len(current_dataset):,} rows and {len(current_dataset.columns):,} columns."]
    missing_column_count = sum(1 for value in profile['missing_values'].values() if value > 0)
    if missing_column_count:
        insights.append(f'{missing_column_count} columns contain missing values.')
    if profile['duplicate_rows']:
        insights.append(f"{profile['duplicate_rows']:,} duplicate rows detected.")
    if numerical_columns:
        average_column = max(numerical_columns, key=lambda column: current_dataset[column].mean())
        insights.append(f'{average_column} has the highest average among numerical fields.')
    if selected_target_column in current_dataset.columns:
        insights.append(f'{selected_target_column} is the selected target column.')
        if target_type:
            insights.append(f'The dataset is a {target_type} problem.')

    preview = []
    for row in current_dataset.head(10).where(pd.notna(current_dataset.head(10)), None).to_dict(orient='records'):
        preview.append({
            str(key): (
                None
                if pd.isna(value)
                else (value.item() if hasattr(value, 'item') else value)
            )
            for key, value in row.items()
        })

    return {
        'uploaded': True,
        'dataset_name': current_dataset_filename,
        'rows': int(len(current_dataset)),
        'columns': int(len(current_dataset.columns)),
        'file_size': current_dataset_file_size,
        'last_uploaded': current_dataset_uploaded_at,
        'missing_values': int(sum(profile['missing_values'].values())),
        'duplicate_rows': profile['duplicate_rows'],
        'numerical_columns': len(numerical_columns),
        'categorical_columns': len(categorical_columns),
        'target_column': selected_target_column if selected_target_column in current_dataset.columns else None,
        'problem_type': target_type,
        'preview': preview,
        'column_names': profile['column_names'],
        'numerical_column_names': numerical_columns,
        'categorical_column_names': categorical_columns,
        'numerical_distributions': numerical_distributions,
        'categorical_frequencies': categorical_frequencies,
        'insights': insights,
        'model_trained': trained_model_state is not None,
        'best_model': trained_model_state.get('best_model') if trained_model_state else None,
        'best_metrics': trained_model_state.get('best_metrics', {}) if trained_model_state else {},
        'model_problem_type': trained_model_state.get('problem_type') if trained_model_state else target_type,
    }


def format_histogram_value(value):
    if float(value).is_integer():
        return str(int(value))
    return f'{value:.4g}'


def build_eda_results(df):
    numerical_columns = [
        str(column)
        for column in df.columns
        if pd.api.types.is_numeric_dtype(df[column]) and not pd.api.types.is_bool_dtype(df[column])
    ]
    datetime_columns = detect_datetime_columns(df)
    categorical_columns = [
        str(column)
        for column in df.columns
        if str(column) not in numerical_columns and str(column) not in datetime_columns
        and (pd.api.types.is_object_dtype(df[column])
             or pd.api.types.is_string_dtype(df[column])
             or pd.api.types.is_categorical_dtype(df[column]))
    ]

    numerical_distributions = {}
    for column in numerical_columns:
        values = pd.to_numeric(df[column], errors='coerce').dropna().to_numpy(dtype=float)
        if not len(values):
            numerical_distributions[column] = []
            continue

        minimum = float(values.min())
        maximum = float(values.max())
        if minimum == maximum:
            numerical_distributions[column] = [{
                'range': format_histogram_value(minimum),
                'count': int(len(values)),
            }]
            continue

        bin_count = min(10, max(2, int(df[column].nunique(dropna=True))))
        counts, edges = np.histogram(values, bins=bin_count)
        numerical_distributions[column] = [
            {
                'range': f'{format_histogram_value(edges[index])}-{format_histogram_value(edges[index + 1])}',
                'count': int(counts[index]),
            }
            for index in range(len(counts))
        ]

    categorical_analysis = {}
    for column in categorical_columns:
        frequencies = df[column].dropna().astype(str).value_counts().head(10)
        categorical_analysis[column] = [
            {'name': str(name), 'count': int(count)}
            for name, count in frequencies.items()
        ]

    correlation = df[numerical_columns].corr(method='pearson') if numerical_columns else pd.DataFrame()
    if not correlation.empty:
        correlation = correlation.replace([np.inf, -np.inf], np.nan).fillna(0)
        correlation_values = correlation.to_numpy(dtype=float, copy=True)
        np.fill_diagonal(correlation_values, 1.0)
        correlation_matrix = [
            [round(float(value), 4) for value in row]
            for row in correlation_values.tolist()
        ]
    else:
        correlation_matrix = []

    missing_values = [
        {
            'column': str(column),
            'missing': int(df[column].isna().sum()),
            'percentage': round(float(df[column].isna().mean() * 100), 2),
        }
        for column in df.columns
        if df[column].isna().any()
    ]

    insights = []
    averages = df[numerical_columns].mean().dropna() if numerical_columns else pd.Series(dtype=float)
    if not averages.empty:
        column = str(averages.idxmax())
        insights.append(f'{column} has the highest average among the numerical features ({averages.max():.2f}).')

    if missing_values:
        most_missing = max(missing_values, key=lambda item: item['missing'])
        insights.append(f"{most_missing['column']} contains the most missing values ({most_missing['missing']}).")
    else:
        insights.append('No missing values were detected in the dataset.')

    unique_counts = {
        column: int(df[column].nunique(dropna=True))
        for column in categorical_columns
    }
    if unique_counts:
        column = max(unique_counts, key=unique_counts.get)
        insights.append(f'{column} has the most unique categorical values ({unique_counts[column]}).')

    strongest_correlation = None
    if len(numerical_columns) >= 2 and not correlation.empty:
        strongest_pair = None
        strongest_value = -1
        for first_index, first_column in enumerate(numerical_columns):
            for second_column in numerical_columns[first_index + 1:]:
                first_index = numerical_columns.index(first_column)
                second_index = numerical_columns.index(second_column)
                value = float(correlation_values[first_index, second_index])
                if abs(value) > strongest_value:
                    strongest_pair = (first_column, second_column)
                    strongest_value = abs(value)
        if strongest_pair:
            first_index = numerical_columns.index(strongest_pair[0])
            second_index = numerical_columns.index(strongest_pair[1])
            value = float(correlation_values[first_index, second_index])
            strongest_correlation = {
                'columns': list(strongest_pair),
                'value': round(value, 4),
            }
            direction = 'positive' if value >= 0 else 'negative'
            insights.append(
                f'{strongest_pair[0]} and {strongest_pair[1]} have the strongest {direction} correlation ({value:.2f}).'
            )
    if not insights:
        insights.append('Upload a dataset with analyzable columns to generate insights.')

    return {
        'numerical_distributions': numerical_distributions,
        'categorical_analysis': categorical_analysis,
        'correlation': {
            'columns': numerical_columns,
            'matrix': correlation_matrix,
        },
        'missing_values': missing_values,
        'insights': insights,
        'strongest_correlation': strongest_correlation,
    }


def is_datetime_series(series):
    if pd.api.types.is_datetime64_any_dtype(series):
        return True

    values = series.dropna().astype(str).str.strip()
    if values.empty:
        return False
    parsed = pd.to_datetime(values, errors='coerce')
    return bool(parsed.notna().mean() >= 0.8)


def is_identifier_column(column, series):
    normalized = str(column).strip().lower().replace('-', '_').replace(' ', '_')
    identifier_names = {'id', 'customer_id', 'user_id', 'record_id', 'row_id', 'uuid'}
    return normalized in identifier_names or normalized.endswith('_id')


def build_feature_schema(df, feature_columns):
    schema = []
    for column in feature_columns:
        series = df[column]
        numeric = pd.api.types.is_numeric_dtype(series) and not pd.api.types.is_bool_dtype(series)
        unique_values = []
        if not numeric:
            values = series.dropna().astype(str).drop_duplicates().tolist()
            if len(values) <= 50:
                unique_values = values
        schema.append({
            'name': str(column),
            'type': 'number' if numeric else 'text',
            'options': unique_values,
            'required': bool(series.notna().any()),
        })
    return schema


def infer_problem_type(series):
    if is_datetime_series(series):
        return 'datetime'

    non_null = series.dropna()
    if pd.api.types.is_numeric_dtype(series):
        unique_count = non_null.nunique()
        return 'classification' if unique_count <= 10 else 'regression'
    return 'classification'


def build_preprocessor(features, preprocessing):
    numerical_features = [
        column for column in features.columns
        if pd.api.types.is_numeric_dtype(features[column])
        and not pd.api.types.is_bool_dtype(features[column])
    ]
    categorical_features = [column for column in features.columns if column not in numerical_features]

    transformers = []
    if numerical_features:
        numerical_steps = []
        if preprocessing['impute_missing']:
            numerical_steps.append(('imputer', SimpleImputer(strategy='median')))
        if preprocessing['scale_numeric']:
            numerical_steps.append(('scaler', StandardScaler()))
        numerical_transformer = Pipeline(numerical_steps) if numerical_steps else 'passthrough'
        transformers.append((
            'numerical',
            numerical_transformer,
            numerical_features,
        ))
    if categorical_features:
        categorical_steps = []
        if preprocessing['impute_missing']:
            categorical_steps.append(('imputer', SimpleImputer(strategy='most_frequent')))
        categorical_transformer = (
            Pipeline(categorical_steps + [('encoder', OneHotEncoder(handle_unknown='ignore', sparse_output=False))])
            if preprocessing['encode_categorical']
            else (Pipeline(categorical_steps) if categorical_steps else 'passthrough')
        )
        transformers.append((
            'categorical',
            categorical_transformer,
            categorical_features,
        ))

    return ColumnTransformer(transformers=transformers, remainder='drop')


def get_feature_importance(pipeline):
    model = pipeline.named_steps['model']
    preprocessor = pipeline.named_steps['preprocessor']
    feature_names = preprocessor.get_feature_names_out()

    if hasattr(model, 'feature_importances_'):
        values = np.abs(model.feature_importances_)
    elif hasattr(model, 'coef_'):
        coefficients = np.asarray(model.coef_)
        values = np.abs(coefficients).mean(axis=0) if coefficients.ndim > 1 else np.abs(coefficients)
    else:
        return []

    importance = [
        {'name': str(name).replace('numerical__', '').replace('categorical__', ''), 'value': round(float(value), 6)}
        for name, value in zip(feature_names, values)
    ]
    importance.sort(key=lambda item: item['value'], reverse=True)
    maximum = importance[0]['value'] if importance else 0
    for item in importance:
        item['percentage'] = round((item['value'] / maximum) * 100, 2) if maximum else 0
    return importance[:10]


MODEL_SPECS = {
    'logistic_regression': ('Logistic Regression', 'classification', LogisticRegression(max_iter=1000)),
    'random_forest': ('Random Forest Classifier', 'classification', RandomForestClassifier(n_estimators=150)),
    'decision_tree': ('Decision Tree Classifier', 'classification', DecisionTreeClassifier()),
    'knn': ('K-Nearest Neighbors', 'classification', KNeighborsClassifier()),
    'support_vector_machine': ('Support Vector Machine', 'classification', SVC(probability=True)),
    'gradient_boosting': ('Gradient Boosting Classifier', 'classification', GradientBoostingClassifier()),
    'linear_regression': ('Linear Regression', 'regression', LinearRegression()),
    'random_forest_regressor': ('Random Forest Regressor', 'regression', RandomForestRegressor(n_estimators=150)),
    'decision_tree_regressor': ('Decision Tree Regressor', 'regression', DecisionTreeRegressor()),
    'knn_regressor': ('K-Nearest Neighbors Regressor', 'regression', KNeighborsRegressor()),
    'gradient_boosting_regressor': ('Gradient Boosting Regressor', 'regression', GradientBoostingRegressor()),
}


def train_models(df, target_column, problem_type, selected_models, test_size, random_state, preprocessing, cross_validation):
    if target_column not in df.columns:
        raise ValueError('Please select a valid target column.')

    target = df[target_column].copy()
    if is_datetime_series(target):
        raise ValueError('Date/time columns are not recommended as direct prediction targets. Extract time features first.')
    feature_columns = [
        column for column in df.columns
        if column != target_column and not is_identifier_column(column, df[column])
    ]
    features = df[feature_columns].copy()
    if features.shape[1] == 0:
        raise ValueError('The dataset must contain at least one feature besides the target.')

    valid_rows = target.notna()
    features = features.loc[valid_rows]
    target = target.loc[valid_rows]
    if len(target) < 8:
        raise ValueError('The dataset needs at least 8 valid target rows for training.')

    detected_type = infer_problem_type(target)
    if problem_type == 'auto':
        problem_type = detected_type
    if problem_type not in {'classification', 'regression'}:
        raise ValueError('Please select Auto Detect, Classification, or Regression.')
    if problem_type == 'regression' and not pd.api.types.is_numeric_dtype(target):
        converted_target = pd.to_numeric(target, errors='coerce')
        if converted_target.isna().any():
            raise ValueError('Regression requires a numeric target column.')
        target = converted_target
    if problem_type == 'classification' and pd.api.types.is_numeric_dtype(target) and target.nunique() > max(20, len(target) * 0.5):
        raise ValueError('This target has too many continuous numeric values for classification.')
    if target.nunique() < 2:
        raise ValueError('The target column must contain at least two distinct values.')

    if not selected_models:
        raise ValueError('Select at least one model before training.')
    models = []
    for model_key in selected_models:
        if model_key not in MODEL_SPECS:
            raise ValueError('One or more selected models are not supported.')
        model_name, model_type, model = MODEL_SPECS[model_key]
        if model_type != problem_type:
            raise ValueError(f'{model_name} is not compatible with {problem_type}.')
        model.set_params(random_state=random_state) if 'random_state' in model.get_params() else None
        models.append((model_key, model_name, model))

    test_size = float(test_size)
    if not 0.1 <= test_size <= 0.4:
        raise ValueError('Test size must be between 10% and 40%.')
    if not isinstance(random_state, int):
        raise ValueError('Random state must be an integer.')

    stratify = None
    if problem_type == 'classification' and target.value_counts().min() >= 2:
        stratify = target
    try:
        features_train, features_test, target_train, target_test = train_test_split(
            features,
            target,
            test_size=test_size,
            random_state=random_state,
            stratify=stratify,
        )
    except ValueError as exc:
        raise ValueError('The dataset is too small or imbalanced for a reliable train/test split.') from exc

    results = []
    pipelines = {}
    for model_key, model_name, model in models:
        pipeline = Pipeline([
            ('preprocessor', build_preprocessor(features_train, preprocessing)),
            ('model', model),
        ])
        started_at = time.perf_counter()
        pipeline.fit(features_train, target_train)
        predictions = pipeline.predict(features_test)
        training_time = round(time.perf_counter() - started_at, 4)

        if problem_type == 'classification':
            metrics = {
                'accuracy': round(float(accuracy_score(target_test, predictions)), 4),
                'precision': round(float(precision_score(target_test, predictions, average='weighted', zero_division=0)), 4),
                'recall': round(float(recall_score(target_test, predictions, average='weighted', zero_division=0)), 4),
                'f1': round(float(f1_score(target_test, predictions, average='weighted', zero_division=0)), 4),
            }
            if len(np.unique(target_test)) > 1 and hasattr(pipeline, 'predict_proba'):
                probabilities = pipeline.predict_proba(features_test)
                if probabilities.shape[1] == 2:
                    metrics['roc_auc'] = round(float(roc_auc_score(target_test, probabilities[:, 1])), 4)
                else:
                    metrics['roc_auc'] = round(float(roc_auc_score(target_test, probabilities, multi_class='ovr')), 4)
            else:
                metrics['roc_auc'] = None
            score = metrics['f1']
        else:
            r2 = r2_score(target_test, predictions)
            metrics = {
                'mae': round(float(mean_absolute_error(target_test, predictions)), 4),
                'rmse': round(float(np.sqrt(mean_squared_error(target_test, predictions))), 4),
                'r2': round(float(r2), 4) if np.isfinite(r2) else 0,
                'mse': round(float(mean_squared_error(target_test, predictions)), 4),
            }
            score = metrics['r2']

        cv_score = None
        if cross_validation['enabled']:
            if problem_type == 'classification':
                if target_train.value_counts().min() < cross_validation['folds']:
                    raise ValueError('CV folds cannot exceed the smallest class count in the training data.')
                splitter = StratifiedKFold(n_splits=cross_validation['folds'], shuffle=True, random_state=random_state)
                scoring = 'f1_weighted'
            else:
                splitter = KFold(n_splits=cross_validation['folds'], shuffle=True, random_state=random_state)
                scoring = 'r2'
            cv_score = round(float(cross_val_score(pipeline, features_train, target_train, cv=splitter, scoring=scoring).mean()), 4)

        pipelines[model_key] = pipeline
        results.append({
            'key': model_key,
            'name': model_name,
            'model_type': problem_type,
            'metrics': metrics,
            'primary_metric': 'f1' if problem_type == 'classification' else 'r2',
            'score': score,
            'cv_score': cv_score,
            'training_time': training_time,
            'feature_importance': get_feature_importance(pipeline),
        })

    best_result = max(results, key=lambda result: result['score'])
    best_pipeline = pipelines[best_result['key']]
    return {
        'target_column': target_column,
        'problem_type': problem_type,
        'train_rows': int(len(features_train)),
        'test_rows': int(len(features_test)),
        'models': results,
        'best_model': best_result['name'],
        'best_metrics': best_result['metrics'],
        'best_training_time': best_result['training_time'],
        'feature_importance': best_result['feature_importance'],
        'feature_schema': build_feature_schema(df, feature_columns),
        'feature_columns': [str(column) for column in feature_columns],
        'class_names': [str(value) for value in best_pipeline.named_steps['model'].classes_]
        if problem_type == 'classification' and hasattr(best_pipeline.named_steps['model'], 'classes_') else [],
        'cross_validation': cross_validation,
        '_trained_model': {
            'pipeline': best_pipeline,
            'pipelines': pipelines,
            'best_model_key': best_result['key'],
            'target_column': target_column,
            'feature_columns': feature_columns,
            'numeric_features': [
                str(column) for column in feature_columns
                if pd.api.types.is_numeric_dtype(df[column]) and not pd.api.types.is_bool_dtype(df[column])
            ],
            'problem_type': problem_type,
            'class_names': [str(value) for value in best_pipeline.named_steps['model'].classes_]
            if problem_type == 'classification' and hasattr(best_pipeline.named_steps['model'], 'classes_') else [],
        },
    }


def build_prediction_frame(features):
    feature_columns = trained_model_state['feature_columns']
    unknown_columns = set(features) - set(feature_columns)
    if unknown_columns:
        raise ValueError('Please check the entered values.')

    row = {}
    for column in feature_columns:
        value = features.get(column)
        if value == '':
            value = np.nan
        if column in trained_model_state['numeric_features'] and not pd.isna(value):
            value = float(value)
        row[column] = value
    return pd.DataFrame([row], columns=feature_columns)


def readable_transformed_feature(name):
    cleaned = str(name).split('__', 1)[-1]
    for column in trained_model_state['feature_columns']:
        prefix = f'{column}_'
        if cleaned.startswith(prefix):
            return f'{column} = {cleaned[len(prefix):]}'
    return cleaned


def build_explanation(pipeline, input_frame, model_key):
    model = pipeline.named_steps['model']
    preprocessor = pipeline.named_steps['preprocessor']
    transformed = preprocessor.transform(input_frame)
    feature_names = preprocessor.get_feature_names_out()
    method = 'SHAP'
    shap_values = None

    if shap is not None:
        try:
            if hasattr(model, 'feature_importances_'):
                shap_values = shap.TreeExplainer(model).shap_values(transformed)
            elif hasattr(model, 'coef_'):
                shap_values = shap.LinearExplainer(model, transformed).shap_values(transformed)
        except Exception:
            shap_values = None

    if shap_values is not None:
        if isinstance(shap_values, list):
            if trained_model_state['problem_type'] == 'classification':
                prediction = model.predict(transformed)[0]
                class_index = list(model.classes_).index(prediction)
                values = np.asarray(shap_values[class_index])[0]
            else:
                values = np.asarray(shap_values[0])[0]
        else:
            values_array = np.asarray(shap_values)
            if values_array.ndim == 3:
                prediction = model.predict(transformed)[0]
                class_index = list(model.classes_).index(prediction)
                values = values_array[0, :, class_index]
            elif values_array.ndim == 2:
                values = values_array[0]
            else:
                values = values_array.reshape(-1)
    else:
        method = 'Feature Importance'
        if hasattr(model, 'feature_importances_'):
            values = np.asarray(model.feature_importances_, dtype=float)
        elif hasattr(model, 'coef_'):
            coefficients = np.asarray(model.coef_, dtype=float)
            values = coefficients.mean(axis=0) if coefficients.ndim > 1 else coefficients
        else:
            values = np.array([], dtype=float)

    factors = []
    for name, impact in zip(feature_names, values):
        numeric_impact = float(impact)
        factors.append({
            'feature': readable_transformed_feature(name),
            'impact': round(numeric_impact, 6),
            'direction': 'increases_prediction' if numeric_impact >= 0 else 'decreases_prediction',
        })
    factors.sort(key=lambda item: abs(item['impact']), reverse=True)
    factors = factors[:10]
    increasing = [item for item in factors if item['impact'] >= 0]
    decreasing = [item for item in factors if item['impact'] < 0]
    prediction = model.predict(transformed)[0]
    summary_direction = 'higher' if increasing else 'lower'
    strongest = ', '.join(item['feature'] for item in (increasing or decreasing)[:3])
    summary = f'The model predicted {prediction} primarily because of {strongest}.' if strongest else f'The model predicted {prediction}.'
    if increasing and decreasing:
        summary += f' The strongest factors pushed the prediction {summary_direction}, while other factors pushed it in the opposite direction.'

    return {
        'model': MODEL_SPECS[model_key][0],
        'prediction': str(prediction) if trained_model_state['problem_type'] == 'classification' else float(prediction),
        'problem_type': trained_model_state['problem_type'],
        'explanation_method': method,
        'factors': factors,
        'increasing_factors': increasing,
        'decreasing_factors': decreasing,
        'summary': summary,
    }


@app.route('/api/upload', methods=['POST'])
def upload_dataset():
    global current_dataset, original_dataframe, cleaned_dataframe, current_dataset_filename, current_dataset_file_size, current_dataset_uploaded_at, selected_target_column, trained_model_state
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400

    uploaded_file = request.files['file']
    if uploaded_file.filename == '':
        return jsonify({'error': 'No file uploaded'}), 400

    filename_lower = uploaded_file.filename.lower()
    if not filename_lower.endswith(('.csv', '.xlsx')):
        return jsonify({'error': 'Only CSV and XLSX files are supported'}), 400

    try:
        file_bytes = uploaded_file.read()
        if not file_bytes:
            return jsonify({'error': 'Unable to process dataset'}), 500

        buffer = BytesIO(file_bytes)
        dataframe = None
        last_error = None

        if filename_lower.endswith('.xlsx'):
            dataframe = pd.read_excel(buffer, engine='openpyxl')
        else:
            for encoding in ['utf-8-sig', 'utf-8', 'cp1252', 'latin-1']:
                try:
                    dataframe = pd.read_csv(buffer, encoding=encoding)
                    buffer.seek(0)
                    break
                except (UnicodeDecodeError, ValueError, pd.errors.ParserError) as exc:
                    last_error = exc
                    buffer.seek(0)
                    continue

        if dataframe is None:
            raise ValueError('Unable to read CSV content')

        if dataframe.empty or dataframe.columns.empty:
            return jsonify({'error': 'Unable to process dataset'}), 500

        filename = uploaded_file.filename
        current_dataset = dataframe.copy()
        original_dataframe = dataframe.copy()
        cleaned_dataframe = None
        current_dataset_filename = filename
        current_dataset_file_size = len(file_bytes)
        current_dataset_uploaded_at = datetime.now().isoformat(timespec='seconds')
        selected_target_column = None
        trained_model_state = None
        profile = build_dataset_profile(dataframe, filename)
        return jsonify(profile), 200

    except Exception:
        return jsonify({'error': 'Unable to process dataset'}), 500


@app.route('/api/eda', methods=['GET'])
def exploratory_data_analysis():
    if current_dataset is None:
        return jsonify({'error': 'Please upload a dataset first.'}), 400

    try:
        return jsonify(build_eda_results(current_dataset)), 200
    except Exception:
        return jsonify({'error': 'Unable to generate analysis.'}), 500


@app.route('/api/ml/options', methods=['GET'])
def machine_learning_options():
    if current_dataset is None:
        return jsonify({'error': 'Please upload a dataset first.'}), 400

    return jsonify({
        'filename': current_dataset_filename,
        'rows': int(len(current_dataset)),
        'columns_count': int(len(current_dataset.columns)),
        'columns': [str(column) for column in current_dataset.columns],
        'target_types': {
            str(column): infer_problem_type(current_dataset[column])
            for column in current_dataset.columns
        },
        'datetime_columns': [
            str(column) for column in current_dataset.columns
            if is_datetime_series(current_dataset[column])
        ],
        'selected_target': selected_target_column,
    }), 200


@app.route('/api/train', methods=['POST'])
def train_machine_learning_models():
    global trained_model_state, selected_target_column
    if current_dataset is None:
        return jsonify({'error': 'Please upload a dataset first.'}), 400

    payload = request.get_json(silent=True) or {}
    target_column = payload.get('target_column')
    problem_type = payload.get('problem_type', 'auto')
    selected_models = payload.get('models') or []
    preprocessing_payload = payload.get('preprocessing') or {}
    preprocessing = {
        'impute_missing': bool(preprocessing_payload.get('impute_missing', True)),
        'encode_categorical': bool(preprocessing_payload.get('encode_categorical', True)),
        'scale_numeric': bool(preprocessing_payload.get('scale_numeric', False)),
    }
    cv_payload = payload.get('cross_validation') or {}
    cross_validation = {
        'enabled': bool(cv_payload.get('enabled', False)),
        'folds': int(cv_payload.get('folds', 5)),
    }
    if not target_column:
        return jsonify({'error': 'Please select a target column.'}), 400
    if problem_type not in {'auto', 'classification', 'regression'}:
        return jsonify({'error': 'Please select Auto Detect, Classification, or Regression.'}), 400
    if cross_validation['folds'] not in {3, 5, 10}:
        return jsonify({'error': 'CV folds must be 3, 5, or 10.'}), 400

    try:
        result = train_models(
            current_dataset,
            target_column,
            problem_type,
            selected_models,
            payload.get('test_size', 0.2),
            payload.get('random_state', 42),
            preprocessing,
            cross_validation,
        )
        trained_model_state = result.pop('_trained_model')
        trained_model_state['best_model'] = result['best_model']
        trained_model_state['best_metrics'] = result['best_metrics']
        selected_target_column = target_column
        return jsonify(result), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except Exception:
        return jsonify({'error': 'Unable to train models on this dataset.'}), 500


@app.route('/api/predict', methods=['POST'])
def predict_individual_record():
    if trained_model_state is None:
        return jsonify({'error': 'Please train a model first.'}), 400

    payload = request.get_json(silent=True) or {}
    features = payload.get('features')
    if not isinstance(features, dict):
        return jsonify({'error': 'Please check the entered values.'}), 400

    try:
        input_frame = build_prediction_frame(features)
        model_key = payload.get('model_key') or trained_model_state['best_model_key']
        pipeline = trained_model_state['pipelines'].get(model_key)
        if pipeline is None:
            return jsonify({'error': 'Unable to generate prediction for these values.'}), 400
        prediction = pipeline.predict(input_frame)[0]
        if trained_model_state['problem_type'] == 'classification':
            probabilities = {}
            probability = None
            if hasattr(pipeline, 'predict_proba'):
                probability_values = pipeline.predict_proba(input_frame)[0]
                probabilities = {
                    class_name: round(float(value), 6)
                    for class_name, value in zip(trained_model_state['class_names'], probability_values)
                }
                probability = round(float(max(probability_values)), 6)
            return jsonify({
                'prediction': str(prediction),
                'probability': probability,
                'probabilities': probabilities,
            }), 200

        numeric_prediction = float(prediction)
        return jsonify({
            'prediction': int(numeric_prediction) if numeric_prediction.is_integer() else round(numeric_prediction, 6),
        }), 200
    except (ValueError, TypeError, KeyError):
        return jsonify({'error': 'Please check the entered values.'}), 400
    except Exception:
        return jsonify({'error': 'Unable to generate prediction for these values.'}), 500


@app.route('/api/explain', methods=['POST'])
def explain_individual_prediction():
    if trained_model_state is None:
        return jsonify({'error': 'Train a model before explaining predictions.'}), 400

    payload = request.get_json(silent=True) or {}
    features = payload.get('features')
    if not isinstance(features, dict):
        return jsonify({'error': 'Generate a prediction first.'}), 400

    try:
        input_frame = build_prediction_frame(features)
        model_key = payload.get('model_key') or trained_model_state['best_model_key']
        pipeline = trained_model_state['pipelines'].get(model_key)
        if pipeline is None:
            return jsonify({'error': 'Unsupported model explanation.'}), 400

        explanation = build_explanation(pipeline, input_frame, model_key)
        if trained_model_state['problem_type'] == 'classification' and hasattr(pipeline, 'predict_proba'):
            probability_values = pipeline.predict_proba(input_frame)[0]
            classes = [str(value) for value in pipeline.named_steps['model'].classes_]
            explanation['probability'] = round(float(max(probability_values)), 6)
            explanation['probabilities'] = {
                class_name: round(float(value), 6)
                for class_name, value in zip(classes, probability_values)
            }
        return jsonify(explanation), 200
    except (ValueError, TypeError, KeyError):
        return jsonify({'error': 'Please check the entered values.'}), 400
    except Exception:
        return jsonify({'error': 'Unable to explain this prediction.'}), 500


@app.route('/api/export-cleaning-excel', methods=['GET'])
def export_cleaning_excel():
    if current_dataset is None:
        return jsonify({'error': 'Please upload a dataset first.'}), 400

    try:
        workbook = Workbook()
        data_sheet = workbook.active
        data_sheet.title = 'Data'
        header_fill = PatternFill('solid', fgColor='1F4E78')
        missing_fill = PatternFill('solid', fgColor='FFF2CC')
        duplicate_fill = PatternFill('solid', fgColor='FCE4D6')
        header_font = Font(color='FFFFFF', bold=True)

        for column_index, column in enumerate(current_dataset.columns, start=1):
            cell = data_sheet.cell(row=1, column=column_index, value=str(column))
            cell.fill = header_fill
            cell.font = header_font

        duplicate_rows = current_dataset.duplicated(keep=False).tolist()
        for row_index, (_, row) in enumerate(current_dataset.iterrows(), start=2):
            for column_index, column in enumerate(current_dataset.columns, start=1):
                value = row[column]
                cell = data_sheet.cell(row=row_index, column=column_index, value=None if pd.isna(value) else value)
                if pd.isna(value):
                    cell.fill = missing_fill
                if duplicate_rows[row_index - 2]:
                    cell.fill = duplicate_fill

        for column_index, column in enumerate(current_dataset.columns, start=1):
            values = [str(column)] + [str(value) for value in current_dataset[column].dropna().head(100)]
            data_sheet.column_dimensions[get_column_letter(column_index)].width = min(32, max(12, max(len(value) for value in values) + 2))
        data_sheet.freeze_panes = 'A2'
        data_sheet.auto_filter.ref = data_sheet.dimensions

        quality_sheet = workbook.create_sheet('Data Quality')
        quality_headers = ['Issue Type', 'Column', 'Count', 'Percentage', 'Recommendation']
        for column_index, header in enumerate(quality_headers, start=1):
            cell = quality_sheet.cell(row=1, column=column_index, value=header)
            cell.fill = header_fill
            cell.font = header_font
        issues = build_data_quality_issues(current_dataset)
        for row_index, issue in enumerate(issues, start=2):
            quality_sheet.append([issue['issue_type'], issue['column'], issue['count'], issue['percentage'] / 100, issue['recommendation']])
            quality_sheet.cell(row=row_index, column=4).number_format = '0.00%'
        for column_index, width in enumerate([22, 28, 14, 16, 42], start=1):
            quality_sheet.column_dimensions[get_column_letter(column_index)].width = width
        quality_sheet.freeze_panes = 'A2'
        quality_sheet.auto_filter.ref = quality_sheet.dimensions

        instructions_sheet = workbook.create_sheet('Instructions')
        instructions_sheet['A1'] = 'DataMind AI Cleaning Instructions'
        instructions_sheet['A1'].font = Font(bold=True, size=14)
        instructions = [
            '1. Review missing values highlighted in the Data sheet.',
            '2. Review duplicate rows highlighted in the Data sheet.',
            '3. Correct incorrect or inconsistent values.',
            '4. Save the Excel file.',
            '5. Upload the cleaned file again to Data Analytics.',
            '6. Re-run analysis.',
        ]
        for row_index, instruction in enumerate(instructions, start=3):
            instructions_sheet.cell(row=row_index, column=1, value=instruction)
        instructions_sheet.column_dimensions['A'].width = 90

        output = BytesIO()
        workbook.save(output)
        output.seek(0)
        return send_file(output, as_attachment=True, download_name='DataMind_Cleaning_Report.xlsx', mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    except Exception:
        return jsonify({'error': 'Unable to generate the Excel cleaning workbook.'}), 500


def cleaning_options_from_payload(payload):
    return {
        'remove_duplicates': bool(payload.get('remove_duplicates', True)),
        'fill_numeric': bool(payload.get('fill_numeric', True)),
        'fill_categorical': bool(payload.get('fill_categorical', True)),
        'missing_numeric': payload.get('missing_numeric', 'median'),
        'missing_categorical': payload.get('missing_categorical', 'mode'),
        'standardize_categories': bool(payload.get('standardize_categories', True)),
        'convert_numeric_columns': bool(payload.get('convert_numeric_columns', True)),
        'handle_invalid_values': payload.get('handle_invalid_values', 'median'),
    }


@app.route('/api/clean/preview', methods=['POST'])
def preview_cleaning():
    if current_dataset is None:
        return jsonify({'error': 'Please upload a dataset first.'}), 400
    try:
        options = cleaning_options_from_payload(request.get_json(silent=True) or {})
        preview, changes = clean_dataframe(current_dataset, options)
        before_issues = detect_cleaning_issues(current_dataset)
        after_issues = detect_cleaning_issues(preview)
        return jsonify({
            'rows_before': int(len(current_dataset)),
            'rows_after': int(len(preview)),
            'issues_before': before_issues,
            'issues_after': after_issues,
            'issues_fixed': max(0, sum(issue['count'] for issue in before_issues) - sum(issue['count'] for issue in after_issues)),
            'changes': changes,
        }), 200
    except Exception:
        return jsonify({'error': 'Unable to preview cleaning changes.'}), 500


@app.route('/api/clean', methods=['POST'])
def apply_cleaning():
    global current_dataset, cleaned_dataframe, trained_model_state, selected_target_column
    if current_dataset is None:
        return jsonify({'error': 'Please upload a dataset first.'}), 400
    try:
        options = cleaning_options_from_payload(request.get_json(silent=True) or {})
        cleaned, changes = clean_dataframe(current_dataset, options)
        cleaned_dataframe = cleaned.copy()
        current_dataset = cleaned_dataframe.copy()
        trained_model_state = None
        selected_target_column = None if selected_target_column not in current_dataset.columns else selected_target_column
        profile = build_dataset_profile(current_dataset, current_dataset_filename)
        return jsonify({
            'message': 'Cleaning completed.',
            'rows_before': int(len(original_dataframe)) if original_dataframe is not None else int(len(current_dataset)),
            'rows_after': int(len(current_dataset)),
            'changes': changes,
            'profile': profile,
        }), 200
    except Exception:
        return jsonify({'error': 'Unable to apply cleaning changes.'}), 500


@app.route('/api/download-cleaned', methods=['GET'])
def download_cleaned_dataset():
    if cleaned_dataframe is None:
        return jsonify({'error': 'Apply cleaning before downloading the cleaned dataset.'}), 400
    output = BytesIO()
    cleaned_dataframe.to_csv(output, index=False)
    output.seek(0)
    return send_file(output, as_attachment=True, download_name='DataMind_Cleaned_Dataset.csv', mimetype='text/csv')


@app.route('/api/ai/data-advisor', methods=['POST'])
def ai_data_advisor():
    global current_dataset

    if current_dataset is None:
        return jsonify({
            'success': False,
            'error': 'Please upload a dataset first.'
        }), 400

    try:
        summary = build_ai_dataset_summary(current_dataset)
        fallback = build_fallback_ai_advice(summary)

        try:
            raw_response = call_groq_for_dataset_advice(summary)
            cleaned_response = sanitize_groq_json(raw_response)

            if not cleaned_response:
                raise ValueError('AI returned an empty response.')

            payload = json.loads(cleaned_response)
            normalized = normalize_ai_payload(payload, summary)

            if not isinstance(normalized, dict):
                raise ValueError('AI returned an invalid response.')

            normalized['ai_used'] = True
            normalized['ai_model'] = get_groq_model_name()
            return jsonify(normalized), 200

        except Exception as exc:
            # Never break the AI Suggestions page just because Groq is
            # unavailable. Return verified Pandas recommendations instead.
            print('AI Advisor Groq error:', str(exc))
            fallback['ai_used'] = False
            fallback['ai_model'] = get_groq_model_name()
            fallback['ai_error'] = str(exc)
            return jsonify(fallback), 200

    except Exception as exc:
        print('AI Advisor error:', str(exc))
        return jsonify({
            'success': False,
            'error': 'Unable to analyze the dataset.',
            'details': str(exc),
        }), 500


@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok'}), 200


@app.route('/api/dataset/status', methods=['GET'])
def dataset_status():
    return jsonify({'uploaded': current_dataset is not None}), 200


@app.route('/api/dashboard', methods=['GET'])
def dashboard_data():
    return jsonify(build_dashboard_payload()), 200


@app.route('/api/target', methods=['POST'])
def save_target_selection():
    global selected_target_column
    if current_dataset is None:
        return jsonify({'error': 'Please upload a dataset first.'}), 400

    payload = request.get_json(silent=True) or {}
    target_column = payload.get('target_column')
    if target_column not in current_dataset.columns:
        return jsonify({'error': 'Please select a valid target column.'}), 400
    if is_datetime_series(current_dataset[target_column]):
        return jsonify({'error': 'Date/time columns cannot be used as prediction targets.'}), 400

    selected_target_column = target_column
    return jsonify({
        'target_column': selected_target_column,
        'problem_type': infer_problem_type(current_dataset[target_column]),
    }), 200


if __name__ == '__main__':
    app.run(debug=True, port=5000)
