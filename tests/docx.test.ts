import { Packer } from "docx";
import JSZip from "jszip";
import mammoth from "mammoth";
import { describe, expect, it } from "vitest";
import { buildCvDocx } from "@/lib/docx";
import { pdfFileName } from "@/lib/filename";
import { sampleCvAr, sampleCvEn } from "./helpers";

const textOf = async (cv: Parameters<typeof buildCvDocx>[0]) => {
  const buffer = await Packer.toBuffer(buildCvDocx(cv));
  return { buffer, text: (await mammoth.extractRawText({ buffer })).value };
};

describe("Word (.docx) export", () => {
  it("contains every section of an English CV", async () => {
    const cv = sampleCvEn();
    const { text } = await textOf(cv);
    expect(text).toContain(cv.name);
    for (const label of ["Summary", "Experience", "Education", "Skills"]) expect(text).toContain(label);
    expect(text).toContain(cv.experience[0].bullets[0]);
    for (const s of cv.skills) expect(text).toContain(s);
  });

  it("uses Arabic labels and right-to-left paragraphs for an Arabic CV", async () => {
    const cv = sampleCvAr();
    const { buffer, text } = await textOf(cv);
    expect(text).toContain(cv.name);
    expect(text).toContain("الخبرة العملية");
    const xml = await (await JSZip.loadAsync(buffer)).file("word/document.xml")!.async("string");
    expect(xml).toContain("<w:bidi"); // paragraph direction
    expect(xml).toContain("<w:rtl"); // run direction
  });

  it("names the file like the PDF, with a .docx extension", () => {
    expect(pdfFileName("Sara Ali Hassan", "Acme Co", "docx")).toBe("Sara_Hassan_Acme_Co.docx");
  });
});
