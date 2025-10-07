export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import Tesseract from "tesseract.js";

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

function parseLabText(rawText: string) {
  // Very lightweight heuristic parser: lines of "Test Name ... value unit (ref)"
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const results: Array<{
    name: string;
    short?: string;
    value?: number;
    unit?: string;
    refLow?: number;
    refHigh?: number;
  }> = [];

  const pattern = /^(.*?)(?:\s*\(([A-Za-z0-9\.\-]+)\))?\s*[:\-\t ]+([\d.,]+)\s*([a-zA-Z%\/\^\-]+)?\s*(?:\(\s*([\d.,]+)\s*[-–]\s*([\d.,]+)\s*([a-zA-Z%\/\^\-]+)?\s*\))?$/;

  for (const line of lines) {
    const m = line.match(pattern);
    if (!m) continue;
    const [, name, short, valueStr, unit, lowStr, highStr] = m;
    const value = valueStr ? Number(valueStr.replace(",", ".")) : undefined;
    const refLow = lowStr ? Number(lowStr.replace(",", ".")) : undefined;
    const refHigh = highStr ? Number(highStr.replace(",", ".")) : undefined;
    results.push({ name: name.trim(), short, value, unit, refLow, refHigh });
  }

  return results;
}

function riskEmoji(value?: number, low?: number, high?: number): { emoji: string; label: string } {
  if (value == null || low == null || high == null) return { emoji: "🟢", label: "Normal" };
  if (value < low) return { emoji: "🟡", label: "Hafif Düzeyde" };
  if (value > high) return { emoji: "🟡", label: "Hafif Düzeyde" };
  return { emoji: "🟢", label: "Normal" };
}

function friendlyMeaning(name: string) {
  const key = name.toLowerCase();
  if (key.includes("hemoglobin") || key.includes("hgb")) {
    return {
      meaning: "Hemoglobin, kanın oksijen taşımasına yardım eden temel proteindir.",
      metaphor: "Hemoglobin, şehrinize oksijen paketleri taşıyan kargo kamyonlarıdır.",
    };
  }
  if (key.includes("wbc") || key.includes("beyaz")) {
    return {
      meaning: "Beyaz kan hücreleri, vücudu mikroplara karşı savunan hücrelerdir.",
      metaphor: "Beyaz kan hücreleri, kaleyi koruyan nöbetçi askerlerdir.",
    };
  }
  return {
    meaning: "Bu test, vücudunuzdaki belirli bir işlevi veya dengeyi gösterir.",
    metaphor: "Bu değer, vücudunuzun kontrol panelindeki bir gösterge gibidir.",
  };
}

function formatReport(parsed: ReturnType<typeof parseLabText>) {
  const sections: string[] = [];
  for (const item of parsed) {
    const fullName = item.name;
    const short = item.short ? ` (${item.short})` : "";
    const valueStr = item.value != null ? String(item.value) : "-";
    const unitStr = item.unit ? ` ${item.unit}` : "";
    const refStr = item.refLow != null && item.refHigh != null ? `${item.refLow} - ${item.refHigh}${item.unit ? " " + item.unit : ""}` : "-";
    const risk = riskEmoji(item.value, item.refLow, item.refHigh);
    const { meaning, metaphor } = friendlyMeaning(fullName + (item.short ? ` ${item.short}` : ""));

    const isOut =
      item.value != null && item.refLow != null && item.refHigh != null && (item.value < item.refLow || item.value > item.refHigh);
    const patientLine = isOut
      ? `Değeriniz referans aralığının ${item.value! < item.refLow! ? "altında" : "üstünde"}. Bu durumu doktorunuzla daha detaylı değerlendirmeniz önemlidir.`
      : "Değeriniz referans aralığı içinde.";

    sections.push(
      `${fullName}${short}\n` +
        `Sonuç: ${valueStr}${unitStr} (Referans Aralığı: ${refStr})\n` +
        `Risk Düzeyi: ${risk.emoji} ${risk.label}\n` +
        `Bu Değer Ne Anlama Geliyor?\n` +
        `${meaning}\n` +
        `Sizin İçin Anlamı:\n` +
        `${patientLine}\n` +
        `Basitçe Anlatmak Gerekirse:\n` +
        `"${metaphor}"\n`
    );
  }

  const summary =
    "\n🩺 Genel Değerlendirme ve Yol Haritası\n" +
    "1. Sade Hasta Özeti:\n" +
    "Sonuçlarınız genel bir değerlendirmeden geçirilmiştir. Referans dışı değerler varsa, ilgili testlerde belirtilmiştir.\n\n" +
    "2. Önerilen Adımlar:\n" +
    "- Bu raporu doktorunuzla paylaşın ve klinik bulgularla birlikte değerlendirin.\n" +
    "- Gerekirse hekim ek testler planlayabilir veya yaşam tarzı önerilerinde bulunabilir.\n\n" +
    "Bu analiz tıbbi bir tanı niteliği taşımaz ve yalnızca bilgilendirme amaçlıdır. Sağlığınızla ilgili tüm kararlar için mutlaka bir hekime danışmanız gerekmektedir.";

  return sections.join("\n") + "\n" + summary;
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


