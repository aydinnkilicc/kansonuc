"use client";
import { useState } from "react";
import { parseLabText, formatReport } from "@/lib/report";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<string>("");
  const [rawText, setRawText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [localProcess, setLocalProcess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setReport("");
    setRawText("");
    if (!file) {
      setError("Lütfen bir dosya seçin.");
      return;
    }
    setLoading(true);
    try {
      if (localProcess && file.type === "application/pdf") {
        // Client-side PDF OCR fallback: render pages to image and OCR
        const pdfjsLib = (await import("pdfjs-dist")) as unknown as {
          GlobalWorkerOptions: { workerSrc: string };
          getDocument: (args: { data: ArrayBuffer }) => { promise: any };
        };
        // Ensure PDF.js worker can load on Vercel by using a CDN worker script
        // Version must match installed pdfjs-dist
        pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        const { getDocument } = pdfjsLib;
        const pdfjs = await getDocument({ data: await file.arrayBuffer() }).promise;
        let combinedText = "";
        const { createWorker } = await import("tesseract.js");
        const worker = await createWorker("eng+tur");
        for (let i = 1; i <= pdfjs.numPages; i++) {
          const page = await pdfjs.getPage(i);
          const viewport = page.getViewport({ scale: 2 });
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvasContext: ctx as CanvasRenderingContext2D, viewport }).promise;
          const { data } = await worker.recognize(canvas);
          combinedText += "\n" + (data.text || "");
        }
        await worker.terminate();
        const parsed = parseLabText(combinedText);
        setReport(formatReport(parsed));
        setRawText(combinedText);
      } else {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/analyze", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "İşlem başarısız");
        setReport(data.report || "");
        setRawText(data.rawText || "");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Beklenmeyen bir hata oluştu";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen p-6 sm:p-10 flex flex-col items-center">
      <div className="max-w-3xl w-full">
        <h1 className="text-2xl sm:text-3xl font-semibold mb-2">AI Klinik Patolog</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-6">
          Kan tahlili raporunuzu (PDF, JPG, PNG) yükleyin. Raporunuz, insan dostu ve şefkatli bir dille çözümlensin.
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
          />
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input type="checkbox" checked={localProcess} onChange={(e) => setLocalProcess(e.target.checked)} />
            Dosyayı cihazımda işle (özellikle resim/PDF OCR için)
          </label>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 rounded-md bg-black text-white disabled:opacity-60"
          >
            {loading ? "Analiz ediliyor..." : "Analiz Et"}
          </button>
        </form>

        {error && (
          <div className="mt-4 text-red-600 text-sm">{error}</div>
        )}

        {report && (
          <div className="mt-8">
            <h2 className="text-xl font-semibold mb-3">Analiz Raporu</h2>
            <pre className="whitespace-pre-wrap bg-gray-50 dark:bg-gray-900 p-4 rounded-md text-sm">
              {report}
            </pre>
          </div>
        )}

        {rawText && (
          <details className="mt-6">
            <summary className="cursor-pointer text-sm text-gray-600 dark:text-gray-300">Çıkarılan Ham Metin (geliştirici görünümü)</summary>
            <pre className="whitespace-pre-wrap bg-gray-50 dark:bg-gray-900 p-4 rounded-md text-xs mt-2">
              {rawText}
            </pre>
          </details>
        )}

        <p className="mt-10 text-xs text-gray-500">
          Bu analiz tıbbi bir tanı niteliği taşımaz ve yalnızca bilgilendirme amaçlıdır. Sağlığınızla ilgili tüm kararlar için mutlaka bir hekime danışmanız gerekmektedir.
        </p>
      </div>
    </div>
  );
}
