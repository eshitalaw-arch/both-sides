(function () {
  'use strict';

  var cfg = window.BOTH_SIDES_CONFIG || {};
  var content = document.getElementById('content');
  var notice = document.getElementById('notice');
  var configured = cfg.SUPABASE_URL && cfg.SUPABASE_URL.indexOf('PASTE_') !== 0 &&
                   cfg.SUPABASE_ANON_KEY && cfg.SUPABASE_ANON_KEY.indexOf('PASTE_') !== 0;

  var TAGS = {
    fallacy: 'Possible fallacy',
    overclaims: 'Overclaims',
    evidence: 'Needs evidence',
    value: 'Value difference',
    strong: 'Strong'
  };

  var tabsNav = document.getElementById('tabs');
  var state = { view: 'home', country: '', focusTopic: null, countries: [], data: null, expanded: {}, open: {} };
  applyRoute();
  var db = null;

  // ---------- helpers ----------
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') node.textContent = v;
        else if (k === 'class') node.className = v;
        else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : v);
      });
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function safeUrl(u) {
    try {
      var url = new URL(u);
      return (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : null;
    } catch (e) { return null; }
  }

  function readHash() {
    try { return decodeURIComponent((location.hash || '').replace('#', '')); } catch (e) { return ''; }
  }

  // Links: "#" or "#home" = front page, "#india" = a country, "#india/12" = a country with topic 12 opened.
  function applyRoute() {
    var h = readHash();
    if (!h || h === 'home') { state.view = 'home'; state.country = ''; state.focusTopic = null; return; }
    if (h === 'about' || h.indexOf('about/') === 0) {
      state.view = 'about'; state.country = ''; state.focusTopic = null;
      state.aboutSection = h.split('/')[1] || null;
      return;
    }
    var parts = h.split('/');
    state.view = 'country';
    state.country = parts[0];
    state.focusTopic = parts[1] || null;
    if (state.focusTopic) state.open['t' + state.focusTopic] = true;
  }

  // Used only if the countries table hasn't been created yet.
  var FALLBACK_NAMES = { india: 'India', us: 'United States' };

  function pickCountry() {
    var codes = state.countries.map(function (c) { return c.code; });
    if (state.view === 'country' && codes.indexOf(state.country) === -1) { state.view = 'home'; state.country = ''; }
  }

  function showNotice(msg) {
    notice.textContent = msg;
    notice.hidden = !msg;
  }

  // ---------- data ----------
  function load() {
    if (!configured) {
      showNotice('Setup needed: add your Supabase Project URL and anon key in config.js.');
      content.innerHTML = '';
      return Promise.resolve();
    }
    return Promise.all([
      db.from('topics').select('id,country,title,sort').order('sort'),
      db.from('statements').select('*').eq('status', 'approved').order('created_at'),
      db.from('reasons').select('*').eq('status', 'approved').order('created_at'),
      db.from('countries').select('code,name,sort').order('sort').order('name')
    ]).then(function (res) {
      var err = res[0].error || res[1].error || res[2].error;
      if (err) throw err;
      state.data = { topics: res[0].data, statements: res[1].data, reasons: res[2].data };
      if (!res[3].error && res[3].data && res[3].data.length) {
        state.countries = res[3].data;
      } else {
        // No countries table yet: build tabs from the topics instead.
        var seen = {};
        state.countries = [];
        res[0].data.forEach(function (t) {
          if (!seen[t.country]) { seen[t.country] = true; state.countries.push({ code: t.country, name: FALLBACK_NAMES[t.country] || t.country }); }
        });
      }
      pickCountry();
      prunePending();
      showNotice('');
      render();
    }).catch(function (e) {
      console.error(e);
      showNotice('Could not load the table. Check the Supabase settings in config.js and that schema.sql has been run.');
      content.innerHTML = '';
    });
  }

  // ---------- things this visitor submitted (shown only to them until approved) ----------
  var PENDING_KEY = 'bothSides.pending.v1';
  var PENDING_DAYS = 30;

  function readPending() {
    try {
      var list = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
      var cutoff = Date.now() - PENDING_DAYS * 864e5;
      return Array.isArray(list) ? list.filter(function (p) { return p && p.at > cutoff; }) : [];
    } catch (e) { return []; }
  }
  function writePending(list) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(list)); } catch (e) { /* storage blocked: nothing to remember */ }
  }
  function addPending(item) {
    item.at = Date.now();
    var list = readPending(); list.push(item); writePending(list);
  }
  // Once an item is live (or the reviewer turned it down long ago), stop showing the local copy.
  function prunePending() {
    if (!state.data) return;
    var live = {};
    state.data.statements.forEach(function (s) { live['s:' + s.text] = true; });
    state.data.reasons.forEach(function (r) { live['r:' + r.statement_id + ':' + r.text] = true; });
    state.countries.forEach(function (c) { live['c:' + c.name.toLowerCase()] = true; });
    writePending(readPending().filter(function (p) {
      if (p.type === 'debate') return !live['s:' + p.statement];
      if (p.type === 'argument') return !live['r:' + p.statementId + ':' + p.text];
      if (p.type === 'country') return !live['c:' + p.name.toLowerCase()];
      return false;
    }));
  }

  function waitingBadge() {
    return el('span', { class: 'waiting', text: 'Waiting for review · only you can see this' });
  }

  // ---------- rendering ----------
  function render() {
    renderTabs();
    renderCountryNotes();
    content.innerHTML = '';
    if (!state.data) return;
    document.body.classList.toggle('is-home', state.view === 'home');
    document.querySelectorAll('[data-nav]').forEach(function (a) {
      if (a.dataset.nav === state.view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (state.view === 'home') { renderHome(); return; }
    if (state.view === 'about') {
      renderAbout();
      if (state.aboutSection) {
        var secId = state.aboutSection;
        setTimeout(function () { var sec = document.getElementById(secId); if (sec) sec.scrollIntoView({ block: 'start' }); }, 0);
      }
      return;
    }

    var country = currentCountry();
    if (state.focusTopic) {
      var target = state.focusTopic;
      setTimeout(function () { var t = document.getElementById('topic-t' + target); if (t) t.scrollIntoView({ block: 'start' }); }, 0);
      state.focusTopic = null;
    }
    var topics = state.data.topics.filter(function (t) { return t.country === state.country; });
    var pending = readPending().filter(function (p) { return p.type === 'debate' && p.country === state.country; });
    var newTopicPending = pending.filter(function (p) { return !p.topicId; });

    if (!topics.length && !newTopicPending.length && country) {
      // An empty country: invite the first debate straight away, with the form already open.
      content.appendChild(el('div', { class: 'country-head' }, [
        el('h1', { text: country.name }),
        el('p', { class: 'sub', text: 'No debates here yet. Start the first one: a statement people can agree or disagree with, and the strongest argument on each side.' })
      ]));
      content.appendChild(debateForm({ country: country, open: true }));
      return;
    }

    var list = el('div', { class: 'topic-list' });
    var onlyOne = topics.length + Object.keys(newTopicPending).length === 1;
    topics.forEach(function (topic) {
      list.appendChild(renderTopic(topic, pending.filter(function (p) { return String(p.topicId) === String(topic.id); }), onlyOne));
    });

    // New topics this visitor proposed (not live yet)
    var byTitle = {};
    newTopicPending.forEach(function (p) { (byTitle[p.newTopic] = byTitle[p.newTopic] || []).push(p); });
    Object.keys(byTitle).forEach(function (title) {
      var shell = topicShell('new:' + title, title, null, waitingBadge(), true);
      byTitle[title].forEach(function (p) { shell.body.appendChild(renderPendingDebate(p)); });
      list.appendChild(shell.details);
    });
    if (list.children.length) {
      var head = el('div', { class: 'country-head' }, [
        el('h1', { text: country ? country.name : '' }),
        el('p', { class: 'sub', text: topics.length + (topics.length === 1 ? ' topic' : ' topics') + '. Open a topic to see each debate, with arguments for and against side by side.' })
      ]);
      content.appendChild(head);
      content.appendChild(list);
    }

    if (country) content.appendChild(renderStartDebate(country));
  }

  // ---------- front page ----------
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function renderHome() {
    var D = state.data;
    var nDebates = D.statements.length, nArgs = D.reasons.length;

    content.appendChild(el('section', { class: 'hero' }, [
      el('p', { class: 'hero-kicker', text: 'Both Sides' }),
      el('h1', { class: 'hero-title', text: 'Every big question has more than one side.' }),
      el('p', { class: 'hero-lead', text: 'Put the arguments side by side, and the bigger picture comes into view.' }),
      el('div', { class: 'hero-actions' }, [
        el('a', { class: 'btn btn-dark as-link', href: '#countries', text: 'Browse the debates', onclick: function (e) { e.preventDefault(); var t = document.getElementById('countries'); if (t) t.scrollIntoView({ behavior: 'smooth' }); } }),
        state.countries[0] ? el('a', { class: 'btn btn-plain as-link', href: '#' + state.countries[0].code, text: 'Start a debate' }) : null
      ]),
      el('ul', { class: 'hero-stats' }, [
        el('li', {}, [el('b', { text: String(state.countries.length) }), el('span', { text: state.countries.length === 1 ? ' country' : ' countries' })]),
        el('li', {}, [el('b', { text: String(D.topics.length) }), el('span', { text: D.topics.length === 1 ? ' topic' : ' topics' })]),
        el('li', {}, [el('b', { text: String(nDebates) }), el('span', { text: nDebates === 1 ? ' debate' : ' debates' })]),
        el('li', {}, [el('b', { text: String(nArgs) }), el('span', { text: nArgs === 1 ? ' argument' : ' arguments' })])
      ])
    ]));

    var countriesSec = el('section', { class: 'home-section', id: 'countries', 'aria-labelledby': 'countries-h' }, [
      el('h2', { id: 'countries-h', text: 'Explore by country' })
    ]);
    var grid = el('div', { class: 'country-grid' });
    state.countries.forEach(function (c) {
      var topics = D.topics.filter(function (t) { return t.country === c.code; });
      var tIds = topics.map(function (t) { return t.id; });
      var debates = D.statements.filter(function (s) { return tIds.indexOf(s.topic_id) !== -1; });
      var list = el('ul', { class: 'topic-links' });
      topics.slice(0, 6).forEach(function (t) {
        var n = D.statements.filter(function (s) { return s.topic_id === t.id; }).length;
        list.appendChild(el('li', {}, [
          el('a', { href: '#' + c.code + '/' + t.id, text: t.title }),
          el('span', { class: 'muted small', text: n ? plural(n, 'debate', 'debates') : 'no debates yet' })
        ]));
      });
      if (topics.length > 6) list.appendChild(el('li', {}, [el('a', { href: '#' + c.code, text: '+ ' + (topics.length - 6) + ' more topics' })]));
      grid.appendChild(el('article', { class: 'country-card' }, [
        el('h3', {}, [el('a', { href: '#' + c.code, text: c.name })]),
        el('p', { class: 'muted small', text: topics.length ? plural(topics.length, 'topic', 'topics') + ' · ' + plural(debates.length, 'debate', 'debates') : 'No debates yet. Be the first to start one.' }),
        topics.length ? list : null,
        el('a', { class: 'card-link', href: '#' + c.code, text: topics.length ? 'Open ' + c.name + ' →' : 'Start the first debate →' })
      ]));
    });
    countriesSec.appendChild(grid);
    countriesSec.appendChild(el('p', { class: 'muted small', text: 'Don’t see a country? Use “Suggest a country” at the top of the page.' }));
    content.appendChild(countriesSec);

    var latest = D.statements.slice().sort(function (a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); }).slice(0, 5);
    if (latest.length) {
      var latestSec = el('section', { class: 'home-section', 'aria-labelledby': 'latest-h' }, [el('h2', { id: 'latest-h', text: 'Latest debates' })]);
      var ul = el('ul', { class: 'latest' });
      latest.forEach(function (s) {
        var t = D.topics.filter(function (x) { return x.id === s.topic_id; })[0];
        if (!t) return;
        var c = state.countries.filter(function (x) { return x.code === t.country; })[0];
        var nf = D.reasons.filter(function (r) { return r.statement_id === s.id && r.side === 'favor'; }).length;
        var na = D.reasons.filter(function (r) { return r.statement_id === s.id && r.side === 'against'; }).length;
        ul.appendChild(el('li', {}, [el('a', { href: '#' + t.country + '/' + t.id }, [
          el('span', { class: 'crumb', text: (c ? c.name : t.country) + ' › ' + t.title }),
          el('span', { class: 'latest-text', text: s.text }),
          el('span', { class: 'latest-counts' }, [
            el('span', { class: 'pill-favor', text: plural(nf, 'argument', 'arguments') + ' for' }),
            el('span', { class: 'pill-against', text: plural(na, 'argument', 'arguments') + ' against' })
          ])
        ])]));
      });
      latestSec.appendChild(ul);
      content.appendChild(latestSec);
    }

    content.appendChild(el('section', { class: 'home-section home-about' }, [
      el('p', {}, [
        document.createTextNode('New here? '),
        el('a', { href: '#about', text: 'Read how Both Sides works' }),
        document.createTextNode(', how contributions are reviewed, and how summaries are written.')
      ])
    ]));
  }

  // ---------- About ----------
  var FALLACIES = [
    ['Personal attack (ad hominem)', 'Attacking the person making an argument instead of the argument itself. “You only say that because of who you are” does not show the point is wrong.'],
    ['Straw man', 'Arguing against a weaker or distorted version of the other side’s view rather than what they actually said.'],
    ['False dilemma', 'Presenting only two options when more exist: “either we do this, or everything falls apart.”'],
    ['Slippery slope', 'Claiming that one step will inevitably lead to an extreme outcome, without showing why each step would follow.'],
    ['Hasty generalisation', 'Drawing a broad conclusion from too few or unrepresentative examples.'],
    ['Appeal to ignorance', 'Treating something as false because it has not been proven true, or true because it has not been proven false.'],
    ['False cause (post hoc)', 'Assuming that because one thing happened after another, the first caused the second.'],
    ['Whataboutism (tu quoque)', 'Deflecting criticism by pointing to someone else’s faults instead of answering it.'],
    ['Appeal to popularity', 'Arguing that something is right because many people believe or do it.'],
    ['Misplaced appeal to authority', 'Relying on someone’s status, or on an expert speaking outside their field, instead of on evidence.']
  ];
  var SOURCES = [
    ['Stanford Encyclopedia of Philosophy: Fallacies', 'https://plato.stanford.edu/entries/fallacies/', 'an in-depth academic overview'],
    ['Internet Encyclopedia of Philosophy: Fallacies', 'https://iep.utm.edu/fallacy/', 'a long A–Z list with examples'],
    ['Purdue Online Writing Lab: Logical Fallacies', 'https://owl.purdue.edu/owl/general_writing/academic_writing/logic_in_argumentative_writing/fallacies.html', 'a short, practical guide']
  ];
  var NOTE_CLASS = { fallacy: 'tag-fallacy', overclaims: 'tag-overclaims', evidence: 'tag-evidence', value: 'tag-value', strong: 'tag-strong' };
  function noteDef(tag, name, text) {
    return el('div', { class: 'note-def' }, [el('dt', {}, [el('span', { class: 'tag ' + NOTE_CLASS[tag], text: name })]), el('dd', { text: text })]);
  }

  function aiParagraphs(on) {
    function p(t) { return el('p', { text: t }); }
    var items = [
      el('li', {}, [el('b', { text: 'Summaries and notes are drafted by AI. ' }), document.createTextNode('Every “Where the discussion stands” summary and every note on an argument is drafted by an AI model, working only from the arguments published on that page and following the instructions shown below.')]),
      el('li', {}, [el('b', { text: 'Reviewers check; they do not rewrite. ' }), document.createTextNode('A reviewer reads each draft against the arguments and either publishes it exactly as written or discards it and asks the AI for a new one. Reviewers do not change the AI’s wording.')])
    ];
    if (on) items.push(el('li', {}, [el('b', { text: 'A tone check when you submit. ' }), document.createTextNode('If something reads as insulting, threatening or personal, AI points it out and suggests kinder wording. It never blocks you and never judges which side you are on.')]));
    var AI = window.BOTH_SIDES_AI_INSTRUCTIONS;
    return [
      p('AI helps with the parts of Both Sides where neutrality matters most, under fixed public rules.'),
      el('ul', { class: 'about-list' }, items),
      p('AI does not decide what is published, and it can make mistakes. If you think a note or summary is wrong, use “Challenge this rating” and a new draft can be requested.'),
      AI ? el('details', { class: 'instructions' }, [
        el('summary', { text: 'Read the exact instructions the AI follows' }),
        el('pre', { text: AI.publicText })
      ]) : null
    ];
  }

  function renderAbout() {
    if (state.aiEnabled === undefined) {
      fetch('/api/check').then(function (r) { return r.ok ? r.json() : { enabled: false }; }).catch(function () { return { enabled: false }; })
        .then(function (out) {
          state.aiEnabled = !!(out && out.enabled);
          var box = document.getElementById('ai-text');
          if (box) { box.innerHTML = ''; aiParagraphs(state.aiEnabled).forEach(function (n) { box.appendChild(n); }); }
        });
    }
    function section(id, title, kids) {
      return el('section', { class: 'about-section', id: id, 'aria-labelledby': id + '-h' }, [el('h2', { id: id + '-h', text: title })].concat(kids));
    }
    function para(t) { return el('p', { text: t }); }
    function item(b, t) { return el('li', {}, [el('b', { text: b + ' ' }), document.createTextNode(t)]); }

    content.appendChild(el('article', { class: 'about' }, [
      el('header', { class: 'about-head' }, [
        el('p', { class: 'hero-kicker', text: 'About' }),
        el('h1', { class: 'about-title', text: 'Why Both Sides exists' }),
        el('p', { class: 'hero-lead', text: 'Put the arguments side by side, and the bigger picture comes into view.' })
      ]),

      section('why', 'The idea', [
        para('On most public questions, thoughtful people disagree. The arguments for and against are usually spread across many places, and it takes effort to find them together.'),
        para('Both Sides brings them into one table. Each debate starts with a clear statement, then lists the strongest arguments in favor and against, next to each other. The aim is not to settle the question for anyone, but to make the whole discussion easy to see in one place.')
      ]),

      section('how', 'How it works', [
        el('ol', { class: 'steps' }, [
          el('li', {}, [el('span', { class: 'step-n', text: '1' }), el('h3', { text: 'Countries and topics' }), el('p', { text: 'Debates are grouped by country, then by topic: a broad issue such as housing or education.' })]),
          el('li', {}, [el('span', { class: 'step-n', text: '2' }), el('h3', { text: 'One table per debate' }), el('p', { text: 'A statement, with arguments in favor on one side and arguments against on the other.' })]),
          el('li', {}, [el('span', { class: 'step-n', text: '3' }), el('h3', { text: 'Anyone can contribute' }), el('p', { text: 'Suggest a country, start a debate or add an argument, anonymously or under your name.' })])
        ])
      ]),

      section('review', 'How contributions are reviewed', [
        el('ul', { class: 'about-list' }, [
          item('Reviewed before publishing.', 'Every new country, debate and argument is read by a reviewer before it appears. Contributors see their own submission marked “Waiting for review” in the meantime.'),
          item('About once a day.', 'Reviews are usually done once a day, sometimes more often. A new contribution may take up to a day or so to appear.'),
          item('Same rules for every side.', 'Contributions are judged on whether they are on topic and respectful, not on which side they support.'),
          item('Notes explain, they do not judge.', 'Some arguments carry a short note, such as “Needs evidence” or “Possible fallacy”. Notes are suggested by AI and confirmed by a reviewer. Tapping one shows why. Most arguments carry no note at all.'),
          item('Every decision is recorded.', 'Approvals, rejections and removals are logged with the reviewer who made them.')
        ])
      ]),

      section('notes', 'Notes on arguments', [
        para('A note points out something a careful reader may want to know. It is about how an argument is made, never about which side it is on, and the same standards apply to every side. An argument gets at most one note, and most get none.'),
        el('dl', { class: 'note-defs' }, [
          noteDef('fallacy', 'Possible fallacy', 'The reasoning contains a recognised error, named in the note (for example, “Possible fallacy: Straw man”). See “Logical fallacies” below.'),
          noteDef('overclaims', 'Overclaims', 'The conclusion goes further than the support given, for example using “always” or “proves” where the evidence shows less.'),
          noteDef('evidence', 'Needs evidence', 'A key factual claim has no source. Arguments about values or priorities do not need one.'),
          noteDef('value', 'Value difference', 'Not a weakness. The disagreement is about priorities rather than facts, so evidence alone cannot settle it.'),
          noteDef('strong', 'Strong', 'Directly on point, supported by a source or checkable fact, and soundly argued. The note also says what the argument does not prove.')
        ]),
        para('Notes are suggested by AI and confirmed by a reviewer. They can be wrong. If you think one is unfair, use “Challenge this rating”.')
      ]),

      section('fallacies', 'Logical fallacies', [
        para('A logical fallacy is an error in reasoning: the reasons given do not actually support the conclusion, even if the argument sounds convincing. Spotting a fallacy does not mean the conclusion is false. It only means this particular argument does not establish it.'),
        para('If an argument on Both Sides carries the note “Possible fallacy”, the note names the fallacy. Here are the ones you are most likely to see:'),
        el('dl', { class: 'fallacy-list' }, FALLACIES.map(function (f) {
          return el('div', { class: 'fallacy' }, [el('dt', { text: f[0] }), el('dd', { text: f[1] })]);
        })),
        el('div', { class: 'sources' }, [
          el('p', { class: 'sources-title', text: 'To learn more, these sources explain logical fallacies in depth:' }),
          el('ul', {}, SOURCES.map(function (src) {
            return el('li', {}, [el('a', { href: src[1], target: '_blank', rel: 'noopener noreferrer', text: src[0] + ' ↗' }), el('span', { class: 'muted small', text: ' · ' + src[2] })]);
          }))
        ])
      ]),

      section('summary', 'Where the discussion stands', [
        para('Under each debate, a short summary sets out three things: what the cited evidence supports, what is still disputed, and what would help resolve it. It is drafted by AI from the published arguments (see “What AI does” below), and shows how many arguments it is based on and when it was last reviewed.'),
        para('Summaries describe the discussion. They never declare a winner, and they cover approved arguments only, not public opinion.')
      ]),

      section('ai', 'What AI does', [el('div', { id: 'ai-text' }, aiParagraphs(state.aiEnabled))]),

      section('disclaimer', 'Independence and disclaimer', [
        el('ul', { class: 'about-list' }, [
          item('A neutral platform.', 'Both Sides is a non-commercial platform where users set out arguments on public questions. Neither the platform nor its creator is affiliated with any government, political party, campaign, candidate or advocacy group.'),
          item('The creator takes no position.', 'The creator and the reviewers of Both Sides do not endorse, support or promote any position, party, candidate or cause, including any argument published on this site. The platform exists to present arguments from every side, not to argue for one.'),
          item('All content is written by users.', 'Every debate and argument on Both Sides is written by a user and reflects only that user’s views. Nothing published here represents the personal views of the platform’s creator or reviewers.'),
          item('Approval is not agreement.', 'When a reviewer approves a contribution, it only means the contribution meets the published rules. It does not mean the creator or reviewers agree with it.'),
          item('Notes and summaries are not opinions on the issue.', 'Notes and “Where the discussion stands” summaries are drafted by AI and describe how the arguments are made and what the evidence shows. They are not written by, and do not express the view of, the creator or reviewers.'),
          item('Information only.', 'Content on Both Sides is for information and discussion. It is not legal, financial or professional advice.')
        ])
      ]),

      el('div', { class: 'about-cta' }, [
        el('a', { class: 'btn btn-dark as-link', href: '#home', text: 'Browse the debates' })
      ])
    ]));
  }

  function currentCountry() {
    return state.countries.filter(function (c) { return c.code === state.country; })[0] || null;
  }

  function renderCountryNotes() {
    var slot = document.getElementById('country-notes');
    if (!slot) return;
    slot.innerHTML = '';
    readPending().filter(function (p) { return p.type === 'country'; }).forEach(function (p) {
      slot.appendChild(el('p', { class: 'pending-note', text: 'Your country suggestion "' + p.name + '" is waiting for review. Its tab will appear once it is approved.' }));
    });
  }

  function renderStartDebate(country) {
    var box = el('section', { class: 'start-debate', 'aria-label': 'Start a new debate' });
    var slot = el('div');
    var btn = el('button', { type: 'button', class: 'btn btn-dark', text: '+ Start a new debate in ' + country.name });
    btn.addEventListener('click', function () {
      btn.hidden = true;
      slot.appendChild(debateForm({ country: country, onCancel: function () { btn.hidden = false; btn.focus(); } }));
    });
    box.appendChild(btn);
    box.appendChild(slot);
    return box;
  }

  function renderTabs() {
    tabsNav.innerHTML = '';
    tabsNav.hidden = state.countries.length < 2;
    state.countries.forEach(function (c) {
      tabsNav.appendChild(el('button', {
        type: 'button', class: 'tab', text: c.name,
        'aria-pressed': state.view === 'country' && c.code === state.country ? 'true' : 'false',
        onclick: function () {
          state.view = 'country';
          state.country = c.code;
          state.focusTopic = null;
          history.pushState(null, '', '#' + encodeURIComponent(c.code));
          window.scrollTo(0, 0);
          render();
        }
      }));
    });
  }

  function topicShell(key, title, countText, extra, openByDefault) {
    var isOpen = state.open[key] !== undefined ? state.open[key] : openByDefault;
    var details = el('details', { class: 'topic', id: 'topic-' + key });
    details.open = !!isOpen;
    details.addEventListener('toggle', function () { state.open[key] = details.open; });
    var summary = el('summary', { class: 'topic-summary' }, [
      el('span', { class: 'chev', 'aria-hidden': 'true' }),
      el('h2', { class: 'topic-title', text: title }),
      countText ? el('span', { class: 'topic-count', text: countText }) : null,
      extra || null
    ]);
    details.appendChild(summary);
    var body = el('div', { class: 'topic-body' });
    details.appendChild(body);
    return { details: details, body: body };
  }

  function renderTopic(topic, pending, onlyOne) {
    var stmts = state.data.statements.filter(function (s) { return s.topic_id === topic.id; });
    var shell = topicShell('t' + topic.id, topic.title,
      stmts.length ? stmts.length + (stmts.length === 1 ? ' debate' : ' debates') : 'No debates yet', null, onlyOne || pending.length > 0);
    var section = shell.body;

    if (!stmts.length && !pending.length) {
      section.appendChild(el('p', { class: 'empty', text: 'No debates in this topic yet. Add the first one.' }));
    }
    stmts.forEach(function (s) { section.appendChild(renderStatement(s)); });
    pending.forEach(function (p) { section.appendChild(renderPendingDebate(p)); });

    var slot = el('div');
    var addBtn = el('button', { type: 'button', class: 'btn btn-plain btn-propose', text: '+ Add a debate to this topic' });
    addBtn.addEventListener('click', function () {
      addBtn.hidden = true;
      slot.appendChild(debateForm({ country: currentCountry(), topic: topic, onCancel: function () { addBtn.hidden = false; addBtn.focus(); } }));
    });
    section.appendChild(addBtn);
    section.appendChild(slot);
    return shell.details;
  }

  function statementCell(text, context) {
    return el('div', { class: 'cell cell-statement' }, [
      el('div', { class: 'eyebrow', text: 'Debate' }),
      el('h2', { class: 'statement-text', text: text }),
      context ? el('p', { class: 'statement-context', text: context }) : null
    ]);
  }

  function renderStatement(s) {
    var card = el('article', { class: 'card' });
    var row = el('div', { class: 'card-row' });
    row.appendChild(statementCell(s.text, s.context));
    row.appendChild(renderSide(s, 'favor', 'In favor'));
    row.appendChild(renderSide(s, 'against', 'Against'));
    card.appendChild(row);
    if (hasSummary(s)) card.appendChild(renderStands(s));
    return card;
  }

  function renderPendingDebate(p) {
    var card = el('article', { class: 'card pending' });
    var row = el('div', { class: 'card-row' });
    var stmt = statementCell(p.statement, p.context);
    stmt.appendChild(waitingBadge());
    row.appendChild(stmt);
    [['favor', 'In favor', p.favor], ['against', 'Against', p.against]].forEach(function (x) {
      var cell = el('div', { class: 'cell cell-side side-' + x[0] }, [el('div', { class: 'side-label', text: x[1] })]);
      cell.appendChild(x[2]
        ? el('ol', { class: 'reasons' }, [el('li', { class: 'reason' }, [el('span', { text: x[2] }),
            el('div', { class: 'reason-meta' }, [el('span', { text: p.author || 'Anonymous' })])])])
        : el('p', { class: 'no-reasons', text: 'No argument yet.' }));
      row.appendChild(cell);
    });
    card.appendChild(row);
    return card;
  }

  function renderSide(s, side, label) {
    var all = state.data.reasons.filter(function (r) { return r.statement_id === s.id && r.side === side; });
    var mine = readPending().filter(function (p) { return p.type === 'argument' && p.statementId === s.id && p.side === side; });
    var key = s.id + side;
    var showAll = !!state.expanded[key];
    var shown = showAll ? all : all.slice(0, 2);
    var word = side === 'favor' ? 'in favor' : 'against';

    var cell = el('div', { class: 'cell cell-side side-' + side }, [el('div', { class: 'side-label', text: label })]);

    if (!all.length && !mine.length) {
      cell.appendChild(el('p', { class: 'no-reasons', text: 'No arguments yet.' }));
    } else {
      var list = el('ol', { class: 'reasons' });
      shown.forEach(function (r) { list.appendChild(renderReason(r)); });
      mine.forEach(function (p) {
        list.appendChild(el('li', { class: 'reason pending' }, [el('span', { text: p.text }),
          el('div', { class: 'reason-meta' }, [waitingBadge()])]));
      });
      cell.appendChild(list);
    }

    if (all.length > 2) {
      cell.appendChild(el('button', {
        type: 'button', class: 'link-btn',
        text: showAll ? 'Show fewer' : 'View all ' + all.length + ' arguments ' + word,
        onclick: function () { state.expanded[key] = !showAll; render(); }
      }));
    }

    var slot = el('div');
    var addBtn = el('button', { type: 'button', class: 'btn-add', text: '+ Add an argument ' + word });
    addBtn.addEventListener('click', function () {
      addBtn.hidden = true;
      slot.appendChild(reasonForm(s, side, function () { addBtn.hidden = false; }));
    });
    cell.appendChild(addBtn);
    cell.appendChild(slot);
    return cell;
  }

  function renderReason(r) {
    var li = el('li', { class: 'reason' }, [el('span', { text: r.text })]);
    var meta = el('div', { class: 'reason-meta' });
    var box = null;

    if (r.tag && TAGS[r.tag]) {
      var label = TAGS[r.tag] + (r.tag_detail ? ': ' + r.tag_detail : '');
      var btn = el('button', { type: 'button', class: 'tag tag-' + r.tag, 'aria-expanded': 'false', text: label + ' ▾' });
      box = el('div', { class: 'tag-box', hidden: true });
      if (r.tag_why) box.appendChild(el('div', {}, [el('b', { text: 'Why: ' }), document.createTextNode(r.tag_why)]));
      if (r.tag_fix) box.appendChild(el('div', {}, [el('b', { text: 'To make it stronger: ' }), document.createTextNode(r.tag_fix)]));
      box.appendChild(el('div', { class: 'muted small' }, [
        document.createTextNode('Suggested by AI, confirmed by a reviewer · '),
        el('a', { href: r.tag === 'fallacy' ? '#about/fallacies' : '#about/notes', text: r.tag === 'fallacy' ? 'What is a logical fallacy?' : 'What do notes mean?' })
      ]));
      btn.addEventListener('click', function () {
        var open = box.hidden;
        box.hidden = !open;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.textContent = label + (open ? ' ▴' : ' ▾');
      });
      meta.appendChild(btn);
    }

    meta.appendChild(el('span', { text: r.author || 'Anonymous' }));
    var href = r.source_url ? safeUrl(r.source_url) : null;
    if (href) {
      meta.appendChild(el('a', { href: href, target: '_blank', rel: 'noopener noreferrer', text: 'Source: ' + (r.source_label || 'link') + ' ↗' }));
    } else if (r.source_label) {
      meta.appendChild(el('span', { text: 'Source: ' + r.source_label }));
    }
    li.appendChild(meta);
    if (box) li.appendChild(box);
    return li;
  }

  function hasSummary(s) {
    return !!(s.stands_supported || s.stands_disputed || s.stands_resolve || s.stands_depends);
  }

  function renderStands(s) {
    function item(title, text) {
      return text ? el('div', {}, [el('span', { text: title }), el('span', { text: text })]) : null;
    }
    var n = state.data.reasons.filter(function (r) { return r.statement_id === s.id; }).length;
    var reviewed = '';
    if (s.stands_reviewed_at) {
      try { reviewed = ' · Reviewed ' + new Date(s.stands_reviewed_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { reviewed = ''; }
    }
    return el('div', { class: 'stands' }, [
      el('div', { class: 'stands-head' }, [
        el('h3', { text: 'Where the discussion stands' }),
        s.stands_status ? el('span', { class: 'stands-status', text: s.stands_status }) : null
      ]),
      el('div', { class: 'stands-grid' }, [
        item('What the evidence supports', s.stands_supported),
        item('Still disputed', s.stands_disputed),
        s.stands_resolve ? item('What would help resolve it', s.stands_resolve) : item('What the answer depends on', s.stands_depends)
      ]),
      el('div', { class: 'stands-basis' }, [
        document.createTextNode('Drafted by AI from the published arguments and checked by a reviewer, not rewritten. Based on ' + n + (n === 1 ? ' argument' : ' arguments') + reviewed + '. Covers approved arguments only, not public opinion. '),
        el('a', { href: '#about/ai', text: 'How summaries are made' })
      ])
    ]);
  }

  // ---------- forms ----------
  // opts.inPlace: keep the form and show a thank-you inside it (used where the page isn't redrawn).
  function wireForm(form, onDone, submit, defaultError, onSuccess) {
    var msg = form.querySelector('.form-msg');
    var btn = form.querySelector('button[type="submit"]');
    var cancel = form.querySelector('[data-cancel]');
    if (cancel) cancel.addEventListener('click', function () { form.remove(); if (onDone) onDone(); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      btn.disabled = true;
      msg.className = 'form-msg';
      msg.textContent = 'Sending…';
      var fd = new FormData(form);
      Promise.resolve().then(function () { return submit(fd); }).then(function (res) {
        if (res && res.error) throw res.error;
        if (onSuccess) { onSuccess(fd); return; }
        form.innerHTML = '';
        form.appendChild(el('p', { class: 'form-msg ok', text: 'Thanks! It has been sent for review. Reviews usually happen once a day, so it should appear within a day or so if approved.' }));
        form.appendChild(el('button', { type: 'button', class: 'btn btn-plain', text: 'Close', onclick: function () { form.remove(); if (onDone) onDone(); } }));
      }).catch(function (err) {
        btn.disabled = false;
        if (err && err.silent) { msg.className = 'form-msg'; msg.textContent = ''; return; }
        console.error(err);
        msg.className = 'form-msg err';
        msg.textContent = (err && err.friendly) || friendlyDbError(err) || defaultError || 'Something went wrong. Please try again.';
      });
    });
  }

  // Turn the database's validation messages into plain English.
  function friendlyDbError(err) {
    var m = (err && err.message) || '';
    if (/must be|too long|Unknown topic|Unknown country/.test(m)) return m.replace(/^.*?:\s*/, '') + '.';
    return '';
  }

  function flash(text) {
    var f = document.getElementById('flash');
    if (!f) return;
    f.textContent = text;
    f.hidden = false;
    clearTimeout(flash.t);
    flash.t = setTimeout(function () { f.hidden = true; }, 8000);
  }

  function slugify(name) {
    return name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }

  function countryForm(onDone) {
    var form = document.getElementById('tpl-add-country').content.firstElementChild.cloneNode(true);
    var name;
    wireForm(form, onDone, function (fd) {
      name = (fd.get('name') || '').trim().replace(/\s+/g, ' ');
      var note = (fd.get('note') || '').trim();
      var code = slugify(name);
      if (code.length < 2) {
        return Promise.reject({ friendly: 'Please write the country name using English letters.' });
      }
      return db.from('countries').insert({ code: code, name: name, note: note || null }).then(function (res) {
        if (res.error && res.error.code === '23505') {
          res.error.friendly = 'That country is already on the site or waiting for review.';
        }
        if (!res.error) { addPending({ type: 'country', name: name }); renderCountryNotes(); }
        return res;
      });
    }, 'Something went wrong sending your suggestion. Please try again in a moment.');
    setTimeout(function () { var i = form.querySelector('input'); if (i) i.focus(); }, 0);
    return form;
  }

  // ---------- AI tone check (only warns; a human reviewer always decides) ----------
  function aiCheck(fields) {
    return fetch('/api/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: fields }) })
      .then(function (r) { return r.ok ? r.json() : { flags: {} }; })
      .catch(function () { return { flags: {} }; })   // if the check can't run, posting still works
      .then(function (out) { return (out && out.flags) || {}; });
  }

  var FIELD_LABELS = { statement: 'Statement', favor: 'Argument in favor', against: 'Argument against', text: 'Your argument', topic: 'Topic', context: 'Context' };

  // Runs the check once per form. Shows a friendly warning with suggested rewrites if anything is flagged.
  function checkBeforeSending(form, fieldMap) {
    if (form.dataset.aiChecked === '1') return Promise.resolve();
    var fields = {};
    Object.keys(fieldMap).forEach(function (k) { var f = form.querySelector(fieldMap[k]); if (f && f.value.trim()) fields[k] = f.value.trim(); });
    return aiCheck(fields).then(function (flags) {
      form.dataset.aiChecked = '1';
      var keys = Object.keys(flags);
      var old = form.querySelector('.ai-warn'); if (old) old.remove();
      if (!keys.length) return;
      var box = el('div', { class: 'ai-warn', role: 'status' }, [
        el('div', { class: 'ai-warn-title', text: 'Before you post: this may not meet our community guidelines' })
      ]);
      keys.forEach(function (k) {
        var f = flags[k];
        var row = el('div', { class: 'ai-warn-row' }, [
          el('div', {}, [el('b', { text: (FIELD_LABELS[k] || k) + ': ' }), document.createTextNode(f.explanation || 'This may come across as disrespectful.')])
        ]);
        if (f.suggestion) {
          row.appendChild(el('div', { class: 'ai-suggest' }, [el('span', { class: 'muted small', text: 'Suggested wording: ' }), el('span', { text: f.suggestion })]));
          row.appendChild(el('button', { type: 'button', class: 'btn-small btn-plain', text: 'Use this wording', onclick: function () {
            var input = form.querySelector(fieldMap[k]); if (input) input.value = f.suggestion;
            row.remove();
            if (!box.querySelector('.ai-warn-row')) box.remove();
          } }));
        }
        box.appendChild(row);
      });
      box.appendChild(el('p', { class: 'muted small', text: 'You can still post as written. A person reviews everything before it appears. This check was done by AI and may be wrong.' }));
      form.querySelector('.form-actions').before(box);
      form.querySelector('button[type="submit"]').textContent = 'Post anyway for review';
      throw { silent: true };
    });
  }

  // One form for a whole debate: topic (existing or new), the statement, and a first argument on each side.
  function debateForm(opts) {
    var form = document.getElementById('tpl-add-debate').content.firstElementChild.cloneNode(true);
    var country = opts.country;
    var topics = state.data.topics.filter(function (t) { return t.country === country.code; });
    var select = form.querySelector('select[name="topic_id"]');
    var newWrap = form.querySelector('.new-topic');
    var newInput = form.querySelector('input[name="new_topic"]');
    var heading = form.querySelector('h3');

    if (opts.topic) {
      heading.textContent = 'Add a debate to “' + opts.topic.title + '”';
      form.querySelector('.topic-choice').remove();
    } else {
      heading.textContent = (opts.open ? 'Start the first debate in ' : 'Start a new debate in ') + country.name;
      topics.forEach(function (t) { select.appendChild(el('option', { value: String(t.id), text: t.title })); });
      select.appendChild(el('option', { value: 'new', text: '+ A new topic…' }));
      if (!topics.length) {
        form.querySelector('.topic-select').hidden = true;
        select.value = 'new';
      }
      var sync = function () {
        var isNew = select.value === 'new';
        newWrap.hidden = !isNew;
        newInput.required = isNew;
      };
      select.addEventListener('change', sync);
      sync();
    }
    if (opts.open) {
      var cancelBtn = form.querySelector('[data-cancel]');
      if (cancelBtn) cancelBtn.remove();
    }

    wireForm(form, opts.onCancel, function (fd) {
      var topicId = opts.topic ? opts.topic.id : (fd.get('topic_id') === 'new' ? null : Number(fd.get('topic_id')));
      return checkBeforeSending(form, { topic: 'input[name="new_topic"]', statement: 'textarea[name="statement"]', context: 'input[name="context"]', favor: 'textarea[name="favor"]', against: 'textarea[name="against"]' })
        .then(function () { return sendDebate(fd, topicId); });
    }, 'Something went wrong. Please check each box and try again.', function () {
      render();
      flash('Thanks! Your debate has been sent for review. Reviews usually happen once a day. Until then you can see it below, marked “Waiting for review”.');
    });

    function sendDebate(fd, topicId) {
      var payload = {
        p_country: country.code,
        p_topic_id: topicId,
        p_new_topic: topicId ? null : (fd.get('new_topic') || '').trim().replace(/\s+/g, ' '),
        p_statement: (fd.get('statement') || '').trim(),
        p_context: (fd.get('context') || '').trim() || null,
        p_favor: (fd.get('favor') || '').trim() || null,
        p_against: (fd.get('against') || '').trim() || null,
        p_author: (fd.get('author') || '').trim() || null
      };
      return db.rpc('submit_debate', payload).then(function (res) {
        if (!res.error) {
          addPending({
            type: 'debate', country: country.code, topicId: topicId, newTopic: payload.p_new_topic,
            statement: payload.p_statement, context: payload.p_context,
            favor: payload.p_favor, against: payload.p_against, author: payload.p_author
          });
        }
        return res;
      });
    }
    setTimeout(function () { var f = form.querySelector(opts.topic || !topics.length ? 'textarea, input[name="new_topic"]' : 'select'); if (f && !opts.open) f.focus(); }, 0);
    return form;
  }

  function reasonForm(s, side, onDone) {
    var form = document.getElementById('tpl-add-reason').content.firstElementChild.cloneNode(true);
    form.querySelector('.reason-label').textContent = side === 'favor' ? 'Your argument in favor' : 'Your argument against';
    var text;
    wireForm(form, onDone, function (fd) {
      var src = (fd.get('source_url') || '').trim();
      var author = (fd.get('author') || '').trim();
      text = (fd.get('text') || '').trim();
      return checkBeforeSending(form, { text: 'textarea[name="text"]' }).then(function () { return db.from('reasons').insert({
        statement_id: s.id,
        side: side,
        text: text,
        author: author || 'Anonymous',
        source_url: src ? safeUrl(src) : null
      }); });
    }, 'Something went wrong. Arguments need at least 10 characters. Please try again.', function () {
      addPending({ type: 'argument', statementId: s.id, side: side, text: text });
      render();
      flash('Thanks! Your argument has been sent for review. Reviews usually happen once a day. Until then you can see it in the table, marked “Waiting for review”.');
    });
    setTimeout(function () { var t = form.querySelector('textarea'); if (t) t.focus(); }, 0);
    return form;
  }

  // ---------- start ----------
  var suggestBtn = document.getElementById('suggest-country');
  var countrySlot = document.getElementById('country-form-slot');
  suggestBtn.hidden = !configured;
  suggestBtn.addEventListener('click', function () {
    suggestBtn.hidden = true;
    countrySlot.appendChild(countryForm(function () { suggestBtn.hidden = false; suggestBtn.focus(); }));
  });

  function onRoute() { applyRoute(); pickCountry(); render(); if (state.view !== 'country' || !state.focusTopic) window.scrollTo(0, 0); }
  window.addEventListener('hashchange', onRoute);
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (a && a.getAttribute('href') === location.hash) { e.preventDefault(); onRoute(); }
  });
  window.addEventListener('popstate', onRoute);

  if (configured && window.supabase) {
    db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }
  render();
  load();
})();
