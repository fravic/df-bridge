export enum LogLevel {
  NORMAL,
  VERBOSE,
  ERROR,
}

function _log(message: string, level: LogLevel, indent: number) {
  const indents = "-".repeat(indent);
  const messageIndented = indents + message;
  if (level === LogLevel.ERROR) {
    console.error(messageIndented);
  }
  if (level !== LogLevel.VERBOSE || process.env.LOG_LEVEL === "verbose") {
    console.log(messageIndented);
  }
}

export function log(message: string, indent: number = 0) {
  _log(message, LogLevel.NORMAL, indent);
}

export function verbose(message: string, indent: number = 0) {
  _log(message, LogLevel.VERBOSE, indent);
}

export function error(message: string, indent: number = 0) {
  _log(message, LogLevel.ERROR, indent);
}
