import type { WidgetSize } from "./widgetLayout";

export function CalendarWidget({ size }: { size: WidgetSize }) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: first + days }, (_, i) => (i < first ? null : i - first + 1));
  const big = size === "medium";
  const weekday = big ? "text-xs" : "text-[10px]";
  const day = big ? "text-sm" : "text-xs";
  return (
    <div className="flex h-full flex-col px-4 pb-4 pt-3.5">
      <p className={`font-semibold text-text-primary ${big ? "text-sm" : "text-xs"}`}>
        {now.toLocaleDateString([], { month: "long", year: "numeric" })}
      </p>
      <div className={`grid grid-cols-7 ${big ? "gap-1.5" : "gap-1"} ${weekday}`}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d) => (
          <span key={d} className="flex items-center justify-center text-text-tertiary">{d}</span>
        ))}
      </div>
      {/* 6 rows max; rows stretch so days space evenly no matter the card height */}
      <div className={`mt-1 grid flex-1 grid-cols-7 grid-rows-6 ${big ? "gap-1.5" : "gap-1"} ${day}`}>
        {cells.map((d, i) => (
          <span
            key={i}
            className={`flex items-center justify-center rounded-full ${d === now.getDate() ? "bg-accent font-semibold text-bg-base" : "text-text-secondary"}`}
          >
            {d ?? ""}
          </span>
        ))}
      </div>
    </div>
  );
}
