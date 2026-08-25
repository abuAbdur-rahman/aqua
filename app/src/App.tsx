import { useEffect, useState } from "react";
import { Desktop } from "./desktop/Desktop";
import { GreeterHost } from "./desktop/Greeter";
import { useBootSequence } from "./lib/useBootSequence";

function App() {
  const boot = useBootSequence();
  const [ready, setReady] = useState(false);

  // Success holds the checkmark ~150ms, then the desktop mounts underneath and
  // the Greeter cross-fades out (its exit animation).
  useEffect(() => {
    if (boot.phase !== "success") {
      setReady(false);
      return;
    }
    const timer = window.setTimeout(() => setReady(true), 150);
    return () => window.clearTimeout(timer);
  }, [boot.phase]);

  return (
    <>
      {ready ? <Desktop /> : null}
      <GreeterHost
        visible={!ready}
        phase={boot.phase}
        distro={boot.distro}
        healthUrl={boot.healthUrl}
        onRetry={boot.retry}
      />
    </>
  );
}

export default App;
