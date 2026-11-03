import { createWorker, type Worker } from 'tesseract.js';
import type { OcrInput, OcrPipeline, TextResult } from '../types';

let workerPromise: Promise<Worker> | null = null;
let loadedLang: string | null = null;

async function getWorker(lang: string): Promise<Worker> {
  if (!workerPromise || loadedLang !== lang) {
    if (workerPromise) {
      const oldWorker = await workerPromise;
      await oldWorker.terminate();
    }
    workerPromise = createWorker(lang, 1, {
      langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    });
    loadedLang = lang;
  }
  return workerPromise;
}

export const textPipeline: OcrPipeline = {
  async run(input: OcrInput, onProgress: (p: number) => void): Promise<TextResult> {
    onProgress(5);
    const worker = await getWorker(input.lang);
    onProgress(20);

    const ret = await worker.recognize(input.image, {}, { text: true });
    onProgress(100);

    return {
      kind: 'text',
      text: ret.data.text,
      confidence: ret.data.confidence ?? 0,
    };
  },
};