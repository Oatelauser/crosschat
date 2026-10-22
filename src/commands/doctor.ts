/** Synchronous legacy CLI adapter; new callers use structured diagnostics. */
import { collectDoctorDiagnostics } from '../application/diagnostics/checks.js';
import { defaultDoctorDeps } from '../application/diagnostics/deps.js';
import type { DoctorDeps } from '../application/diagnostics/deps.js';
import { renderDoctorDiagnostics } from '../application/diagnostics/render.js';
import type { DoctorReport } from '../application/diagnostics/render.js';
import type { DiagnosticResult } from '../application/diagnostics/model.js';

export { defaultDoctorDeps };
export type { DoctorDeps, DoctorReport };

export function runDoctor(deps: DoctorDeps = defaultDoctorDeps()): DoctorReport {
  return renderDoctorDiagnostics(collectDoctorDiagnostics(deps));
}

/** Structured read-only CLI face; check collection and severities are shared with the text report. */
export function runDoctorDiagnostics(deps: DoctorDeps = defaultDoctorDeps()): DiagnosticResult {
  return collectDoctorDiagnostics(deps);
}
