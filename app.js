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
  var state = { country: readHash(), countries: [], data: null, expanded: {} };
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

  // Used only if the countries table hasn't been created yet.
  var FALLBACK_NAMES = { india: 'India', us: 'United States' };

  function pickCountry() {
    var codes = state.countries.map(function (c) { return c.code; });
    if (codes.indexOf(state.country) === -1) state.country = codes[0] || '';
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
      showNotice('');
      render();
    }).catch(function (e) {
      console.error(e);
      showNotice('Could not load the table. Check the Supabase settings in config.js and that schema.sql has been run.');
      content.innerHTML = '';
    });
  }

  // ---------- rendering ----------
  function render() {
    renderTabs();
    content.innerHTML = '';
    if (!state.data) return;

    var topics = state.data.topics.filter(function (t) { return t.country === state.country; });
    if (!topics.length) {
      content.appendChild(el('p', { class: 'empty', text: 'No topics yet for this country. Propose the first one.' }));
    }
    topics.forEach(function (topic) { content.appendChild(renderTopic(topic)); });
    if (state.country) content.appendChild(renderProposeTopic(state.country));
  }

  function renderProposeTopic(countryCode) {
    var country = state.countries.filter(function (c) { return c.code === countryCode; })[0];
    var box = el('section', { class: 'propose-topic', 'aria-label': 'Propose a topic' });
    var slot = el('div');
    var btn = el('button', { type: 'button', class: 'btn btn-plain', text: '+ Propose a new topic' + (country ? ' for ' + country.name : '') });
    btn.addEventListener('click', function () {
      btn.hidden = true;
      slot.appendChild(topicForm(countryCode, country ? country.name : '', function () { btn.hidden = false; btn.focus(); }));
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
        'aria-pressed': c.code === state.country ? 'true' : 'false',
        onclick: function () {
          state.country = c.code;
          history.replaceState(null, '', '#' + encodeURIComponent(c.code));
          render();
        }
      }));
    });
  }

  function renderTopic(topic) {
    var stmts = state.data.statements.filter(function (s) { return s.topic_id === topic.id; });
    var section = el('section', { class: 'topic', 'aria-label': topic.title });

    section.appendChild(el('div', { class: 'topic-head' }, [
      el('h1', { text: topic.title }),
      el('span', { class: 'muted small', text: stmts.length + (stmts.length === 1 ? ' statement' : ' statements') })
    ]));

    if (!stmts.length) {
      section.appendChild(el('p', { class: 'empty', text: 'No statements yet. Propose the first one.' }));
    }
    stmts.forEach(function (s) { section.appendChild(renderStatement(s)); });

    var slot = el('div');
    var proposeBtn = el('button', { type: 'button', class: 'btn btn-dark btn-propose', text: '+ Propose a statement' });
    proposeBtn.addEventListener('click', function () {
      proposeBtn.hidden = true;
      slot.appendChild(statementForm(topic, function () { proposeBtn.hidden = false; }));
    });
    section.appendChild(proposeBtn);
    section.appendChild(slot);
    return section;
  }

  function renderStatement(s) {
    var card = el('article', { class: 'card' });
    var row = el('div', { class: 'card-row' });

    row.appendChild(el('div', { class: 'cell cell-statement' }, [
      el('div', { class: 'eyebrow', text: 'Statement' }),
      el('h2', { class: 'statement-text', text: s.text }),
      s.context ? el('p', { class: 'statement-context', text: s.context }) : null
    ]));
    row.appendChild(renderSide(s, 'favor', 'In favor'));
    row.appendChild(renderSide(s, 'against', 'Against'));
    card.appendChild(row);

    if (s.stands_supported || s.stands_disputed || s.stands_depends) {
      card.appendChild(renderStands(s));
    }
    return card;
  }

  function renderSide(s, side, label) {
    var all = state.data.reasons.filter(function (r) { return r.statement_id === s.id && r.side === side; });
    var key = s.id + side;
    var showAll = !!state.expanded[key];
    var shown = showAll ? all : all.slice(0, 2);

    var cell = el('div', { class: 'cell cell-side side-' + side }, [
      el('div', { class: 'side-label', text: label })
    ]);

    if (!all.length) {
      cell.appendChild(el('p', { class: 'no-reasons', text: 'No reasons yet.' }));
    } else {
      var list = el('ol', { class: 'reasons' });
      shown.forEach(function (r) { list.appendChild(renderReason(r)); });
      cell.appendChild(list);
    }

    if (all.length > 2) {
      cell.appendChild(el('button', {
        type: 'button', class: 'link-btn',
        text: showAll ? 'Show fewer' : 'View all ' + all.length + ' reasons ' + (side === 'favor' ? 'in favor' : 'against'),
        onclick: function () { state.expanded[key] = !showAll; render(); }
      }));
    }

    var slot = el('div');
    var addBtn = el('button', { type: 'button', class: 'btn-add', text: '+ Add a reason ' + (side === 'favor' ? 'in favor' : 'against') });
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
      box.appendChild(el('div', { class: 'muted small', text: 'Confirmed by a reviewer' }));
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

  function renderStands(s) {
    function item(title, text) {
      return text ? el('div', {}, [el('span', { text: title }), el('span', { text: text })]) : null;
    }
    return el('div', { class: 'stands' }, [
      el('div', { class: 'stands-head' }, [
        el('h3', { text: 'Where the debate stands' }),
        s.stands_status ? el('span', { class: 'stands-status', text: s.stands_status }) : null
      ]),
      el('div', { class: 'stands-grid' }, [
        item('What the cited evidence supports', s.stands_supported),
        item('Still disputed', s.stands_disputed),
        item('The answer depends on', s.stands_depends)
      ]),
      el('div', { class: 'stands-basis', text: (s.stands_basis ? s.stands_basis + ' ' : '') + 'Covers approved reasons only, not public opinion.' })
    ]);
  }

  // ---------- forms ----------
  function wireForm(form, onDone, submit) {
    var msg = form.querySelector('.form-msg');
    var btn = form.querySelector('button[type="submit"]');
    form.querySelector('[data-cancel]').addEventListener('click', function () { form.remove(); onDone(); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      btn.disabled = true;
      msg.className = 'form-msg';
      msg.textContent = 'Sending…';
      submit(new FormData(form)).then(function (res) {
        if (res.error) throw res.error;
        form.innerHTML = '';
        form.appendChild(el('p', { class: 'form-msg ok', text: 'Thanks! It has been sent for review and will appear once approved.' }));
        form.appendChild(el('button', { type: 'button', class: 'btn btn-plain', text: 'Close', onclick: function () { form.remove(); onDone(); } }));
      }).catch(function (err) {
        console.error(err);
        btn.disabled = false;
        msg.className = 'form-msg err';
        msg.textContent = (err && err.friendly) || 'Something went wrong. Check the length (at least 10 characters) and try again.';
      });
    });
  }

  function focusFirst(form) {
    setTimeout(function () { var t = form.querySelector('textarea'); if (t) t.focus(); }, 0);
  }

  function slugify(name) {
    return name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }

  function countryForm(onDone) {
    var form = document.getElementById('tpl-add-country').content.firstElementChild.cloneNode(true);
    wireForm(form, onDone, function (fd) {
      var name = (fd.get('name') || '').trim().replace(/\s+/g, ' ');
      var note = (fd.get('note') || '').trim();
      var code = slugify(name);
      if (code.length < 2) {
        return Promise.reject({ friendly: 'Please write the country name using English letters.' });
      }
      return db.from('countries').insert({ code: code, name: name, note: note || null }).then(function (res) {
        if (res.error && res.error.code === '23505') {
          res.error.friendly = 'That country is already on the site or waiting for review.';
        }
        return res;
      });
    });
    setTimeout(function () { var i = form.querySelector('input'); if (i) i.focus(); }, 0);
    return form;
  }

  function topicForm(countryCode, countryName, onDone) {
    var form = document.getElementById('tpl-add-topic').content.firstElementChild.cloneNode(true);
    if (countryName) form.querySelector('h3').textContent = 'Propose a topic for ' + countryName;
    wireForm(form, onDone, function (fd) {
      return db.from('topics').insert({ country: countryCode, title: (fd.get('title') || '').trim().replace(/\s+/g, ' ') });
    });
    setTimeout(function () { var i = form.querySelector('input'); if (i) i.focus(); }, 0);
    return form;
  }

  function statementForm(topic, onDone) {
    var form = document.getElementById('tpl-add-statement').content.firstElementChild.cloneNode(true);
    wireForm(form, onDone, function (fd) {
      var context = (fd.get('context') || '').trim();
      return db.from('statements').insert({
        topic_id: topic.id,
        text: (fd.get('text') || '').trim(),
        context: context || null
      });
    });
    focusFirst(form);
    return form;
  }

  function reasonForm(s, side, onDone) {
    var form = document.getElementById('tpl-add-reason').content.firstElementChild.cloneNode(true);
    wireForm(form, onDone, function (fd) {
      var src = (fd.get('source_url') || '').trim();
      var author = (fd.get('author') || '').trim();
      return db.from('reasons').insert({
        statement_id: s.id,
        side: side,
        text: (fd.get('text') || '').trim(),
        author: author || 'Anonymous',
        source_url: src ? safeUrl(src) : null
      });
    });
    focusFirst(form);
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

  window.addEventListener('hashchange', function () { state.country = readHash(); pickCountry(); render(); });

  if (configured && window.supabase) {
    db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }
  render();
  load();
})();
