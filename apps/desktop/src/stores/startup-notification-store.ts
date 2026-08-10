import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface StartupNotificationState {
  /** When true, the startup notification is hidden forever (user opted out). */
  dismissedForever: boolean;
  /** Dismiss for this session only (close button). */
  sessionDismissed: boolean;

  dismissForSession: () => void;
  dismissForever: () => void;
}

export const useStartupNotificationStore = create<StartupNotificationState>()(
  persist(
    (set) => ({
      dismissedForever: false,
      sessionDismissed: false,

      dismissForSession: () => set({ sessionDismissed: true }),
      dismissForever: () => set({ dismissedForever: true, sessionDismissed: true }),
    }),
    {
      name: 'hyscode-startup-notification',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ dismissedForever: state.dismissedForever }),
    },
  ),
);
