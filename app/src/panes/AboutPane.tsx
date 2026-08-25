export function AboutPane() {
  return (
    <section aria-label="About" className="max-w-md">
      <span className="block h-24 w-24 rotate-45 rounded-2xl bg-accent" aria-hidden="true" />
      <h2 className="mt-6 text-sm font-semibold text-text-primary">Aqua</h2>
      <p className="mt-1 text-xs text-text-secondary">A macOS-mannered desktop for WSL Ubuntu.</p>
    </section>
  );
}
