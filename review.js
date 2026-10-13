(function () {
  'use strict';

  var cfg = window.BOTH_SIDES_CONFIG || {};
  var db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  var $ = function (id) { return document.getElementById(id); };
  var view = $('view');
  var state = { view: 'queue', queue: null, live: null, liveCountry: null, signup: false, notes: {} };

  // ---------- helpers ----------
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }
  function safeUrl(u) {
    try { var x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : null; } catch (e) { return null; }
  }
  function when(ts) {
    try { return new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }
  function notice(msg) { $('notice').textContent = msg || ''; $('notice').hidden = !msg; }
  function flash(msg) {
    var f = $('flash'); f.textContent = msg; f.hidden = false;
    clearTimeout(flash.t); flash.t = setTimeout(function () { f.hidden = true; }, 5000);
  }
  function btn(label, cls, onclick) {
    return el('button', { type: 'button', class: 'btn ' + cls, text: label, onclick: onclick });
  }
  function busy(button, fn) {
    return function () {
      var all = view.querySelectorAll('button');
      all.forEach(function (b) { b.disabled = true; });
      Promise.resolve().then(fn).catch(function (e) {
        console.error(e);
        notice('That did not work: ' + ((e && e.message) || 'unknown error') + '. Please try again.');
      }).then(function () { all.forEach(function (b) { b.disabled = false; }); });
    };
  }

  // ---------- AI drafting help (reviewer only; nothing is saved until you press Save/Apply) ----------
  function assist(task, statementId) {
    return db.auth.getSession().then(function (r) {
      var token = r.data && r.data.session && r.data.session.access_token;
      return fetch('/api/assist', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ task: task, statementId: statementId })
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (out) {
        if (!res.ok) throw new Error(out.error || 'The AI could not help just now.');
        return out;
      });
    });
  }

  var NOTE_NAMES = { fallacy: 'Possible fallacy', overclaims: 'Overclaims', evidence: 'Needs evidence', value: 'Value difference', strong: 'Strong', none: 'No note' };

  function setNote(id, n) {
    return db.rpc('admin_set_tag', { p_id: id, p_tag: n.tag, p_detail: n.detail || null, p_why: n.why || null, p_fix: n.fix || null }).then(function (res) {
      if (res.error) throw res.error;
    });
  }

  // ---------- sign in ----------
  function showSignin(msg) {
    $('signin').hidden = false; $('panel').hidden = true; $('sign-out').hidden = true; $('who').textContent = '';
    if (msg) { $('signin-msg').className = 'form-msg err'; $('signin-msg').textContent = msg; }
  }

  $('mode-toggle').addEventListener('click', function () {
    state.signup = !state.signup;
    $('signin-btn').textContent = state.signup ? 'Create password' : 'Sign in';
    $('mode-toggle').textContent = state.signup ? 'I already have a password' : 'First time? Create a password';
    $('signin-help').textContent = state.signup
      ? 'Use the email the site owner added as a reviewer, and choose a password of at least 8 characters.'
      : 'Sign in with the email and password you set up as a reviewer.';
    $('signin-msg').textContent = '';
  });

  $('signin-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var fd = new FormData(e.target);
    var email = String(fd.get('email') || '').trim().toLowerCase();
    var password = String(fd.get('password') || '');
    var msg = $('signin-msg');
    msg.className = 'form-msg'; msg.textContent = state.signup ? 'Creating…' : 'Signing in…';
    var call = state.signup
      ? db.auth.signUp({ email: email, password: password, options: { emailRedirectTo: location.origin + '/review.html' } })
      : db.auth.signInWithPassword({ email: email, password: password });
    call.then(function (res) {
      if (res.error) throw res.error;
      if (state.signup && !res.data.session) {
        msg.className = 'form-msg ok';
        msg.textContent = 'Password created. Your account now needs to be confirmed. Check your email for a confirmation link (or ask the site owner to activate you), then sign in here.';
        return;
      }
      msg.textContent = '';
      start();
    }).catch(function (err) {
      msg.className = 'form-msg err';
      var m = (err && err.message) || '';
      msg.textContent = /confirm/i.test(m) ? 'Your account has not been confirmed yet. Check your email for the confirmation link, or ask the site owner to activate you.'
        : /Invalid login/i.test(m) ? 'Email or password is not right.'
        : /already registered/i.test(m) ? 'This email already has a password. Use "I already have a password" to sign in.'
        : 'Something went wrong: ' + m;
    });
  });

  $('sign-out').addEventListener('click', function () { db.auth.signOut().then(function () { showSignin(); }); });

  function start() {
    db.auth.getSession().then(function (r) {
      var session = r.data && r.data.session;
      if (!session) return showSignin();
      return db.rpc('is_admin').then(function (res) {
        if (res.error || !res.data) {
          showSignin('Signed in as ' + session.user.email + ', but this email is not on the reviewer list. Ask the site owner to add it.');
          $('sign-out').hidden = false;
          return;
        }
        $('signin').hidden = true; $('panel').hidden = false; $('sign-out').hidden = false;
        $('who').textContent = session.user.email;
        refresh();
      });
    });
  }

  // ---------- data ----------
  function refresh() {
    notice('');
    return Promise.all([
      db.rpc('review_queue'),
      db.from('countries').select('code,name,sort').order('sort'),
      db.from('topics').select('id,country,title').order('sort').order('created_at'),
      db.from('statements').select('*').order('created_at'),
      db.from('reasons').select('*').order('created_at')
    ]).then(function (r) {
      var err = r[0].error || r[1].error || r[2].error || r[3].error || r[4].error;
      if (err) throw err;
      state.queue = r[0].data;
      state.live = { countries: r[1].data, topics: r[2].data, statements: r[3].data, reasons: r[4].data };
      if (!state.liveCountry && state.live.countries.length) state.liveCountry = state.live.countries[0].code;
      var q = state.queue;
      var n = q.countries.length + q.topics.length + q.statements.length + q.reasons.length;
      $('queue-count').textContent = n ? String(n) : '';
      render();
    }).catch(function (e) {
      console.error(e);
      notice('Could not load the review data: ' + ((e && e.message) || 'unknown error'));
    });
  }

  function decide(kind, id, decision, doneText) {
    return db.rpc('review_item', { p_kind: kind, p_id: String(id), p_decision: decision }).then(function (res) {
      if (res.error) throw res.error;
      flash(doneText);
      return refresh();
    });
  }

  function remove(kind, id, label) {
    var warn = {
      statement: 'Delete this debate and all its arguments?',
      topic: 'Delete this topic and every debate and argument in it?',
      reason: 'Delete this argument?',
      country: 'Delete this country and everything in it?'
    }[kind];
    if (!window.confirm(warn + '\n\n"' + label + '"\n\nThis cannot be undone.')) return Promise.resolve();
    return db.rpc('admin_delete', { p_kind: kind, p_id: String(id) }).then(function (res) {
      if (res.error) throw res.error;
      flash('Deleted.');
      return refresh();
    });
  }

  // ---------- views ----------
  document.querySelectorAll('.review-tabs .tab').forEach(function (b) {
    b.addEventListener('click', function () {
      state.view = b.dataset.view;
      document.querySelectorAll('.review-tabs .tab').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      render();
    });
  });

  function render() {
    view.innerHTML = '';
    if (!state.queue) return;
    if (state.view === 'queue') renderQueue();
    else if (state.view === 'live') renderLive();
    else renderLog();
  }

  function argBlock(r, actions) {
    var href = r.source_url ? safeUrl(r.source_url) : null;
    return el('div', { class: 'arg' }, [
      el('span', { text: r.text }),
      el('div', { class: 'arg-meta' }, [
        el('span', { text: r.author || 'Anonymous' }),
        href ? el('a', { href: href, target: '_blank', rel: 'noopener noreferrer', text: 'Source ↗' }) : null,
        el('span', { class: 'spacer' })
      ].concat(actions || []))
    ]);
  }

  function renderQueue() {
    var q = state.queue;
    var total = q.countries.length + q.topics.length + q.statements.length + q.reasons.length;
    if (!total) { view.appendChild(el('p', { class: 'done', text: 'All caught up. Nothing is waiting for review.' })); return; }

    if (q.countries.length) {
      var g = el('section', { class: 'group' }, [el('h2', { text: 'New countries (' + q.countries.length + ')' })]);
      q.countries.forEach(function (c) {
        g.appendChild(el('div', { class: 'item' }, [
          el('div', { class: 'crumbs', text: 'Suggested ' + when(c.created_at) }),
          el('h3', { class: 'item-title', text: c.name }),
          c.note ? el('p', { class: 'item-sub', text: 'Debate they would like to see: ' + c.note }) : null,
          el('div', { class: 'actions' }, [
            btn('Approve', 'btn-approve', busy(null, function () { return decide('country', c.code, 'approved', c.name + ' is now live as a tab.'); })),
            btn('Reject', 'btn-reject', busy(null, function () { return decide('country', c.code, 'rejected', c.name + ' was rejected.'); }))
          ])
        ]));
      });
      view.appendChild(g);
    }

    if (q.statements.length) {
      var gd = el('section', { class: 'group' }, [
        el('h2', { text: 'New debates (' + q.statements.length + ')' }),
        el('p', { class: 'muted small', text: 'Approving a debate also approves its topic (if new) and the arguments shown with it. Remove any argument you don’t want first.' })
      ]);
      q.statements.forEach(function (s) {
        var sides = ['favor', 'against'].map(function (side) {
          var list = s.reasons.filter(function (r) { return r.side === side; });
          return el('div', { class: side }, [el('div', { class: 'side-name', text: side === 'favor' ? 'In favor' : 'Against' })].concat(
            list.length ? list.map(function (r) {
              return argBlock(r, [el('button', { type: 'button', class: 'btn-small btn-reject', text: 'Remove',
                onclick: busy(null, function () { return decide('reason', r.id, 'rejected', 'Argument removed.'); }) })]);
            }) : [el('span', { class: 'muted small', text: 'No argument submitted.' })]
          ));
        });
        gd.appendChild(el('div', { class: 'item' }, [
          el('div', { class: 'crumbs' }, [
            el('span', { text: s.country_name + ' › ' + s.topic_title }),
            s.topic_status === 'pending' ? el('span', { class: 'new-badge', text: 'New topic' }) : null,
            el('span', { text: '· ' + when(s.created_at) })
          ]),
          el('h3', { class: 'item-title', text: s.text }),
          s.context ? el('p', { class: 'item-sub', text: s.context }) : null,
          el('div', { class: 'args' }, sides),
          el('div', { class: 'actions' }, [
            btn('Approve debate', 'btn-approve', busy(null, function () { return decide('statement', s.id, 'approved', 'Debate approved and live.'); })),
            btn('Reject', 'btn-reject', busy(null, function () { return decide('statement', s.id, 'rejected', 'Debate rejected.'); }))
          ])
        ]));
      });
      view.appendChild(gd);
    }

    if (q.reasons.length) {
      var ga = el('section', { class: 'group' }, [el('h2', { text: 'New arguments on live debates (' + q.reasons.length + ')' })]);
      q.reasons.forEach(function (r) {
        ga.appendChild(el('div', { class: 'item' }, [
          el('div', { class: 'crumbs', text: r.country_name + ' › ' + r.topic_title + ' · ' + when(r.created_at) }),
          el('p', { class: 'item-sub', text: 'On: ' + r.statement_text }),
          el('div', { class: 'args' }, [el('div', { class: r.side }, [
            el('div', { class: 'side-name', text: r.side === 'favor' ? 'In favor' : 'Against' }), argBlock(r)
          ])]),
          el('div', { class: 'actions' }, [
            btn('Approve', 'btn-approve', busy(null, function () { return decide('reason', r.id, 'approved', 'Argument approved and live.'); })),
            btn('Reject', 'btn-reject', busy(null, function () { return decide('reason', r.id, 'rejected', 'Argument rejected.'); }))
          ])
        ]));
      });
      view.appendChild(ga);
    }

    if (q.topics.length) {
      var gt = el('section', { class: 'group' }, [el('h2', { text: 'New topics without a debate (' + q.topics.length + ')' })]);
      q.topics.forEach(function (t) {
        gt.appendChild(el('div', { class: 'item' }, [
          el('div', { class: 'crumbs', text: t.country_name + ' · ' + when(t.created_at) }),
          el('h3', { class: 'item-title', text: t.title }),
          el('div', { class: 'actions' }, [
            btn('Approve', 'btn-approve', busy(null, function () { return decide('topic', t.id, 'approved', 'Topic approved.'); })),
            btn('Reject', 'btn-reject', busy(null, function () { return decide('topic', t.id, 'rejected', 'Topic rejected.'); }))
          ])
        ]));
      });
      view.appendChild(gt);
    }
  }

  function renderLive() {
    var L = state.live;
    if (!L.countries.length) { view.appendChild(el('p', { class: 'done', text: 'Nothing is live yet.' })); return; }
    var tabs = el('nav', { class: 'tabs', 'aria-label': 'Country' });
    L.countries.forEach(function (c) {
      tabs.appendChild(el('button', { type: 'button', class: 'tab', text: c.name, 'aria-pressed': c.code === state.liveCountry ? 'true' : 'false',
        onclick: function () { state.liveCountry = c.code; render(); } }));
    });
    view.appendChild(el('div', { class: 'actions' }, [tabs]));

    var country = L.countries.filter(function (c) { return c.code === state.liveCountry; })[0] || L.countries[0];
    var topics = L.topics.filter(function (t) { return t.country === country.code; });
    var g = el('section', { class: 'group' });
    if (!topics.length) g.appendChild(el('p', { class: 'done', text: 'No live topics in ' + country.name + '.' }));
    topics.forEach(function (t) {
      var debates = L.statements.filter(function (s) { return s.topic_id === t.id; });
      var d = el('details', { class: 'live-topic' }, [
        el('summary', {}, [
          el('span', { class: 'chev', 'aria-hidden': 'true' }),
          el('h3', { class: 'item-title', text: t.title }),
          el('span', { class: 'muted small', text: debates.length + (debates.length === 1 ? ' debate' : ' debates') }),
          el('span', { class: 'spacer' }),
          el('button', { type: 'button', class: 'btn-small btn-delete', text: 'Delete topic',
            onclick: function (e) { e.preventDefault(); busy(null, function () { return remove('topic', t.id, t.title); })(); } })
        ])
      ]);
      var body = el('div', { class: 'live-body' });
      if (!debates.length) body.appendChild(el('p', { class: 'muted small', text: 'No debates in this topic.' }));
      debates.forEach(function (s) {
        var args = L.reasons.filter(function (r) { return r.statement_id === s.id; });
        body.appendChild(el('div', { class: 'live-debate' }, [
          el('div', { class: 'live-head' }, [
            el('h4', { class: 'item-title', text: s.text }),
            el('button', { type: 'button', class: 'btn-small btn-delete', text: 'Delete debate',
              onclick: busy(null, function () { return remove('statement', s.id, s.text); }) })
          ]),
          el('div', { class: 'args' }, ['favor', 'against'].map(function (side) {
            var list = args.filter(function (r) { return r.side === side; });
            return el('div', { class: side }, [el('div', { class: 'side-name', text: side === 'favor' ? 'In favor' : 'Against' })].concat(
              list.length ? list.map(function (r) {
                var block = argBlock(r, [el('button', { type: 'button', class: 'btn-small btn-delete', text: 'Delete',
                  onclick: busy(null, function () { return remove('reason', r.id, r.text); }) })]);
                if (r.tag) {
                  block.appendChild(el('div', { class: 'note-current' }, [
                    el('span', { text: 'Note: ' + (NOTE_NAMES[r.tag] || r.tag) + (r.tag_detail ? ' (' + r.tag_detail + ')' : '') }),
                    el('button', { type: 'button', class: 'btn-small btn-reject', text: 'Remove note',
                      onclick: busy(null, function () { return setNote(r.id, { tag: 'none' }).then(function () { flash('Note removed.'); return refresh(); }); }) })
                  ]));
                }
                var sug = (state.notes[s.id] || []).filter(function (n) { return n.id === r.id; })[0];
                if (sug) {
                  block.appendChild(el('div', { class: 'note-suggest' }, [
                    el('div', {}, [el('b', { text: 'AI suggests: ' + NOTE_NAMES[sug.tag] + (sug.detail ? ' (' + sug.detail + ')' : '') })]),
                    sug.why ? el('div', { text: 'Why: ' + sug.why }) : null,
                    sug.fix ? el('div', { text: 'To improve: ' + sug.fix }) : null,
                    el('div', { class: 'actions' }, [
                      sug.tag !== 'none' || r.tag ? el('button', { type: 'button', class: 'btn-small btn-approve', text: sug.tag === 'none' ? 'Apply (remove note)' : 'Apply this note',
                        onclick: busy(null, function () {
                          return setNote(r.id, sug).then(function () {
                            state.notes[s.id] = state.notes[s.id].filter(function (n) { return n.id !== r.id; });
                            flash('Note saved and live.'); return refresh();
                          });
                        }) }) : null,
                      el('button', { type: 'button', class: 'btn-small btn-reject', text: 'Ignore', onclick: function () {
                        state.notes[s.id] = state.notes[s.id].filter(function (n) { return n.id !== r.id; }); render();
                      } })
                    ])
                  ]));
                }
                return block;
              }) : [el('span', { class: 'muted small', text: 'No arguments.' })]));
          })),
          args.length ? el('div', { class: 'actions' }, [
            el('button', { type: 'button', class: 'btn-small btn-reject', text: 'Suggest notes with AI',
              onclick: busy(null, function () {
                return assist('notes', s.id).then(function (out) {
                  state.notes[s.id] = out.notes || [];
                  var real = state.notes[s.id].filter(function (n) { return n.tag !== 'none'; }).length;
                  flash(real ? 'AI suggested ' + real + (real === 1 ? ' note' : ' notes') + '. Review each one below.' : 'AI suggests no notes for this debate.');
                  render();
                });
              }) })
          ]) : null,
          summaryBlock(s)
        ]));
      });
      d.appendChild(body);
      g.appendChild(d);
    });
    view.appendChild(g);
    view.appendChild(el('div', { class: 'actions' }, [
      el('button', { type: 'button', class: 'btn btn-delete', text: 'Delete the ' + country.name + ' tab',
        onclick: busy(null, function () { return remove('country', country.code, country.name); }) })
    ]));
  }

  // "Where the discussion stands" editor
  function summaryBlock(s) {
    var has = s.stands_supported || s.stands_disputed || s.stands_resolve || s.stands_depends;
    var wrap = el('div', { class: 'summary-block' });
    var reviewed = s.stands_reviewed_at ? ' · reviewed ' + when(s.stands_reviewed_at) : '';
    var head = el('div', { class: 'live-head' }, [
      el('span', { class: 'side-name', text: 'Where the discussion stands' + (has ? reviewed : ' · not written yet') })
    ]);
    var editBtn = el('button', { type: 'button', class: 'btn-small btn-reject summary-edit', text: has ? 'Edit summary' : 'Write summary' });
    head.appendChild(editBtn);
    wrap.appendChild(head);
    if (has) {
      wrap.appendChild(el('div', { class: 'summary-preview' }, [
        s.stands_supported ? el('p', {}, [el('b', { text: 'Supported: ' }), document.createTextNode(s.stands_supported)]) : null,
        s.stands_disputed ? el('p', {}, [el('b', { text: 'Disputed: ' }), document.createTextNode(s.stands_disputed)]) : null,
        (s.stands_resolve || s.stands_depends) ? el('p', {}, [el('b', { text: s.stands_resolve ? 'Would help resolve it: ' : 'Depends on: ' }), document.createTextNode(s.stands_resolve || s.stands_depends)]) : null
      ]));
    }
    editBtn.addEventListener('click', function () {
      editBtn.hidden = true;
      function field(label, name, value, hint) {
        return el('label', {}, [document.createTextNode(label + ' '), el('span', { class: 'muted', text: hint }),
          el('textarea', { name: name, rows: '2', maxlength: '600' })]);
      }
      var form = el('form', { class: 'form summary-form' }, [
        field('What the evidence supports', 'supported', s.stands_supported, '(facts both sides can rely on)'),
        field('Still disputed', 'disputed', s.stands_disputed, '(what people still disagree about)'),
        field('What would help resolve it', 'resolve', s.stands_resolve, '(evidence or steps that would settle it)'),
        el('label', {}, [document.createTextNode('Status label '), el('span', { class: 'muted', text: '(optional, e.g. “No new arguments since 8 Oct”)' }),
          el('input', { name: 'status', maxlength: '80' })]),
        el('p', { class: 'ai-draft-note muted small', hidden: true, text: 'AI draft. Read it carefully and edit before saving.' }),
        el('div', { class: 'form-actions' }, [
          el('button', { type: 'button', class: 'btn btn-reject ai-draft-btn', text: 'Draft with AI', onclick: function () {
            var b = form.querySelector('.ai-draft-btn'); b.disabled = true; b.textContent = 'Drafting…';
            assist('summary', s.id).then(function (out) {
              form.querySelector('[name=supported]').value = out.supported || '';
              form.querySelector('[name=disputed]').value = out.disputed || '';
              form.querySelector('[name=resolve]').value = out.resolve || '';
              form.querySelector('.ai-draft-note').hidden = false;
            }).catch(function (e) { notice(e.message); }).then(function () { b.disabled = false; b.textContent = 'Draft with AI'; });
          } }),
          el('button', { type: 'submit', class: 'btn btn-approve', text: 'Save summary' }),
          el('button', { type: 'button', class: 'btn btn-reject', text: 'Cancel', onclick: function () { form.remove(); editBtn.hidden = false; } })
        ]),
        el('p', { class: 'muted small', text: 'Leave all three empty to hide the summary. Saving sets today as the reviewed date.' })
      ]);
      form.querySelector('[name=supported]').value = s.stands_supported || '';
      form.querySelector('[name=disputed]').value = s.stands_disputed || '';
      form.querySelector('[name=resolve]').value = s.stands_resolve || '';
      form.querySelector('[name=status]').value = s.stands_status || '';
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var fd = new FormData(form);
        busy(null, function () {
          return db.rpc('admin_set_summary', {
            p_id: s.id, p_supported: fd.get('supported'), p_disputed: fd.get('disputed'),
            p_resolve: fd.get('resolve'), p_status: fd.get('status')
          }).then(function (res) {
            if (res.error) throw res.error;
            flash('Summary saved and live.');
            return refresh();
          });
        })();
      });
      wrap.appendChild(form);
      form.querySelector('textarea').focus();
    });
    return wrap;
  }

  function renderLog() {
    var rows = state.queue.recent || [];
    if (!rows.length) { view.appendChild(el('p', { class: 'done', text: 'No decisions yet.' })); return; }
    var kinds = { country: 'Country', topic: 'Topic', statement: 'Debate', reason: 'Argument' };
    var labels = { approved: 'Approved', rejected: 'Rejected', deleted: 'Deleted', summary: 'Summary updated', note: 'Note updated' };
    var tbody = el('tbody', {}, rows.map(function (r) {
      return el('tr', {}, [
        el('td', { text: when(r.at) }),
        el('td', { class: 'd-' + r.decision, text: labels[r.decision] || r.decision }),
        el('td', { text: kinds[r.kind] || r.kind }),
        el('td', { text: r.item_text || '' }),
        el('td', { text: r.by_email || '' })
      ]);
    }));
    view.appendChild(el('div', { class: 'log' }, [el('table', {}, [
      el('thead', {}, [el('tr', {}, ['When', 'Decision', 'What', 'Item', 'By'].map(function (h) { return el('th', { text: h }); }))]),
      tbody
    ])]));
    view.appendChild(el('p', { class: 'muted small', text: 'Showing the 15 most recent decisions.' }));
  }

  db.auth.onAuthStateChange(function (event) { if (event === 'SIGNED_OUT') showSignin(); });
  start();
})();
