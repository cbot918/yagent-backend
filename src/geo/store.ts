import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import type { GeoReport } from './types.js';

// GEO reports live as data under the workspace (files-as-truth), mirroring
// .rooms/ — one JSON file per report. NOTE: the workspace is ephemeral on
// Zeabur, so these runtime reports are wiped on redeploy; durable artifacts
// (question set, profile, dogfood markdown) live in knowledge/geo/ (in git).
function reportPath(id: string) {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(config.workspaceDir, '.geo', `${safe}.json`);
}

export async function saveReport(report: GeoReport): Promise<void> {
  const p = reportPath(report.id);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(report, null, 2));
}

export async function loadReport(id: string): Promise<GeoReport | null> {
  try {
    const raw = await fs.readFile(reportPath(id), 'utf8');
    return JSON.parse(raw) as GeoReport;
  } catch {
    return null;
  }
}

/** All reports, newest first (for the deliverable-pane history list). */
export async function listReports(): Promise<GeoReport[]> {
  try {
    const dir = path.join(config.workspaceDir, '.geo');
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
    const reports: GeoReport[] = [];
    for (const f of files) {
      const r = await loadReport(f.replace(/\.json$/, ''));
      if (r) reports.push(r);
    }
    return reports.sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
}
