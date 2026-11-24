/** Test minimale: docx con 2 titoli + TOC → capire se LibreOffice li raccoglie. */
const { Document, Packer, Paragraph, TextRun, HeadingLevel, TableOfContents } = require("docx");
const fs = require("fs");

const doc = new Document({
  features: { updateFields: true },
  sections: [
    {
      children: [
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Titolo uno")] }),
        new Paragraph({ children: [new TextRun("testo")] }),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Sottotitolo due")] }),
        new Paragraph({ children: [new TextRun("testo")] }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Titolo tre")] }),
        new TableOfContents("Indice", { hyperlink: true, headingStyleRange: "1-3" }),
      ],
    },
  ],
});

Packer.toBuffer(doc).then((b) => {
  fs.writeFileSync("/tmp/mf-toc-test.docx", b);
  console.log("ok");
});
