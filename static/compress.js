/* Cramly compress: squeezes what you picked before it uploads. Photos are shrunk, big text files are gzipped, and a PDF has
   its text pulled out right in the browser (pdf.js), so a huge PDF uploads as a few hundred KB. If anything goes wrong the
   original file is sent instead, and the server reads it the normal way. */
"use strict";

const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
const TEXTY = /\.(txt|md|csv|srt|vtt)$/i, IMGX = /\.(png|jpe?g|webp|gif)$/i, PDFX = /\.pdf$/i;
let pdfjsReady = null;

function loadPdfJs() {
  pdfjsReady ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `${PDFJS}pdf.min.js`;
    s.onload = async () => {
      try {
        const code = await (await fetch(`${PDFJS}pdf.worker.min.js`)).text();       // a worker must come from our own origin, so wrap it in a blob
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
        resolve(window.pdfjsLib);
      } catch (e) { reject(e); }
    };
    s.onerror = () => reject(new Error("pdf.js did not load"));
    document.head.append(s);
  });
  return pdfjsReady;
}
async function pdfToText(file, say) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const parts = [];
  let total = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    if (i % 10 === 1) say(`Pulling the text out of ${file.name}: page ${i} of ${doc.numPages}`);
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((it) => it.str + (it.hasEOL ? "\n" : " ")).join("");
    parts.push(text);
    total += text.length;
    page.cleanup();
    if (total > 480000) break;                                                       // the AI reads about 400k characters at most
  }
  await doc.destroy();
  return parts.join("\n\n");
}
async function gzipFile(file) {
  const blob = await new Response(file.stream().pipeThrough(new CompressionStream("gzip"))).blob();
  return new File([blob], `${file.name}.gz`, { type: "application/gzip" });
}

/** Returns { files, before, after } with smaller stand-ins where that helps. */
async function compressFiles(files, say = () => {}) {
  const out = [];
  let before = 0, after = 0;
  for (const f of files) {
    before += f.size;
    let g = f;
    try {
      if (IMGX.test(f.name) && f.size > 400 * 1024 && typeof shrinkImage === "function") {
        say(`Shrinking ${f.name}…`);
        const b = await shrinkImage(f, 1800);
        if (b.size < f.size) g = new File([b], f.name.replace(IMGX, ".jpg"), { type: "image/jpeg" });
      } else if (PDFX.test(f.name) && f.size > 2 * 1024 * 1024 && f.size < 600 * 1024 * 1024) {
        const text = (await pdfToText(f, say)).trim();
        if (text.replace(/\s+/g, "").length > 400) {                                  // a scanned PDF has no text: send it as it is
          const plain = new File([text], `${f.name.replace(PDFX, "")}.txt`, { type: "text/plain" });
          g = "CompressionStream" in window ? await gzipFile(plain) : plain;
        }
      } else if (TEXTY.test(f.name) && f.size > 1024 * 1024 && "CompressionStream" in window) {
        say(`Compressing ${f.name}…`);
        g = await gzipFile(f);
      }
    } catch { g = f; }
    after += g.size;
    out.push(g);
  }
  return { files: out, before, after };
}
