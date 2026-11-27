/**
 * Content Normalizer & Sanitizer
 * Replaces the old destructive custom symbol/LaTeX parser with a clean, safe normalizer.
 * Preserves standard LaTeX ($...$, $$...$$), chemistry notation (\ce{...}),
 * Markdown formatting, HTML, code blocks, and Unicode.
 */

export function sanitizeContent(text) {
  if (!text || typeof text !== "string") return text || "";
  let str = text;

  // 1. Remove rambling chain-of-thought self-checks from Gemini
  str = str.replace(
    /(\.{2,3}\s*)?(wait,?\s*)?(let'?s\s+(re-?verify|re-?calculate|re-?check|check again|verify carefully))[\s\S]*?(?=(Thus|Hence|Therefore|So|In conclusion|Conclusion|Option\s+[A-D]|Final Answer|$))/i,
    ""
  );

  // 2. Repair any legacy corrupted "≤ft" from previous custom regex passes
  str = str.replace(/≤ft\s*\(/g, "\\left(");
  str = str.replace(/≤ft\s*\[/g, "\\left[");
  str = str.replace(/≤ft\b/g, "\\left");

  // 3. Repair accidentally split numbers or parentheses across newlines:
  // e.g. "(N +\n\n1)" -> "(N + 1)"
  str = str.replace(/\(([^()\n]*?)\s*\n+\s*([0-9a-zA-Z\+\-\*\/\s]+)\)/g, "($1 $2)");
  // e.g. "0.\n\n02" -> "0.02"
  str = str.replace(/(\d+)\.\s*\n+\s*(\d+)/g, "$1.$2");

  // 4. Ensure standalone \propto without math delimiters is wrapped cleanly
  str = str.replace(/(?<!\$)\\propto(?!\$)/g, "$\\propto$");

  return str.trim();
}

export function formatStepByStepSolution(text) {
  return sanitizeContent(text);
}

export function formatDisplayMath(text) {
  return sanitizeContent(text);
}

export function cleanLatexToText(text) {
  return sanitizeContent(text);
}

export default formatDisplayMath;
