/** Synchronous legacy CLI adapter; new callers use structured diagnostics. */
import { collectDoctorDiagnostics } from '../application/diagnostics/checks.js';
import { defaultDoctorDeps } from '../application/diagnostics/deps.js';
import type { DoctorDeps } from '../application/diagnostics/deps.js';
import { renderDoctorDiagnostics } from '../application/diagnostics/render.js';
import type { DoctorReport } from '../application/diagnostics/render.js';

export { defaultDoctorDeps };
export type { DoctorDeps, DoctorReport };

export function runDoctor(deps: DoctorDeps = defaultDoctorDeps()): DoctorReport {
  return renderDoctorDiagnostics(collectDoctorDiagnostics(deps));
}
