import { useEffect, useState } from "react";
import type { WidgetSize } from "./widgetLayout";

export function ClockWidget({ size }: { size: WidgetSize }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-4 text-center">
      <p className={`font-semibold tabular-nums tracking-tight text-text-primary ${size === "small" ? "text-4xl" : "text-5xl"}`}>
        {time}
      </p>
      <p className={`text-text-secondary ${size === "small" ? "text-xs" : "text-sm"}`}>{date}</p>
    </div>
  );
}
