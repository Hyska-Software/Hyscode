export { TuiBridge } from './bridge';
export { CliDataStore } from './data-store';
export { SharedConfigStore, SharedKeyStore } from './config';
export { CliHost } from './host';
export { findTheme, loadThemeCatalog, normalizeThemeId } from './themes';
export { BUILTIN_THEMES, DEFAULT_THEME_ID } from '@hyscode/theme';
export type {
  BridgeEvent,
  BridgeMessage,
  BridgeRequest,
  BridgeResponse,
  ContextAttachment,
  ContextStatePayload,
  DiagnosticPayload,
  FileChangeState,
  GitSummary,
  HostRequestPayload,
  InteractionRequest,
  InteractionResolution,
  ProjectSummary,
  ProviderSummary,
  RuntimeReadyPayload,
  RuntimeCapabilities,
  ScopedHarnessEventPayload,
  SddStatePayload,
  SendMessageParams,
  SessionRecord,
  SessionMessage,
  SessionSummary,
  SetConfigParams,
  TerminalSummary,
} from './protocol';
export type { ThemeSummary } from '@hyscode/theme';
