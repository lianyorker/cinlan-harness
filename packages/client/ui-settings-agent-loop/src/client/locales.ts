/** Locale bundles for the agent loop's General row. */

/** Locale keys the row renders. */
export type AgentLoopSettingsLocaleKey =
  | 'maxParallel' | 'maxParallelHint' | 'reset' | 'increase' | 'decrease'

/** English copy. */
export const en: Record<AgentLoopSettingsLocaleKey, string> = {
  maxParallel: 'Parallel tool calls',
  maxParallelHint: 'Upper bound on parallel-safe calls running at once within one step.',
  reset: 'Reset to default',
  increase: 'Increase parallel calls',
  decrease: 'Decrease parallel calls',
}

/** Simplified Chinese copy. */
export const zh: Record<AgentLoopSettingsLocaleKey, string> = {
  maxParallel: '并行工具调用数',
  maxParallelHint: '同一步内最多同时运行多少个可并行的调用。',
  reset: '恢复默认',
  increase: '增大并行数',
  decrease: '减小并行数',
}

/** Japanese copy, checked against the English keys. */
export const ja = {
  'maxParallel': '並列ツール呼び出し',
  'maxParallelHint': '1ステップ内で同時に実行される並列安全呼び出しの上限。', increase: '並列数を増やす', decrease: '並列数を減らす',
  'reset': 'デフォルトにリセット',
} satisfies Record<keyof typeof en, string>

/** Spanish dictionary, checked against the English keys. */
export const es = {
  maxParallel: 'Llamadas a herramientas paralelas',
  maxParallelHint: 'Límite superior de llamadas seguras en paralelo que se ejecutan al mismo tiempo en un solo paso.', increase: 'Aumentar llamadas paralelas', decrease: 'Reducir llamadas paralelas',
  reset: 'Restablecer los valores predeterminados',
} satisfies Record<keyof typeof en, string>

/** French dictionary, checked against the English keys. */
export const fr = {
  maxParallel: "Appels d'outils parallèles",
  maxParallelHint: 'Limite supérieure des appels parallèles sécurisés exécutés simultanément en une seule étape.', increase: 'Augmenter les appels parallèles', decrease: 'Réduire les appels parallèles',
  reset: 'Réinitialiser aux valeurs par défaut',
} satisfies Record<keyof typeof en, string>

/** German dictionary, checked against the English keys. */
export const de = {
  maxParallel: 'Parallele Werkzeugaufrufe',
  maxParallelHint: 'Obergrenze für parallelsichere Aufrufe, die gleichzeitig innerhalb eines Schritts ausgeführt werden.', increase: 'Parallele Aufrufe erhöhen', decrease: 'Parallele Aufrufe verringern',
  reset: 'Auf Standard zurücksetzen',
} satisfies Record<keyof typeof en, string>

/** Russian dictionary, checked against the English keys. */
export const ru = {
  maxParallel: 'Параллельные вызовы инструментов',
  maxParallelHint: 'Верхняя граница параллельных безопасных вызовов, выполняемых одновременно в течение одного шага.', increase: 'Увеличить число параллельных вызовов', decrease: 'Уменьшить число параллельных вызовов',
  reset: 'Сбросить настройки по умолчанию',
} satisfies Record<keyof typeof en, string>

/** Portuguese dictionary, checked against the English keys. */
export const pt = {
  maxParallel: 'Chamadas de ferramentas paralelas',
  maxParallelHint: 'Limite superior em chamadas paralelas seguras executadas ao mesmo tempo em uma etapa.', increase: 'Aumentar chamadas paralelas', decrease: 'Reduzir chamadas paralelas',
  reset: 'Redefinir para o padrão',
} satisfies Record<keyof typeof en, string>
