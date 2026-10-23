import type { Reporter, TestCase } from "vitest/node";

/**
 * Cuenta los tests que pasaron SOLO al reintentar (`retry: 2` en `vitest.config.ts`).
 *
 * El reintento existe para el entorno (Realtime frío, sockets de la impresora falsa), no para
 * bugs. Sin esto, un test que falla una de cada tres veces sale en verde y nadie se entera de
 * que hay algo que mirar. Ver README → "Verificación".
 */
export default class ReintentosReporter implements Reporter {
  private reintentados: string[] = [];

  onTestCaseResult(testCase: TestCase): void {
    const diagnostico = testCase.diagnostic();
    if (diagnostico?.flaky) {
      this.reintentados.push(
        `${testCase.module.relativeModuleId} > ${testCase.fullName} (${diagnostico.retryCount} reintento(s))`,
      );
    }
  }

  onTestRunEnd(): void {
    if (this.reintentados.length === 0) return;
    console.log(`\n${this.reintentados.length} tests necesitaron reintento:`);
    for (const test of this.reintentados) console.log(`  - ${test}`);
  }
}
