import { createWorker } from 'tesseract.js';
import type { OcrInput, OcrPipeline, TableResult } from '../types';

function preprocessAndRemoveLines(canvas: HTMLCanvasElement): number[] {
  const ctx = canvas.getContext('2d')!;
  const width = canvas.width;
  const height = canvas.height;
  
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  
  const binary = new Uint8Array(width * height);
  
  // 1. Grayscale, Kontras Tinggi (Binarization), dan Deteksi Garis
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i+1], b = data[i+2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    
    // UPGRADE: Binarization Ekstrem
    // Jika pixel lebih gelap dari 180, jadikan Hitam Pekat. Jika terang, jadikan Putih Bersih.
    // Ini sangat bagus untuk menghilangkan noise dan mempertegas teks.
    const isDark = gray < 180;
    
    data[i] = isDark ? 0 : 255;
    data[i+1] = isDark ? 0 : 255;
    data[i+2] = isDark ? 0 : 255;
    
    binary[i/4] = isDark ? 1 : 0; 
  }

  const toDelete = new Uint8Array(width * height);
  // Karena gambar sudah diperbesar 2.5x, panjang garis minimal juga harus disesuaikan
  const minLineLength = 50; 

  // Deteksi Garis Horizontal
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) {
      if (binary[y * width + x] === 1) count++;
      else {
        if (count > minLineLength) {
          for (let k = 1; k <= count; k++) toDelete[y * width + (x - k)] = 1;
        }
        count = 0;
      }
    }
    if (count > minLineLength) {
      for (let k = 1; k <= count; k++) toDelete[y * width + (width - k)] = 1;
    }
  }

  // Deteksi Garis Vertikal
  const verticalLineXs: number[] = [];
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y < height; y++) {
      if (binary[y * width + x] === 1) count++;
      else {
        if (count > minLineLength) {
          for (let k = 1; k <= count; k++) toDelete[(y - k) * width + x] = 1;
          verticalLineXs.push(x);
        }
        count = 0;
      }
    }
    if (count > minLineLength) {
      for (let k = 1; k <= count; k++) toDelete[(height - k) * width + x] = 1;
      verticalLineXs.push(x);
    }
  }

  // Hapus garis menjadi putih bersih
  for (let i = 0; i < width * height; i++) {
    if (toDelete[i] === 1) {
      const p = i * 4;
      data[p] = 255; data[p+1] = 255; data[p+2] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // Gabungkan garis vertikal yang berdekatan
  verticalLineXs.sort((a,b) => a-b);
  const mergedLines: number[] = [];
  for (const lx of verticalLineXs) {
    if (mergedLines.length === 0 || lx - mergedLines[mergedLines.length-1] > 30) {
        mergedLines.push(lx);
    }
  }
  return mergedLines;
}

export const tablePipeline: OcrPipeline = {
  async run(input: OcrInput, onProgress: (p: number) => void): Promise<TableResult> {
    onProgress(10);
    
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(input.image);
    });

    // --- UPGRADE UTAMA: UPSCALING 2.5x ---
    const scale = 2.5;
    const canvas = document.createElement('canvas');
    canvas.width = image.width * scale;
    canvas.height = image.height * scale;
    
    const ctx = canvas.getContext('2d')!;
    // Gambar ulang gambar asli ke resolusi yang lebih besar
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    // Proses hapus garis dan binarization
    const verticalLines = preprocessAndRemoveLines(canvas);
    onProgress(30);

    const worker = await createWorker(input.lang, 1, {
      langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    });

    await worker.setParameters({
      tessedit_pageseg_mode: '6', 
      preserve_interword_spaces: '1',
      load_system_dawg: '0',   
      load_freq_dawg: '0',     
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-/.,$% ' 
    });

    const cleanedBlob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((blob) => resolve(blob!), 'image/png');
    });

    const ret = await worker.recognize(cleanedBlob, {}, { text: true, blocks: true });
    onProgress(80);

    const allWords: any[] = [];
    if (ret.data.blocks) {
      for (const block of ret.data.blocks) {
        if (block.paragraphs) {
          for (const paragraph of block.paragraphs) {
            if (paragraph.lines) {
              for (const line of paragraph.lines) {
                if (line.words) {
                  for (const word of line.words) {
                    if (word.text.trim().length > 0 && word.bbox) {
                      allWords.push(word);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    const sortedWords = allWords.sort((a, b) => {
      const yDiff = a.bbox.y0 - b.bbox.y0;
      if (Math.abs(yDiff) > 35) return yDiff; // Toleransi Y diperbesar karena gambar 2.5x lebih besar
      return a.bbox.x0 - b.bbox.x0;
    });

    let rows: string[][] = [];

    if (verticalLines.length >= 2) {
        const colBounds = [0, ...verticalLines, canvas.width];
        let currentRow: string[] = new Array(colBounds.length - 1).fill("");
        let currentY = -1;

        for (const word of sortedWords) {
            if (currentY === -1 || Math.abs(word.bbox.y0 - currentY) > 35) {
                if (currentY !== -1) rows.push(currentRow);
                currentRow = new Array(colBounds.length - 1).fill("");
                currentY = word.bbox.y0;
            }
            
            const cx = (word.bbox.x0 + word.bbox.x1) / 2;
            let assigned = false;
            
            for (let i = 0; i < colBounds.length - 1; i++) {
                if (cx >= colBounds[i] - 30 && cx <= colBounds[i+1] + 30) {
                    currentRow[i] += (currentRow[i] ? " " : "") + word.text;
                    assigned = true;
                    break;
                }
            }
            if (!assigned && currentRow.length > 0) {
                currentRow[currentRow.length - 1] += " " + word.text;
            }
        }
        if (currentY !== -1) rows.push(currentRow);
    } else {
        let currentRow: { text: string, x0: number, x1: number }[] = [];
        let currentY = -1;

        for (const word of sortedWords) {
          if (currentY === -1 || Math.abs(word.bbox.y0 - currentY) > 35) {
            if (currentRow.length > 0) rows.push(mergeRowIntoColumns(currentRow));
            currentRow = [{ text: word.text, x0: word.bbox.x0, x1: word.bbox.x1 }];
            currentY = word.bbox.y0;
          } else {
            currentRow.push({ text: word.text, x0: word.bbox.x0, x1: word.bbox.x1 });
          }
        }
        if (currentRow.length > 0) rows.push(mergeRowIntoColumns(currentRow));
    }

    await worker.terminate();
    onProgress(100);

    return {
      kind: 'table',
      rows: rows,
      rawText: ret.data.text
    };
  }
};

function mergeRowIntoColumns(wordsInRow: { text: string, x0: number, x1: number }[]): string[] {
  const columns: string[] = [];
  let currentCell = "";
  let prevX1 = -1;
  for (const w of wordsInRow) {
    if (prevX1 === -1) currentCell = w.text;
    else {
      const gap = w.x0 - prevX1;
      if (gap > 100) { // Jarak gap disesuaikan karena gambar diperbesar 2.5x
        columns.push(currentCell.trim()); 
        currentCell = w.text; 
      }
      else currentCell += " " + w.text;
    }
    prevX1 = w.x1;
  }
  if (currentCell) columns.push(currentCell.trim());
  return columns;
}
