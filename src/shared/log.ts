// Structured JSON logs (Workers Logs indexes the fields). Never pass tokens or health values in `context`.

type Level = 'info' | 'warn' | 'error';

function write(level: Level, message: string, context: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, message, time: new Date().toISOString(), ...context });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  info: (message: string, context?: Record<string, unknown>) => write('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => write('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => write('error', message, context),
};

export function errorDetail(error: unknown): Record<string, unknown> {
  return error instanceof Error ? { error: error.message, stack: error.stack } : { error: String(error) };
}
