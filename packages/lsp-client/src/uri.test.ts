import { describe, expect, it } from 'vitest';
import { documentUriFromModelUri, fileUriToPath, pathToFileUri } from './uri';

describe('pathToFileUri', () => {
  it('canonicalizes windows paths regardless of separator mix', () => {
    expect(pathToFileUri('D:\\Lang\\SpectraLang\\midend\\src\\lib.rs')).toBe(
      'file:///d%3A/Lang/SpectraLang/midend/src/lib.rs',
    );
    expect(pathToFileUri('D:/Lang/SpectraLang\\midend\\src\\lib.rs')).toBe(
      'file:///d%3A/Lang/SpectraLang/midend/src/lib.rs',
    );
    expect(pathToFileUri('D:/Lang/SpectraLang/midend/src/lib.rs')).toBe(
      'file:///d%3A/Lang/SpectraLang/midend/src/lib.rs',
    );
  });

  it('encodes spaces and reserved characters per segment', () => {
    expect(pathToFileUri('C:\\a b\\c#d.rs')).toBe('file:///c%3A/a%20b/c%23d.rs');
  });

  it('encodes like vscode-uri (parentheses, exclamation, apostrophe)', () => {
    expect(pathToFileUri("C:\\proj (x)!\\o'brien %.rs")).toBe(
      'file:///c%3A/proj%20%28x%29%21/o%27brien%20%25.rs',
    );
  });

  it('handles posix paths', () => {
    expect(pathToFileUri('/home/user/lib.rs')).toBe('file:///home/user/lib.rs');
  });

  it('passes through existing file uris unchanged', () => {
    expect(pathToFileUri('file:///d%3A/x.rs')).toBe('file:///d%3A/x.rs');
  });
});

describe('documentUriFromModelUri', () => {
  it('returns canonical file uris unchanged', () => {
    expect(
      documentUriFromModelUri({
        scheme: 'file',
        path: '/d:/x.rs',
        toString: () => 'file:///d%3A/x.rs',
      }),
    ).toBe('file:///d%3A/x.rs');
  });

  it('rebuilds file uris from models parsed from raw windows paths', () => {
    expect(
      documentUriFromModelUri({
        scheme: 'D',
        path: '\\Lang\\midend\\src\\lib.rs',
        toString: () => 'D:%5CLang%5Cmidend%5Csrc%5Clib.rs',
      }),
    ).toBe('file:///d%3A/Lang/midend/src/lib.rs');
    expect(
      documentUriFromModelUri({
        scheme: 'D',
        path: '/Lang/SpectraLang\\midend\\src\\lib.rs',
        toString: () => 'D:/Lang/SpectraLang%5Cmidend%5Csrc%5Clib.rs',
      }),
    ).toBe('file:///d%3A/Lang/SpectraLang/midend/src/lib.rs');
  });

  it('rejects non-file schemes', () => {
    expect(
      documentUriFromModelUri({ scheme: 'history', path: 'abc', toString: () => 'history:abc' }),
    ).toBeNull();
    expect(
      documentUriFromModelUri({
        scheme: 'untitled',
        path: 'Untitled-1',
        toString: () => 'untitled:Untitled-1',
      }),
    ).toBeNull();
    expect(
      documentUriFromModelUri({
        scheme: 'inmemory',
        path: '/model/1',
        toString: () => 'inmemory://model/1',
      }),
    ).toBeNull();
  });
});

describe('fileUriToPath', () => {
  it('decodes windows file uris', () => {
    expect(fileUriToPath('file:///d%3A/Hyscode')).toBe('d:/Hyscode');
    expect(fileUriToPath('file:///D:/Hyscode')).toBe('D:/Hyscode');
  });

  it('keeps posix paths', () => {
    expect(fileUriToPath('file:///home/user/x.rs')).toBe('/home/user/x.rs');
  });

  it('passes through non-file values', () => {
    expect(fileUriToPath('history:abc')).toBe('history:abc');
  });
});
