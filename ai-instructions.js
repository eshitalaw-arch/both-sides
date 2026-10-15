// The exact instructions the AI follows when drafting summaries and notes.
// Shown publicly on the About page, used by the review page's "Copy for AI" button,
// and by the automatic AI (api/assist.js) when an AI key is set. One source of truth.
(function (root) {
  var I = {};

  I.general =
    'You are helping review a neutral debate website called Both Sides. ' +
    'Treat every side exactly the same: never favor a side, never declare a winner, and judge reasoning the same way whichever side it supports. ' +
    'Use only the statement and arguments provided. Do not add outside facts or your own opinion.';

  I.summary =
    'Write "Where the discussion stands" in plain, neutral English, in three parts of one or two short sentences each:\n' +
    '- SUPPORTED: what the arguments’ cited facts or sources establish, or that nothing is established yet\n' +
    '- DISPUTED: what the two sides still disagree about\n' +
    '- RESOLVE: what evidence, data or step would help resolve the disagreement';

  I.notes =
    'For each argument, suggest at most one note, or NONE. Most arguments should get NONE. Decide in this order:\n' +
    '1. FALLACY: a recognised error in reasoning (name it, e.g. "Personal attack", "Straw man", "Appeal to ignorance"). Not for arguments that are merely blunt or unpopular.\n' +
    '2. OVERCLAIMS: the conclusion goes further than the support given (e.g. "always", "every", "proves").\n' +
    '3. EVIDENCE: a key factual claim has no source. Arguments about values or priorities do not need a source.\n' +
    '4. VALUE: not a weakness; the disagreement is about priorities rather than facts.\n' +
    '5. STRONG: only if directly on point, supported by a source or checkable fact, and soundly argued.\n' +
    'For each note give WHY (one sentence readers will see) and, except for VALUE and STRONG, FIX (one sentence on how to improve it). For STRONG, WHY should also say what the argument does not prove.\n' +
    'Some arguments already have a published note, shown as [current note: ...]. Reply KEEP for those unless the current note is clearly wrong; only then suggest a different note, or NONE to remove it.';

  I.replyFormat =
    'Reply in exactly this format and nothing else:\n' +
    'SUPPORTED: ...\n' +
    'DISPUTED: ...\n' +
    'RESOLVE: ...\n' +
    'NOTE #<argument number>: <KEEP, NONE, FALLACY, OVERCLAIMS, EVIDENCE, VALUE or STRONG> | <fallacy name, or leave blank> | <why> | <fix, or leave blank>\n' +
    '(one NOTE line for every argument)';

  // What the public sees on the About page.
  I.publicText = I.general + '\n\n' + I.summary + '\n\n' + I.notes;

  // What the reviewer pastes into an AI chat, with the debate attached.
  I.forDebate = function (d) {
    var lines = [I.general, '', I.summary, '', I.notes, '', I.replyFormat, '', 'DEBATE', 'Topic: ' + (d.topic || '')];
    lines.push('Statement: ' + d.statement);
    if (d.context) lines.push('Context: ' + d.context);
    lines.push('Arguments:');
    (d.arguments || []).forEach(function (a) {
      var cur = a.note ? ' [current note: ' + a.note.toUpperCase() + (a.noteDetail ? ' (' + a.noteDetail + ')' : '') + (a.noteWhy ? ': ' + a.noteWhy : '') + ']' : '';
      lines.push('#' + a.id + ' (' + (a.side === 'favor' ? 'in favor' : 'against') + '): ' + a.text + (a.source ? ' [source: ' + a.source + ']' : '') + cur);
    });
    return lines.join('\n');
  };

  // Read an AI reply in the format above.
  I.parseReply = function (text) {
    var out = { supported: '', disputed: '', resolve: '', notes: [] };
    var map = { FALLACY: 'fallacy', OVERCLAIMS: 'overclaims', EVIDENCE: 'evidence', VALUE: 'value', STRONG: 'strong', NONE: 'none', KEEP: 'keep' };
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var line = raw.replace(/\*\*/g, '').replace(/^[\s>*-]+/, '').trim();
      var m;
      if ((m = line.match(/^SUPPORTED\s*:\s*(.*)$/i))) out.supported = m[1].trim();
      else if ((m = line.match(/^DISPUTED\s*:\s*(.*)$/i))) out.disputed = m[1].trim();
      else if ((m = line.match(/^RESOLVE\s*:\s*(.*)$/i))) out.resolve = m[1].trim();
      else if ((m = line.match(/^NOTE\s*#?\s*(\d+)\s*:\s*(.*)$/i))) {
        var parts = m[2].split('|').map(function (x) { return x.trim(); });
        var tag = map[(parts[0] || '').toUpperCase()];
        if (!tag) return;
        out.notes.push({ id: Number(m[1]), tag: tag, detail: tag === 'fallacy' ? (parts[1] || '') : '', why: parts[2] || '', fix: parts[3] || '' });
      }
    });
    return out;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = I;
  else root.BOTH_SIDES_AI_INSTRUCTIONS = I;
})(this);
