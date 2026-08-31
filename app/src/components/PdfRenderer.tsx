import { useEffect, useRef, useState } from "react";
import { FiChevronLeft, FiChevronRight, FiMinus, FiPlus, FiSearch } from "react-icons/fi";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

interface PdfRendererProps {
  base64: string;
  compact?: boolean;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function PdfRenderer({ base64, compact = false }: PdfRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const documentRef = useRef<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<import("pdfjs-dist").RenderTask | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [zoom, setZoom] = useState(compact ? 0.55 : 1.15);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let disposed = false;
    void import("pdfjs-dist").then(async (pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const document = await pdfjs.getDocument({ data: decodeBase64(base64) }).promise;
      if (disposed) {
        await (document as unknown as { destroy: () => Promise<void> }).destroy();
        return;
      }
      documentRef.current = document;
      setPages(document.numPages);
      setPage(1);
      setStatus("ready");
    }).catch(() => {
      if (!disposed) setStatus("error");
    });
    return () => {
      disposed = true;
      renderTaskRef.current?.cancel();
      void (documentRef.current as unknown as { destroy?: () => Promise<void> })?.destroy?.();
      documentRef.current = null;
    };
  }, [base64]);

  useEffect(() => {
    const document = documentRef.current;
    const canvas = canvasRef.current;
    if (!document || !canvas || status !== "ready") return;
    let disposed = false;
    renderTaskRef.current?.cancel();
    void document.getPage(page).then((pdfPage) => {
      if (disposed) return;
      const viewport = pdfPage.getViewport({ scale: zoom });
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      const task = pdfPage.render({ canvas, canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      renderTaskRef.current = task;
      void task.promise.catch((cause: unknown) => {
        if (!disposed && cause instanceof Error && cause.name !== "RenderingCancelledException") setStatus("error");
      });
    });
    return () => {
      disposed = true;
      renderTaskRef.current?.cancel();
    };
  }, [page, status, zoom]);

  const find = async () => {
    const document = documentRef.current;
    const needle = query.trim().toLowerCase();
    if (!document || !needle) return;
    for (let index = 1; index <= document.numPages; index += 1) {
      const pdfPage = await document.getPage(index);
      const text = await pdfPage.getTextContent();
      const value = text.items.map((item) => "str" in item ? item.str : "").join(" ").toLowerCase();
      if (value.includes(needle)) {
        setPage(index);
        return;
      }
    }
  };

  if (status === "loading") return <div className="h-72 animate-pulse rounded-card bg-bg-hover/50" aria-label="Loading PDF" />;
  if (status === "error") return <div className="p-6 text-center text-status-danger" role="alert">This PDF couldn&apos;t be rendered.</div>;

  return (
    <div className="flex min-h-0 flex-col items-center gap-3">
      {!compact && (
        <div className="sticky top-0 z-10 flex w-full flex-wrap items-center justify-center gap-1 border-b border-bg-hover bg-bg-elevated/95 p-2 backdrop-blur">
          <button aria-label="Previous page" disabled={page <= 1} className="rounded p-1.5 hover:bg-bg-hover disabled:opacity-40" onClick={() => setPage((value) => Math.max(1, value - 1))}><FiChevronLeft /></button>
          <span className="min-w-24 text-center text-[11px] text-text-secondary">Page {page} of {pages}</span>
          <button aria-label="Next page" disabled={page >= pages} className="rounded p-1.5 hover:bg-bg-hover disabled:opacity-40" onClick={() => setPage((value) => Math.min(pages, value + 1))}><FiChevronRight /></button>
          <div className="mx-1 h-4 w-px bg-bg-hover" />
          <button aria-label="Zoom out" className="rounded p-1.5 hover:bg-bg-hover" onClick={() => setZoom((value) => Math.max(0.5, value - 0.15))}><FiMinus /></button>
          <span className="w-12 text-center text-[11px] text-text-secondary">{Math.round(zoom * 100)}%</span>
          <button aria-label="Zoom in" className="rounded p-1.5 hover:bg-bg-hover" onClick={() => setZoom((value) => Math.min(2.5, value + 0.15))}><FiPlus /></button>
          <form className="ml-2 flex items-center rounded-card bg-bg-surface px-2" onSubmit={(event) => { event.preventDefault(); void find(); }}>
            <FiSearch className="text-text-tertiary" aria-hidden="true" />
            <input aria-label="Find in PDF" value={query} onChange={(event) => setQuery(event.target.value)} className="input-bare w-32 bg-transparent px-2 py-1 text-[11px] text-text-primary" />
          </form>
        </div>
      )}
      <canvas ref={canvasRef} className="max-w-full bg-white shadow-[0_8px_30px_rgba(0,0,0,0.35)]" aria-label={`PDF page ${page} of ${pages}`} />
      {compact && pages > 0 && <span className="rounded-full bg-bg-elevated px-2 py-0.5 text-[10px] text-text-secondary">{pages} {pages === 1 ? "page" : "pages"}</span>}
    </div>
  );
}

export default PdfRenderer;
