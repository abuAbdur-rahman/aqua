import { beforeEach, describe, expect, it } from "vitest";
import { useModalStore } from "./modalStore";

beforeEach(() => {
  useModalStore.setState({ confirm: null, elevate: null, prompt: null });
});

describe("modalStore confirm", () => {
  it("requestConfirm stores the request and opens the modal", () => {
    const onConfirm = () => {};
    useModalStore.getState().requestConfirm({
      title: "Restart the daemon?",
      body: "Open terminal sessions will end.",
      confirmLabel: "Restart",
      danger: true,
      onConfirm,
    });

    const confirm = useModalStore.getState().confirm;
    expect(confirm).toEqual({
      open: true,
      title: "Restart the daemon?",
      body: "Open terminal sessions will end.",
      confirmLabel: "Restart",
      danger: true,
      onConfirm,
    });
  });

  it("closeConfirm clears the modal", () => {
    useModalStore.getState().requestConfirm({
      title: "t",
      body: "b",
      confirmLabel: "ok",
      onConfirm: () => {},
    });
    useModalStore.getState().closeConfirm();
    expect(useModalStore.getState().confirm).toBeNull();
  });
});

describe("modalStore elevate", () => {
  it("requestElevate stores app name and detail", () => {
    const onSuccess = () => {};
    useModalStore.getState().requestElevate({
      appName: "Finder",
      detail: "Deleting “/etc/hosts”",
      onSuccess,
    });

    const elevate = useModalStore.getState().elevate;
    expect(elevate).toMatchObject({ open: true, appName: "Finder", detail: "Deleting “/etc/hosts”", onSuccess });
  });

  it("closeElevate clears the modal", () => {
    useModalStore.getState().requestElevate({
      appName: "Finder",
      detail: "d",
      onSuccess: () => {},
    });
    useModalStore.getState().closeElevate();
    expect(useModalStore.getState().elevate).toBeNull();
  });
});

describe("modalStore prompt", () => {
  it("requestPrompt stores title and initial value", () => {
    const onSubmit = () => {};
    useModalStore.getState().requestPrompt({
      title: "Rename",
      label: "New name",
      initialValue: "notes.txt",
      submitLabel: "Rename",
      onSubmit,
    });

    const prompt = useModalStore.getState().prompt;
    expect(prompt).toMatchObject({ open: true, title: "Rename", initialValue: "notes.txt", onSubmit });
  });

  it("closePrompt clears the modal", () => {
    useModalStore.getState().requestPrompt({ title: "t", onSubmit: () => {} });
    useModalStore.getState().closePrompt();
    expect(useModalStore.getState().prompt).toBeNull();
  });
});
