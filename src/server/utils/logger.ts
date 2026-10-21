export interface Logger {
  info(event: string, details?: Record<string, unknown>): void;
  error(event: string, details?: Record<string, unknown>): void;
}

// Only explicitly allowed operational fields are logged. Request bodies,
// headers, query strings, tokens, credentials, and raw errors are never logged.
function write(level: string, event: string, details: Record<string, unknown> = {}): void {
  const allowed = ['requestId', 'method', 'statusCode', 'durationMs', 'port', 'host', 'signal'];
  const safe = Object.fromEntries(Object.entries(details).filter(([key]) => allowed.includes(key)));
  const line = JSON.stringify({ timestamp: new Date().toISOString(), level, service: 'freshifyz', event, ...safe });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const logger: Logger = {
  info: (event, details) => write('info', event, details),
  error: (event, details) => write('error', event, details),
};
