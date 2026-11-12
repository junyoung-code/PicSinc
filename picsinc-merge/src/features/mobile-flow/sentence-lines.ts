// One sentence per line, so narrow phones never split a status message mid-sentence.
// The element showing the text needs `white-space: pre-line`.
export function sentenceLines(text: string) {
  return text.replace(/([.!?])\s+(?=\S)/g, "$1\n");
}
