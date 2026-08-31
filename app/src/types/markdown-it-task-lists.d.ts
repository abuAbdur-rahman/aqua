// markdown-it-task-lists ships no type declarations (2.1.1). Minimal shape
// for the two options Reader actually passes.
declare module "markdown-it-task-lists" {
  import type MarkdownIt from "markdown-it";
  interface TaskListsOptions {
    enabled?: boolean;
    label?: boolean;
    labelAfter?: boolean;
  }
  export default function taskLists(md: MarkdownIt, options?: TaskListsOptions): void;
}

// Prism language components are side-effect modules that register themselves on
// the core's Prism.languages map; there is no meaningful export to type.
declare module "prismjs/components/*";
