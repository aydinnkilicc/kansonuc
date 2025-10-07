declare module 'pdfjs-dist/build/pdf' {
  export interface PDFViewport { width: number; height: number }
  export interface PDFPageProxy {
    getViewport(params: { scale: number }): PDFViewport;
    render(params: { canvasContext: CanvasRenderingContext2D; viewport: PDFViewport }): { promise: Promise<void> };
  }
  export interface PDFDocumentProxy {
    numPages: number;
    getPage(pageNumber: number): Promise<PDFPageProxy>;
  }
  export const GlobalWorkerOptions: { workerSrc: string };
  export function getDocument(args: { data: ArrayBuffer }): { promise: Promise<PDFDocumentProxy> };
}


