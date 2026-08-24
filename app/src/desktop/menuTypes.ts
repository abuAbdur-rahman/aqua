export interface AppMenuItem {
  id: string;
  label: string;
  shortcut?: string;
  onSelect: () => void;
  enabled?: boolean;
  separatorAfter?: boolean;
}

export interface AppMenuGroup {
  label: string;
  items: AppMenuItem[];
}
