export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface DiagnosticContract {
  file: string;
  line: number;
  col: number;
  severity: DiagnosticSeverity;
  message: string;
  source: string;
  code?: string | number;
}

export function uriToDiagnosticPath(value: string): string | null {
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')) {
    return value;
  }
  if (!/^file:/i.test(value)) {
    return value.includes('://') || /^[A-Za-z][A-Za-z\d+.-]*:/.test(value) ? null : value;
  }

  try {
    const parsed = new URL(value);
    const pathname = decodeURIComponent(parsed.pathname);
    if (parsed.hostname && parsed.hostname.toLowerCase() !== 'localhost') {
      return `\\\\${parsed.hostname}${pathname.replace(/\//g, '\\')}`;
    }
    if (/^\/[A-Za-z]:[\\/]/.test(pathname)) {
      return pathname.slice(1).replace(/\//g, '\\');
    }
    if (pathname.startsWith('//')) {
      return pathname.replace(/\//g, '\\');
    }
    return pathname;
  } catch {
    const encodedPath = value.replace(/^file:\/\//i, '');
    try {
      return decodeURIComponent(encodedPath).replace(/^\/([A-Za-z]:[\\/])/, '$1');
    } catch {
      return encodedPath;
    }
  }
}

function slashPath(value: string): string {
  return (uriToDiagnosticPath(value) ?? value).replace(/\\/g, '/');
}

function isWindowsPath(value: string): boolean {
  const path = slashPath(value);
  if (/^[A-Za-z]:\//.test(path) || /^\/[A-Za-z]:\//.test(path) || path.startsWith('//')) {
    return true;
  }
  if (typeof navigator !== 'undefined') {
    return /win/i.test(`${navigator.platform} ${navigator.userAgent}`);
  }
  return false;
}

export function diagnosticPathKey(value: string): string {
  const path = slashPath(value).replace(/\/$/, '');
  return isWindowsPath(value) ? path.toLowerCase() : path;
}

export function diagnosticPathsEqual(left: string, right: string): boolean {
  return diagnosticPathKey(left) === diagnosticPathKey(right);
}

export function diagnosticRelativePath(root: string, file: string): string | null {
  const rootPath = slashPath(root).replace(/\/$/, '');
  const filePath = slashPath(file);
  const rootKey = diagnosticPathKey(rootPath);
  const fileKey = diagnosticPathKey(filePath);
  if (fileKey === rootKey) return '';
  const prefix = rootKey.endsWith('/') ? rootKey : `${rootKey}/`;
  if (!fileKey.startsWith(prefix)) return null;
  return filePath.slice(rootPath.endsWith('/') ? rootPath.length : rootPath.length + 1);
}
