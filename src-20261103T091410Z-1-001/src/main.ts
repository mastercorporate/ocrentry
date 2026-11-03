import './style.css';
import type { OcrMode } from './types';
import { textPipeline } from './pipelines/textPipeline';
import { tablePipeline } from './pipelines/tablePipeline';

// 1. Ambil semua elemen HTML
const preview = document.getElementById('preview') as HTMLImageElement;
const statusEl = document.getElementById('status') as HTMLParagraphElement;
const resultText = document.getElementById('result-text') as HTMLTextAreaElement;
const resultContainer = document.getElementById('result-container') as HTMLDivElement;
const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
const processBtn = document.getElementById('process-btn') as HTMLButtonElement;
const modeRadios = document.querySelectorAll<HTMLInputElement>('input[name="mode"]');
const pasteBtn = document.getElementById('paste-btn') as HTMLButtonElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const langSelect = document.getElementById('lang-select') as HTMLSelectElement;
const tableResultContainer = document.getElementById('table-result-container') as HTMLDivElement;
const resultTable = document.getElementById('result-table') as HTMLTableElement;
const downloadCsvBtn = document.getElementById('download-csv-btn') as HTMLButtonElement;
const copyTableBtn = document.getElementById('copy-table-btn') as HTMLButtonElement;

let currentMode: OcrMode = 'text';
let currentBlob: Blob | null = null;

// Fungsi untuk menampilkan gambar ke layar
function showImage(blob: Blob) {
  currentBlob = blob;
  preview.src = URL.createObjectURL(blob);
  preview.style.display = 'block';
  statusEl.textContent = 'Gambar siap. Klik "Proses OCR" untuk memulai.';
  statusEl.style.color = '#0066cc';
}

// 2. Logika Pilih Mode
modeRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    currentMode = radio.value as OcrMode;
    statusEl.textContent = `Mode diubah ke: ${currentMode === 'text' ? 'Teks' : 'Tabel'}`;
  });
});

// 3. Logika Input File
fileInput.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) showImage(file);
});

// 4. Logika Paste dari Clipboard (Tombol)
pasteBtn.addEventListener('click', async () => {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith('image/')) {
          const blob = await item.getType(type);
          showImage(blob);
          return;
        }
      }
    }
    statusEl.textContent = 'Tidak ada gambar di clipboard.';
  } catch (err: unknown) {
    alert("Browser memblokir akses clipboard. Gunakan 'Pilih File'. Error: " + (err as Error).message);
  }
});

// 5. Logika Ctrl+V langsung
window.addEventListener('paste', (e: ClipboardEvent) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const blob = item.getAsFile();
      if (blob) { showImage(blob); return; }
    }
  }
});

