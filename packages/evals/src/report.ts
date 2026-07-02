import * as fs from 'fs';
import * as path from 'path';
import type { EvalReport } from './types';

/** Renders an eval report as human-readable markdown. */
export function renderReportMarkdown(report: EvalReport): string {
    const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
    const lines: string[] = [
        '# Eval Report — Cognitive Substrate OS',
        '',
        `- **Generado:** ${report.generatedAt}`,
        `- **Modo:** ${report.simulation ? 'simulación (sin API key)' : 'en vivo (con API key)'}`,
        `- **pass@1:** ${report.passed}/${report.total} (${pct(report.passRate)})`,
        `- **Tiempo total:** ${report.totalDurationMs} ms`,
        `- **Costo total:** ${report.totalLlmCalls} llamadas LLM`,
        '',
        '## Por categoría',
        '',
        '| Categoría | Pass | Total |',
        '| --- | --- | --- |'
    ];
    for (const [cat, s] of Object.entries(report.byCategory)) {
        lines.push(`| ${cat} | ${s.passed} | ${s.total} |`);
    }

    lines.push(
        '',
        '## Casos',
        '',
        '| Estado | Caso | Categoría | ms | LLM | Detalle |',
        '| --- | --- | --- | --- | --- | --- |'
    );
    for (const r of report.results) {
        const status = r.passed ? '✅' : '❌';
        const detail = (r.error ? `ERROR: ${r.error}` : r.detail).replace(/\|/g, '\\|');
        lines.push(`| ${status} | \`${r.id}\` | ${r.category} | ${r.durationMs} | ${r.llmCalls} | ${detail} |`);
    }
    lines.push('');
    return lines.join('\n');
}

/** Writes both `report.md` and `report.json` to `outDir`, returning their paths. */
export function writeReport(report: EvalReport, outDir: string): { md: string; json: string } {
    fs.mkdirSync(outDir, { recursive: true });
    const md = path.join(outDir, 'report.md');
    const json = path.join(outDir, 'report.json');
    fs.writeFileSync(md, renderReportMarkdown(report), 'utf8');
    fs.writeFileSync(json, JSON.stringify(report, null, 2), 'utf8');
    return { md, json };
}
