import { ConfirmModal } from "./ConfirmModal";
import { ElevateModal } from "./ElevateModal";
import { FilePickerModal } from "./FilePickerModal";
import { PromptModal } from "./PromptModal";

// Mounted once at the desktop root; every app and the System Menu route
// through the shared store rather than rendering their own dialogs.
export function ModalHost() {
  return (
    <>
      <ConfirmModal />
      <ElevateModal />
      <PromptModal />
      <FilePickerModal />
    </>
  );
}
