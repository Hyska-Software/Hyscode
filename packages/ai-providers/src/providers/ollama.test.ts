import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FetchImpl } from '../types';
import { OllamaProvider } from './ollama';

describe('OllamaProvider model discovery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('treats an offline local daemon as an informational state', async () => {
    const fetchImpl: FetchImpl = async () => {
      throw new Error(
        'HTTP request failed: error sending request for url (http://localhost:11434/api/tags)',
      );
    };
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = new OllamaProvider('http://localhost:11434', fetchImpl);

    await expect(provider.listModels()).resolves.toEqual([]);
    expect(provider.models).toEqual([]);
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('Local service unavailable at http://localhost:11434'),
    );
    expect(warning).not.toHaveBeenCalled();
  });

  it('keeps unexpected discovery failures visible', async () => {
    const fetchImpl: FetchImpl = async () => {
      throw new Error('invalid response payload');
    };
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = new OllamaProvider('http://localhost:11434', fetchImpl);

    await expect(provider.listModels()).resolves.toEqual([]);
    expect(warning).toHaveBeenCalledWith(
      '[OllamaProvider] Model discovery failed:',
      expect.any(Error),
    );
  });
});
