import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface OnboardingState {
  hasCompletedOnboarding: boolean;
  currentStep: number;

  completeOnboarding: () => void;
  skipOnboarding: () => void;
  setStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  resetOnboarding: () => void;
}

export const ONBOARDING_TOTAL_STEPS = 5;

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      hasCompletedOnboarding: false,
      currentStep: 0,

      completeOnboarding: () => set({ hasCompletedOnboarding: true }),
      skipOnboarding: () => set({ hasCompletedOnboarding: true }),
      setStep: (step) => set({ currentStep: step }),
      nextStep: () => {
        const { currentStep } = get();
        if (currentStep < ONBOARDING_TOTAL_STEPS - 1) {
          set({ currentStep: currentStep + 1 });
        }
      },
      prevStep: () => {
        const { currentStep } = get();
        if (currentStep > 0) set({ currentStep: currentStep - 1 });
      },
      resetOnboarding: () => set({ hasCompletedOnboarding: false, currentStep: 0 }),
    }),
    {
      name: 'hyscode-onboarding',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
