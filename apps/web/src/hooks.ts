import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { evaluateScenario, type Scenario, type EvaluationResult } from '@hac-d/core';
import { useActiveScenario } from './state/store.js';
import type { Lang } from './lib/format.js';

export function useLang(): Lang {
  const { i18n } = useTranslation();
  return i18n.language.startsWith('zh') ? 'zh' : 'en';
}

export interface Active {
  scenario: Scenario;
  result: EvaluationResult;
  error?: string;
}

/** The active scenario and its evaluation (memoised on the scenario's JSON). */
export function useActive(): Active | undefined {
  const scenario = useActiveScenario();
  const key = scenario ? JSON.stringify(scenario) : '';
  return useMemo(() => {
    if (!scenario) return undefined;
    try {
      return { scenario, result: evaluateScenario(scenario) };
    } catch (e) {
      return { scenario, result: undefined as unknown as EvaluationResult, error: (e as Error).message };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
