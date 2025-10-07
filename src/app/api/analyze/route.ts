export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import Tesseract from "tesseract.js";
import { parseLabText, formatReport } from "@/lib/report";

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
];

const UploadSchema = z.object({
  file: z.instanceof(Blob),
});

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  try {
    const mod: unknown = await import("pdf-parse");

    function isCallable(fn: unknown): fn is (buf: Buffer) => Promise<{ text?: string }> {
      return typeof fn === "function";
    }

    function getPdfParse(m: unknown): (buf: Buffer) => Promise<{ text?: string }> {
      if (isCallable(m)) return m;
      if (typeof m === "object" && m !== null && "default" in (m as Record<string, unknown>)) {
        const d = (m as { default: unknown }).default;
        if (isCallable(d)) return d;
      }
      throw new Error("pdf-parse module not callable");
    }

    const pdfParse = getPdfParse(mod);
    const data = await pdfParse(buffer);
    return data?.text || "";
  } catch {
    return "";
  }
}

async function extractTextFromImage(buffer: Buffer): Promise<string> {
  const { data } = await Tesseract.recognize(buffer, "eng+tur");
  return data.text || "";
}


export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file");

  const parsed = UploadSchema.safeParse({ file });
  if (!parsed.success) {
    return NextResponse.json({ error: "Dosya gerekli" }, { status: 400 });
  }

  const blob = parsed.data.file as Blob;
  if (blob.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "Dosya boyutu 10MB'ı aşmamalı" }, { status: 400 });
  }

  const type = blob.type;
  if (!ACCEPTED_TYPES.includes(type)) {
    return NextResponse.json({ error: "Yalnızca PDF, JPG, PNG kabul edilir" }, { status: 400 });
  }

  const arrayBuffer = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  let text = "";
  if (type === "application/pdf") {
    text = await extractTextFromPdf(buffer);
  } else {
    text = await extractTextFromImage(buffer);
  }

  if (!text.trim()) {
    return NextResponse.json({ error: "Metin çıkarılamadı. Lütfen daha net bir rapor deneyin." }, { status: 422 });
  }

  const parsedTests = parseLabText(text);
  if (parsedTests.length === 0) {
    // Fallback: return raw text for debugging UI
    return NextResponse.json({ report: formatReport([]), rawText: text });
  }

  const report = formatReport(parsedTests);
  return NextResponse.json({ report, rawText: text });
}


