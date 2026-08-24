import { create } from "zustand";

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}

export interface ElevateRequest {
  appName: string;
  detail: string;
  userName?: string;
  onSuccess: () => void;
}

export interface PromptRequest {
  title: string;
  label?: string;
  initialValue?: string;
  submitLabel?: string;
  onSubmit: (value: string) => void;
}

interface ModalState {
  confirm: (ConfirmRequest & { open: true }) | null;
  requestConfirm: (request: ConfirmRequest) => void;
  closeConfirm: () => void;
  elevate: (ElevateRequest & { open: true }) | null;
  requestElevate: (request: ElevateRequest) => void;
  closeElevate: () => void;
  prompt: (PromptRequest & { open: true }) | null;
  requestPrompt: (request: PromptRequest) => void;
  closePrompt: () => void;
}

export const useModalStore = create<ModalState>((set) => ({
  confirm: null,
  requestConfirm: (request) => set({ confirm: { ...request, open: true } }),
  closeConfirm: () => set({ confirm: null }),
  elevate: null,
  requestElevate: (request) => set({ elevate: { ...request, open: true } }),
  closeElevate: () => set({ elevate: null }),
  prompt: null,
  requestPrompt: (request) => set({ prompt: { ...request, open: true } }),
  closePrompt: () => set({ prompt: null }),
}));