// 6. Logika Klik Tombol Proses
processBtn.addEventListener('click', async () => {
  if (!currentBlob) {
    statusEl.textContent = 'Tempelkan gambar atau pilih file terlebih dahulu!';
    statusEl.style.color = 'red';
    return;
  }
  
  processBtn.disabled = true;
  statusEl.textContent = 'Memproses...';
  statusEl.style.color = '#cc6600';
  resultContainer.style.display = 'none';
  tableResultContainer.style.display = 'none';

  const pipeline = currentMode === 'text' ? textPipeline : tablePipeline;
  const selectedLang = langSelect ? langSelect.value : 'ind+eng';

  try {
    const result = await pipeline.run({ image: currentBlob, lang: selectedLang }, (p) => {
      statusEl.textContent = `Memproses... ${p}%`;
    });

    if (result.kind === 'text') {
      resultText.value = result.text;
      statusEl.textContent = `Selesai! Confidence: ${result.confidence.toFixed(1)}%`;
      statusEl.style.color = 'green';
      resultContainer.style.display = 'block';
      
    } else if (result.kind === 'table') {
      statusEl.textContent = `Selesai! Ditemukan ${result.rows.length} baris data tabel.`;
      statusEl.style.color = 'green';
      
      const thead = resultTable.querySelector('thead')!;
      const tbody = resultTable.querySelector('tbody')!;
      thead.innerHTML = '';
      tbody.innerHTML = '';

      if (result.rows.length > 0) {
        const totalCols = result.rows[0].length;
        
        // Cari kolom yang isinya kosong semua
        const emptyCols = [];
        for (let c = 0; c < totalCols; c++) {
          let hasData = false;
          for (let r = 0; r < result.rows.length; r++) {
            if (result.rows[r][c] && result.rows[r][c].trim() !== '') {
              hasData = true; break;
            }
          }
          if (!hasData) emptyCols.push(c);
        }

        // Render Header (Mode Read-Only, double click untuk edit)
        const headerRow = document.createElement('tr');
        result.rows[0].forEach((cellText, index) => {
          if (emptyCols.includes(index)) return;
          const th = document.createElement('th');
          th.textContent = cellText;
          th.style.padding = '8px';
          th.style.backgroundColor = '#f4f4f4';
          th.style.cursor = 'cell'; // Kursor seperti Excel
          
          // FITUR DOUBLE CLICK UNTUK EDIT
          th.addEventListener('dblclick', () => makeEditable(th));
          
          headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);

        // Render Body (Mode Read-Only, double click untuk edit)
        for (let i = 1; i < result.rows.length; i++) {
          const tr = document.createElement('tr');
          result.rows[i].forEach((cellText, index) => {
            if (emptyCols.includes(index)) return;
            const td = document.createElement('td');
            td.textContent = cellText;
            td.style.padding = '8px';
            td.style.cursor = 'cell'; // Kursor seperti Excel
            
            // FITUR DOUBLE CLICK UNTUK EDIT
            td.addEventListener('dblclick', () => makeEditable(td));
            
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        }
      }
      tableResultContainer.style.display = 'block';
    }
  } catch (err: unknown) {
    statusEl.textContent = `Error: ${(err as Error).message}`;
    statusEl.style.color = 'red';
  } finally {
    processBtn.disabled = false;
  }
});

// 7. Logika Copy Teks Biasa
copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(resultText.value);
  statusEl.textContent = 'Teks disalin!';
  statusEl.style.color = 'green';
});

// 8. Logika Download CSV
downloadCsvBtn.addEventListener('click', () => {
  const table = document.getElementById('result-table') as HTMLTableElement;
  const rows = table.querySelectorAll('tr');
  let csvContent = "";

  rows.forEach(row => {
    const cols = row.querySelectorAll('th, td');
    const rowData: string[] = [];
    cols.forEach(col => {
      const text = (col.textContent || '').trim().replace(/"/g, '""'); 
      rowData.push(`"${text}"`);
    });
    csvContent += rowData.join(",") + "\n";
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', 'data_tabel.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

// 9. Logika Copy Seluruh Tabel ke Excel (Format TSV)
copyTableBtn.addEventListener('click', async () => {
  const table = document.getElementById('result-table') as HTMLTableElement;
  const rows = table.querySelectorAll('tr');
  let tsvContent = "";

  rows.forEach(row => {
    const cols = row.querySelectorAll('th, td');
    const rowData: string[] = [];
    
    cols.forEach(col => {
      const text = (col.textContent || '').trim().replace(/[\n\r\t]/g, " ");
      rowData.push(text);
    });
    
    tsvContent += rowData.join("\t") + "\n";
  });

  try {
    await navigator.clipboard.writeText(tsvContent);
    statusEl.textContent = 'Tabel berhasil disalin! Silakan Paste (Cmd+V) di Excel.';
    statusEl.style.color = 'green';
  } catch (err) {
    statusEl.textContent = 'Gagal menyalin tabel ke clipboard.';
    statusEl.style.color = 'red';
  }
});

// ==========================================
// FITUR TAMBAHAN: KLIK 2X UNTUK EDIT & DRAG UNTUK COPY
// ==========================================

// Fungsi membuat sel bisa diedit saat diklik 2 kali
function makeEditable(cell: HTMLElement) {
  cell.contentEditable = 'true';
  cell.style.backgroundColor = '#e0f7fa'; // Beri warna biru muda tanda sedang edit
  cell.focus();
  
  // Blok semua teks di dalam sel agar langsung bisa ditimpa
  const range = document.createRange();
  range.selectNodeContents(cell);
  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
  
  // Jika user klik di luar sel, kunci kembali (Read-Only)
  cell.onblur = () => {
    cell.contentEditable = 'false';
    cell.style.backgroundColor = 'transparent';
  };
}

// Fungsi Custom Copy (Menangkap saat user melakukan drag/blok)
document.addEventListener('copy', (e: ClipboardEvent) => {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;

  const table = document.getElementById('result-table');
  if (!table) return;

  const range = selection.getRangeAt(0);
  
  // Pastikan yang diseleksi benar-benar berada di dalam tabel hasil
  if (!table.contains(range.commonAncestorContainer)) return;

  const rows = table.querySelectorAll('tr');
  let tsvContent = "";
  let hasSelectedCell = false;

  // Looping setiap baris untuk melihat mana yang tersorot (diblok)
  rows.forEach(row => {
    if (range.intersectsNode(row)) {
      const cols = row.querySelectorAll('th, td');
      let rowData: string[] = [];
      
      cols.forEach(col => {
        if (range.intersectsNode(col)) {
          hasSelectedCell = true;
          // Ambil teks dan bersihkan enter yang tidak perlu
          rowData.push((col.textContent || '').trim().replace(/[\n\r\t]/g, " "));
        }
      });

      if (rowData.length > 0) {
        tsvContent += rowData.join("\t") + "\n"; // Gabung dengan Tab
      }
    }
  });

  // Jika ada sel yang tersorot, timpa clipboard dengan format TSV kita
  if (hasSelectedCell && tsvContent) {
    e.clipboardData?.setData('text/plain', tsvContent);
    e.preventDefault(); // Cegah copy bawaan browser yang berantakan
    
    statusEl.textContent = 'Baris terpilih berhasil disalin! Silakan Paste.';
    statusEl.style.color = 'green';
  }
});