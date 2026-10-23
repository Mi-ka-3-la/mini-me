import { create } from 'zustand';
import { KEYS, readString, remove, writeString } from '../lib/storage';

type AuthState = {
  passcode: string | null;
  /** The user chose "Continue without analysis". */
  skipped: boolean;
  /** Set when the server later answers 401 (ADR-15). */
  rejected: boolean;
  save: (passcode: string) => void;
  skip: () => void;
  signOut: () => void;
  markRejected: () => void;
  reopenGate: () => void;
};

export const useAuth = create<AuthState>((set) => ({
  passcode: readString(KEYS.passcode),
  skipped: readString(KEYS.passcodeSkipped) === '1',
  rejected: false,
  save: (passcode) => {
    writeString(KEYS.passcode, passcode);
    remove(KEYS.passcodeSkipped);
    set({ passcode, skipped: false, rejected: false });
  },
  skip: () => {
    writeString(KEYS.passcodeSkipped, '1');
    set({ skipped: true });
  },
  signOut: () => {
    remove(KEYS.passcode);
    remove(KEYS.passcodeSkipped);
    set({ passcode: null, skipped: false, rejected: false });
  },
  markRejected: () => set({ rejected: true }),
  reopenGate: () => {
    remove(KEYS.passcodeSkipped);
    set({ skipped: false, passcode: null, rejected: false });
  },
}));
