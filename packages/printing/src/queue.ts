const queues = new Map<string, Promise<unknown>>();

/**
 * Serializa las tareas dirigidas al mismo dispositivo físico. Dos configs que
 * apuntan a la misma impresora comparten cola (dos WritePrinter simultáneos a la
 * misma cola de impresión pierden un ticket en silencio); impresoras distintas
 * corren en paralelo. La tarea se ejecuta aunque la anterior haya fallado.
 */
export function enqueueByDevice<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.then(task, task);
  queues.set(
    key,
    next.catch(() => {}),
  );
  return next;
}
