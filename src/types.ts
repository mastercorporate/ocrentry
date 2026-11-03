export type OcrMode = 'text' | 'table';

export interface OcrInput {
  image: Blob;
  lang: string; // Ubah menjadi string agar bisa menerima 'ind+eng'
}

export interface TextResult {
  kind: 'text';
  text: string;
  confidence: number;
}

export interface TableResult {
  kind: 'table';
  rows: string[][]; // Array 2 Dimensi [Baris][Kolom]
  rawText?: string;
}

export type OcrResult = TextResult | TableResult;

export interface OcrPipeline {
  run(input: OcrInput, onProgress: (p: number) => void): Promise<OcrResult>;
}