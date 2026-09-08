// A small syntax highlighter for the two languages this quiz uses. Deliberately
// dependency-free: a lecture-hall page should not wait on a CDN.
const KW = {
  python: /\b(def|return|if|elif|else|for|while|in|not|and|or|import|from|as|class|None|True|False|pass|break|continue|lambda|with|try|except|finally|raise|yield|global|is)\b/,
  csharp: /\b(static|int|void|string|bool|double|float|var|new|return|if|else|for|foreach|while|in|class|public|private|protected|null|true|false|using|namespace|const|out|ref)\b/,
};
const BUILTIN = /\b(range|len|set|list|dict|str|int|print|sum|sorted|enumerate|Console|WriteLine)\b/;

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

export function highlight(src, lang) {
  const kw = KW[lang] || KW.python;
  // One pass, alternation ordered so comments and strings win over everything.
  const re = new RegExp(
    [
      /(?<com>#[^\n]*|\/\/[^\n]*)/.source,
      /(?<str>"(?:[^"\\n]|\.)*"|'(?:[^'\\n]|\.)*')/.source,
      /(?<num>\b\d+(?:\.\d+)?\b)/.source,
      `(?<kw>${kw.source})`,
      /(?<fn>[A-Za-z_]\w*(?=\s*\())/.source,
      /(?<word>[A-Za-z_]\w*)/.source,
    ].join("|"),
    "g"
  );
  let out = "", last = 0, m;
  while ((m = re.exec(src)) !== null) {
    out += esc(src.slice(last, m.index));
    const g = m.groups;
    const cls = g.com ? "tok-com" : g.str ? "tok-str" : g.num ? "tok-num"
      : g.kw ? "tok-kw" : g.fn ? "tok-fn" : BUILTIN.test(m[0]) ? "tok-typ" : null;
    out += cls ? `<span class="${cls}">${esc(m[0])}</span>` : esc(m[0]);
    last = m.index + m[0].length;
  }
  return out + esc(src.slice(last));
}

export function codeBlock(code) {
  const pre = document.createElement("pre");
  pre.className = "code";
  pre.innerHTML = highlight(code.source, code.lang);
  return pre;
}
