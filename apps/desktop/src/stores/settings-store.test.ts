import { describe, expect, it } from 'vitest';

import { SETTINGS_DEFAULTS } from './settings-store-defaults';
import { migrateSettingsState } from './settings-store';

describe('agent interaction limit settings', () => {
  it('starts disabled for new installations', () => {
    expect(SETTINGS_DEFAULTS.interactionLimitEnabled).toBe(false);
    expect(SETTINGS_DEFAULTS.maxIterations).toBe(25);
  });

  it('disables the limit when migrating legacy persisted settings', () => {
    const migrated = migrateSettingsState({ maxIterations: 75 }, 0) as Record<string, unknown>;

    expect(migrated.maxIterations).toBe(75);
    expect(migrated.interactionLimitEnabled).toBe(false);
  });

  it('preserves the explicit setting after the migration version', () => {
    const migrated = migrateSettingsState(
      { interactionLimitEnabled: true, maxIterations: 40 },
      1,
    ) as Record<string, unknown>;

    expect(migrated.interactionLimitEnabled).toBe(true);
    expect(migrated.maxIterations).toBe(40);
  });
});
